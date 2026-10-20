import ast
import contextlib
import errno
import io
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


class Clock:
    def __init__(self, now=0):
        self.now = now

    def ticks_ms(self):
        return self.now % 65536

    def ticks_add(self, value, delta):
        return (value + delta) % 65536

    def ticks_diff(self, a, b):
        return (a - b + 32768) % 65536 - 32768

    def sleep_ms(self, milliseconds):
        self.now += milliseconds


class Transport:
    def __init__(self, clock):
        self.clock = clock
        self.dns_ms = 0
        self.connect_ms = 0
        self.connect_error = None
        self.timeout = None
        self.blocking = True
        self.closed = False
        self.stream_closed = False
        self.pending_tls = False
        self.reads = [b"HTTP/1.1 200 OK\r\nContent-Length: 99999\r\n\r\n"]
        self.sent = bytearray()
        self.partial_write = False
        self.read_count = 0

    def getaddrinfo(self, host, port, family, kind):
        self.clock.now += self.dns_ms
        return [(2, 1, 6, "", (host, port))]

    def settimeout(self, timeout):
        self.timeout = timeout

    def connect(self, address):
        self.clock.now += min(self.connect_ms, self.timeout * 1000)
        if self.connect_error:
            raise self.connect_error
        if self.connect_ms >= self.timeout * 1000:
            raise OSError(errno.ETIMEDOUT)

    def setblocking(self, value):
        self.blocking = value

    def close(self):
        self.closed = True

    def wrap_socket(self, raw, **options):
        assert raw is self
        assert self.blocking is False
        assert options.get("do_handshake_on_connect", options.get("do_handshake")) is False
        owner = self

        class Stream:
            def write(self, data):
                if owner.pending_tls:
                    return None
                length = min(len(data), 7) if owner.partial_write else len(data)
                owner.sent.extend(data[:length])
                return length

            def read(self, count):
                owner.read_count += 1
                if not owner.reads:
                    return None
                item = owner.reads.pop(0)
                if isinstance(item, tuple):
                    elapsed, item = item
                    owner.clock.now += elapsed
                if isinstance(item, Exception):
                    raise item
                return item

            def close(self):
                owner.stream_closed = True

        return Stream()


def setup(now=0, legacy_ssl=False):
    clock = Clock(now)
    transport = Transport(clock)
    socket = types.SimpleNamespace(SOCK_STREAM=1, getaddrinfo=transport.getaddrinfo, socket=lambda *args: transport)
    ssl = types.SimpleNamespace(PROTOCOL_TLS_CLIENT=1, CERT_NONE=0)
    if legacy_ssl:
        ssl.wrap_socket = transport.wrap_socket
    else:
        ssl.SSLContext = lambda protocol: types.SimpleNamespace(wrap_socket=transport.wrap_socket)
    spec = importlib.util.spec_from_file_location("tap_http", ROOT / "tap_http.py")
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"socket": socket, "ssl": ssl, "time": clock}):
        spec.loader.exec_module(module)
    return module, clock, transport


class HttpTests(unittest.TestCase):
    def post(self, module, clock):
        return module.post_status("https://api.example/Prod/tap", '{"cardID":"AABB"}',
                                  {"Content-Type": "application/json", "x-internal": "test-secret"},
                                  clock.ticks_add(clock.ticks_ms(), 6500))

    def test_success_closes_without_waiting_for_response_body(self):
        module, clock, transport = setup()
        transport.partial_write = True
        self.assertEqual(self.post(module, clock), 200)
        self.assertEqual(transport.read_count, 1)
        self.assertTrue(transport.closed and transport.stream_closed)
        self.assertIn(b"POST /Prod/tap HTTP/1.1\r\n", transport.sent)
        self.assertIn(b'\r\n\r\n{"cardID":"AABB"}', transport.sent)

    def test_connect_receives_budget_remaining_after_dns(self):
        module, clock, transport = setup()
        transport.dns_ms = 700
        self.assertEqual(self.post(module, clock), 200)
        self.assertAlmostEqual(transport.timeout, 5.8)

    def test_expired_dns_does_not_start_a_connection(self):
        module, clock, transport = setup()
        transport.dns_ms = 6600
        with self.assertRaises(module.RequestError) as error:
            self.post(module, clock)
        self.assertTrue(error.exception.safe_to_retry)
        self.assertIsNone(transport.timeout)
        self.assertTrue(transport.closed)

    def test_connection_timeout_closes_socket_and_is_safe_to_retry(self):
        module, clock, transport = setup()
        transport.dns_ms = 700
        transport.connect_ms = 7000
        with self.assertRaises(module.RequestError) as error:
            self.post(module, clock)
        self.assertEqual(clock.now, 6500)
        self.assertTrue(error.exception.safe_to_retry)
        self.assertTrue(transport.closed)

    def test_stalled_tls_handshake_obeys_absolute_deadline(self):
        module, clock, transport = setup()
        transport.pending_tls = True
        with self.assertRaises(module.RequestError) as error:
            self.post(module, clock)
        self.assertEqual(clock.now, 6500)
        self.assertFalse(error.exception.safe_to_retry)
        self.assertTrue(transport.closed and transport.stream_closed)

    def test_slow_headers_cannot_reset_the_request_deadline(self):
        module, clock, transport = setup()
        transport.dns_ms = 500
        transport.connect_ms = 500
        transport.reads = [(100, b"H")] * 80
        with self.assertRaises(module.RequestError) as error:
            self.post(module, clock)
        self.assertEqual(clock.now, 6500)
        self.assertFalse(error.exception.safe_to_retry)
        self.assertTrue(transport.closed and transport.stream_closed)

    def test_nonblocking_read_retries_eagain_but_not_other_errors(self):
        module, clock, transport = setup()
        transport.reads.insert(0, OSError(errno.EAGAIN))
        self.assertEqual(self.post(module, clock), 200)
        self.assertEqual(clock.now, 10)
        transport.reads = [OSError(errno.ECONNRESET)]
        with self.assertRaises(module.RequestError) as error:
            self.post(module, clock)
        self.assertFalse(error.exception.safe_to_retry)

    def test_peer_close_and_malformed_response_are_not_retried(self):
        for response in [b"", b"invalid\r\n\r\n", b"HTTP/1.1 bad\r\n\r\n"]:
            module, clock, transport = setup()
            transport.reads = [response]
            with self.assertRaises(module.RequestError) as error:
                self.post(module, clock)
            self.assertFalse(error.exception.safe_to_retry)
            self.assertTrue(transport.closed)

    def test_legacy_ssl_also_defers_handshake(self):
        module, clock, transport = setup(legacy_ssl=True)
        self.assertEqual(self.post(module, clock), 200)

    def test_deadline_survives_ticks_wraparound(self):
        module, clock, transport = setup(now=64000)
        transport.pending_tls = True
        with self.assertRaises(module.RequestError):
            self.post(module, clock)
        self.assertEqual(clock.now, 70500)


class RetryTests(unittest.TestCase):
    def setup_retry(self, post):
        clock = Clock()
        module, _, _ = setup()
        node = next(node for node in ast.parse((ROOT / "main.py").read_text()).body
                    if isinstance(node, ast.FunctionDef) and node.name == "post_with_retry")
        namespace = {"time": clock, "HTTP_DEADLINE_MS": 6500,
                     "tap_http": types.SimpleNamespace(post_status=lambda *args: post(clock, module, *args)),
                     "feed": lambda: None, "sleep_fed": lambda seconds: clock.sleep_ms(int(seconds * 1000))}
        exec(compile(ast.Module(body=[node], type_ignores=[]), "main.py", "exec"), namespace)
        return namespace["post_with_retry"], clock

    def test_connection_retry_shares_original_deadline_and_backoff_budget(self):
        calls = []

        def post(clock, module, url, payload, headers, deadline):
            calls.append(deadline)
            if len(calls) == 1:
                clock.now += 1000
                raise module.RequestError("connect failed", safe_to_retry=True)
            return 200

        retry, clock = self.setup_retry(post)
        self.assertEqual(retry("url", "payload", {}), (200, None))
        self.assertEqual(calls, [6500, 6500])
        self.assertEqual(clock.now, 1500)

    def test_lost_response_does_not_replay_tap(self):
        calls = []

        def post(clock, module, *args):
            calls.append(args)
            raise module.RequestError("response lost", safe_to_retry=False)

        retry, clock = self.setup_retry(post)
        status, error = retry("url", "payload", {})
        self.assertIsNone(status)
        self.assertIsNotNone(error)
        self.assertEqual(len(calls), 1)

    def test_no_retry_when_backoff_would_exhaust_deadline(self):
        calls = []

        def post(clock, module, *args):
            calls.append(args)
            clock.now += 6300
            raise module.RequestError("connect failed", safe_to_retry=True)

        retry, clock = self.setup_retry(post)
        retry("url", "payload", {})
        self.assertEqual(len(calls), 1)
        self.assertEqual(clock.now, 6300)


class TapLoopTests(unittest.TestCase):
    def test_slow_request_does_not_replay_a_card_still_on_reader(self):
        clock = Clock()
        requests = []

        class Reader:
            count = 0

            def read_passive_target(self, **kwargs):
                self.count += 1
                if self.count > 2:
                    raise StopIteration()
                return b"\x01\x02"

        def post(*args, **kwargs):
            requests.append(args)
            clock.now += 6000
            return 200, None

        node = next(node for node in ast.parse((ROOT / "main.py").read_text()).body
                    if isinstance(node, ast.FunctionDef) and node.name == "tap_loop")
        namespace = {"time": clock, "TAP_DEBOUNCE_MS": 5000, "NFC_POLL_TIMEOUT_MS": 1000,
                     "json": __import__("json"),
                     "feed": lambda: None, "ensure_wifi": lambda *args: True,
                     "buzz_on": lambda: None, "buzz_error_lambda": lambda: None,
                     "post_with_retry": post}
        exec(compile(ast.Module(body=[node], type_ignores=[]), "main.py", "exec"), namespace)
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(StopIteration):
            namespace["tap_loop"](Reader(), "ssid", "password", "device", "url", "secret")
        self.assertEqual(len(requests), 1)


if __name__ == "__main__":
    unittest.main()
