"""Small HTTPS POST transport for taps; returns status without reading a body.

All socket I/O shares one absolute deadline. MicroPython's native DNS lookup
cannot be interrupted here; the hardware watchdog remains its last resort.
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


def post_status(url, payload, headers, deadline):
    """Use a ticks_ms deadline, including connect, TLS, writes and headers.

    Retry is safe only before any HTTP bytes could have reached the server.
    A lost response after sending a tap must not trigger duplicate playback.
    """
    raw = None
    stream = None
    request_started = False
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
        raise RequestError(str(error), safe_to_retry=not request_started)
    finally:
        for resource in (stream, raw):
            if resource is not None:
                try:
                    resource.close()
                except OSError:
                    pass
