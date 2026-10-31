"""Temporary transport for an owner-authorized, already-rooted webOS TV.

Use only to establish SSH. Telnet sends everything unencrypted.
"""
import re
import secrets
import socket
import sys
import time


def run(host, command, timeout=30):
    marker = "OWNTV_" + secrets.token_hex(12)
    with socket.create_connection((host, 23), timeout=5) as sock:
        sock.settimeout(1)
        # Refuse Telnet options; the remote shell remains a plain byte stream.
        initial = sock.recv(4096)
        for verb, option in re.findall(b"\xff([\xfb-\xfe])(.)", initial):
            sock.sendall(b"\xff" + (b"\xfc" if verb == b"\xfd" else b"\xfe") + option)
        import base64
        encoded = base64.b64encode(command.encode()).decode()
        wire = "stty -echo; echo '%s' | base64 -d | /bin/sh; printf '\\n%s:%%s\\n' \"$?\"\r\n" % (encoded, marker)
        sock.sendall(wire.encode())
        output = b""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                continue
            if not chunk:
                break
            output += chunk
            match = re.search(rb"\r?\n" + marker.encode() + rb":(\d+)\r?\n", output)
            if match:
                # Strip the terminal echo (it contains base64, not results).
                text = output[:match.start()].decode("utf-8", "replace")
                lines = text.splitlines()
                start = next((i + 1 for i, line in enumerate(lines) if marker in line), 0)
                return int(match.group(1)), "\n".join(lines[start:]).strip()
        raise TimeoutError("TV did not return a command completion marker")


if __name__ == "__main__":
    status, output = run(sys.argv[1], sys.stdin.read())
    print(output)
    sys.exit(status)
