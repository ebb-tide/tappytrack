import ast
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

from test_tap_http import Clock


ROOT = Path(__file__).resolve().parents[1]


def load_functions(filename, function, constant, namespace):
    tree = ast.parse((ROOT / filename).read_text())
    nodes = [node for node in tree.body
             if (isinstance(node, ast.FunctionDef) and node.name == function)
             or (isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == constant
                         for target in node.targets))]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, "exec"), namespace)
    return namespace[function]


class Pin:
    def __init__(self, *args):
        pass

    def on(self):
        pass

    def off(self):
        pass


Pin.OUT = 1


class PollClock(Clock):
    def sleep(self, seconds):
        self.sleep_ms(int(seconds * 1000))


class DriverTimeoutTests(unittest.TestCase):
    def test_reader_can_become_ready_after_multiple_polls(self):
        clock = PollClock()
        spec = importlib.util.spec_from_file_location("NFC_PN532", ROOT / "NFC_PN532.py")
        driver = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"time": clock, "machine": types.SimpleNamespace(Pin=Pin),
                                      "micropython": types.SimpleNamespace(const=lambda value: value)}):
            spec.loader.exec_module(driver)
        polls = []

        class SPI:
            def write_readinto(self, query, response):
                polls.append(clock.now)
                response[1] = driver.reverse_bit(1) if clock.now >= 250 else 0

        reader = driver.PN532.__new__(driver.PN532)
        reader.CSB = Pin()
        reader._spi = SPI()
        # The former timeout=1 call stopped before the reader became ready.
        self.assertFalse(reader._wait_ready(timeout=1))
        clock.now = 0
        polls.clear()
        self.assertTrue(reader._wait_ready(timeout=1000))
        self.assertGreater(len(polls), 1)
        self.assertGreaterEqual(clock.now, 250)
        self.assertLess(clock.now, 1000)


class CallSiteTimeoutTests(unittest.TestCase):
    def test_online_and_offline_polls_use_one_thousand_milliseconds(self):
        for function in ("tap_loop", "serve_wifi_form"):
            with self.subTest(function=function):
                timeouts = []

                class Reader:
                    def read_passive_target(self, *, timeout):
                        timeouts.append(timeout)
                        raise StopIteration()

                class Server:
                    def bind(self, address): pass
                    def listen(self, backlog): pass
                    def settimeout(self, timeout): pass
                    def accept(self): raise OSError("no client")

                namespace = {
                    "time": PollClock(), "feed": lambda: None,
                    "ensure_wifi": lambda *args: True,
                    "socket": types.SimpleNamespace(socket=Server, getaddrinfo=lambda *args: [(0, 0, 0, "", ("", 80))]),
                }
                call = load_functions("main.py", function, "NFC_POLL_TIMEOUT_MS", namespace)
                arguments = (Reader(),) if function == "serve_wifi_form" else (Reader(), "ssid", "password", "d", "url", "secret")
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(StopIteration):
                    call(*arguments)
                self.assertEqual(timeouts, [1000])

    def test_connectivity_check_uses_five_thousand_milliseconds(self):
        timeouts = []

        class Reader:
            def get_firmware_version(self): return (0x32, 1, 6, 0)
            def SAM_configuration(self): pass
            def read_passive_target(self, *, timeout):
                timeouts.append(timeout)
                return None

        class SPI:
            def __init__(self, *args, **kwargs): pass
            def readinto(self, buffer): buffer[:] = b"\x01" * len(buffer)

        namespace = {"time": PollClock(), "machine": types.SimpleNamespace(Pin=Pin, SPI=SPI),
                     "nfc": types.SimpleNamespace(PN532=lambda *args: Reader())}
        check = load_functions("check_connectivity.py", "check_nfc", "NFC_TEST_TIMEOUT_MS", namespace)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(check())
        self.assertEqual(timeouts, [5000])


if __name__ == "__main__":
    unittest.main()
