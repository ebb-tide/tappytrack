"""Small HTTPS POST transport for taps; returns status without reading a body.

Setup and response I/O use separate absolute deadlines. MicroPython's native
DNS lookup cannot be interrupted here; the watchdog remains its last resort.
"""
import errno
import socket
import ssl
import time


class RequestError(OSError):
    def __init__(self, message, safe_to_retry=False):
        super().__init__(message)
        self.safe_to_retry = safe_to_retry


def _remaining(deadline):
    remaining = time.ticks_diff(deadline, time.ticks_ms())
    if remaining <= 0:
        raise OSError("HTTP deadline exceeded")
    return remaining


def _io(stream, operation, value, deadline):
    while True:
        _remaining(deadline)
        try:
            result = getattr(stream, operation)(value)
            if result is not None:
                return result
        except OSError as error:
            if error.args[0] not in (errno.EAGAIN, getattr(errno, "EWOULDBLOCK", errno.EAGAIN)):
                raise
        time.sleep_ms(min(10, _remaining(deadline)))


def post_status(url, payload, headers, deadline, response_timeout_ms=None,
                on_request_sent=None):
    """Use a ticks_ms setup deadline for connect, TLS and request writes.

    After writing the request, call on_request_sent (used to feed the watchdog)
    and start a fresh response deadline. Without response_timeout_ms, the setup
    deadline also covers the response for compatibility with direct callers.

    Retry is safe only before any HTTP bytes could have reached the server.
    A lost response after sending a tap must not trigger duplicate playback.
    """
    raw = None
    stream = None
    request_started = False
    phase = "setup"
    phase_started_ms = time.ticks_ms()
    try:
        parts = url.split("/", 3)
        if parts[0] != "https:" or len(parts) < 3 or not parts[2]:
            raise ValueError("Tap endpoint must use HTTPS")
        authority = parts[2]
        host = authority
        port = 443
        if ":" in authority:
            host, port = authority.rsplit(":", 1)
            port = int(port)
        path = "/" + parts[3] if len(parts) == 4 else "/"
        body = payload.encode("utf-8") if isinstance(payload, str) else payload
        lines = ["POST %s HTTP/1.1" % path, "Host: " + authority,
                 "Connection: close", "Content-Length: %d" % len(body)]
        for key, value in headers.items():
            if "\r" in key + value or "\n" in key + value:
                raise ValueError("Invalid HTTP header")
            lines.append(key + ": " + value)
        request = ("\r\n".join(lines) + "\r\n\r\n").encode("utf-8") + body

        _remaining(deadline)
        address = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)[0]
        raw = socket.socket(address[0], socket.SOCK_STREAM, address[2])
        raw.settimeout(_remaining(deadline) / 1000)
        raw.connect(address[-1])
        _remaining(deadline)

        # Defer the TLS handshake and drive it through nonblocking reads/writes
        # so a handshake or a slowly trickling response cannot reset the timer.
        raw.setblocking(False)
        if hasattr(ssl, "SSLContext"):
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.verify_mode = ssl.CERT_NONE  # Same policy as urequests.
            stream = context.wrap_socket(raw, server_hostname=host,
                                         do_handshake_on_connect=False)
        else:
            stream = ssl.wrap_socket(raw, server_hostname=host, do_handshake=False)

        sent = 0
        while sent < len(request):
            # A partial write or a lost response makes delivery ambiguous.
            request_started = True
            written = _io(stream, "write", memoryview(request)[sent:], deadline)
            if not written:
                raise OSError("Connection closed while sending tap")
            sent += written

        # TLS setup on a Pico can consume much of the original deadline. AWS
        # only starts processing once the HTTP request arrives, so give its
        # response its own bounded wait and reset the watchdog between phases.
        _remaining(deadline)
        if on_request_sent:
            on_request_sent()
        phase = "response"
        phase_started_ms = time.ticks_ms()
        if response_timeout_ms is not None:
            deadline = time.ticks_add(phase_started_ms, response_timeout_ms)

        response = b""
        while b"\r\n\r\n" not in response:
            chunk = _io(stream, "read", 256, deadline)
            if not chunk:
                raise OSError("Connection closed before HTTP response")
            response += chunk
            if len(response) > 4096:
                raise OSError("HTTP response headers too large")
        _remaining(deadline)
        status = response.split(b"\r\n", 1)[0].split()
        if len(status) < 2 or not status[0].startswith(b"HTTP/"):
            raise ValueError("Invalid HTTP response")
        status_code = int(status[1])
        if not 200 <= status_code <= 599:
            raise ValueError("Unexpected HTTP status")
        return status_code
    except Exception as error:
        elapsed = time.ticks_diff(time.ticks_ms(), phase_started_ms)
        raise RequestError("HTTP %s failed after %d ms: %s" % (phase, elapsed, error),
                           safe_to_retry=not request_started)
    finally:
        for resource in (stream, raw):
            if resource is not None:
                try:
                    resource.close()
                except OSError:
                    pass
