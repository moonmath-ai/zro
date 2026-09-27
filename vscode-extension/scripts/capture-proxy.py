#!/usr/bin/env python3
"""Local capture proxy for the ZRO VS Code Copilot extension.

Sits between the extension and the real ZRO endpoint, logging every request
body and response (streamed or not) to scripts/capture-log.jsonl, so you can
see exactly what Copilot sends to the model and what the model returns.

Usage
-----
1. Start this proxy:
       python3 scripts/capture-proxy.py
   (or:  ZRO_ENDPOINT_ROOT_OVERRIDE=https://zro.moonmath.ai python3 scripts/capture-proxy.py)

2. In the shell/VS Code you launch the extension from, set:
       ZRO_ENDPOINT_ROOT=http://127.0.0.1:8787
   so the extension's BASE_URL / CATALOG_URL point here.

3. Reload the VS Code window (Developer: Reload Window) so the extension
   re-reads ZRO_ENDPOINT_ROOT, then use Kimi K3 in Copilot Chat.

4. Inspect scripts/capture-log.jsonl — one JSON object per request, with
   `request` (method, path, headers, body) and `response` (status, headers,
   raw body, and parsed SSE events if the body was an event stream).

Non-streaming JSON responses are logged whole. Streaming SSE responses are
re-emitted to the client chunk-for-chunk while they are also captured into a
buffer; the full reassembled event list is logged once the stream ends. So
the client still sees real streaming behavior, and you get the full transcript.

Auth headers are passed through unchanged. The proxy needs the real ZRO_API_KEY
to be set in its environment (it forwards whatever the extension sends, but
reading ZRO_API_KEY here lets you run it standalone for testing too).

This is a debugging tool only — it listens on 127.0.0.1, does no TLS, and
logs request bodies (which may contain your prompts). Delete the log file
when you're done.
"""
import http.server
import json
import os
import socketserver
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

UPSTREAM = os.environ.get(
    "ZRO_ENDPOINT_ROOT_OVERRIDE", "https://zro.moonmath.ai"
).rstrip("/")
BIND = os.environ.get("CAPTURE_BIND", "127.0.0.1:8787")
LOG_FILE = Path(__file__).resolve().parent / "capture-log.jsonl"

# Request headers we do not forward to upstream (hop-by-hop / connection-specific).
# Everything else is passed through verbatim, including Authorization.
DROP_REQUEST_HEADERS = {
    "host",
    "content-length",  # recomputed by urllib for the new body
    "connection",
    "accept-encoding",  # let urllib handle encoding so we can read the body
    "transfer-encoding",
}

# Response headers we do not copy back to the client (hop-by-hop / encoding).
DROP_RESPONSE_HEADERS = {
    "content-length",  # may differ once we buffer/re-emit
    "connection",
    "transfer-encoding",
    "content-encoding",  # we decode the body before logging/re-emitting
    "accept-ranges",
}


def log_entry(record):
    record["ts"] = datetime.now(timezone.utc).isoformat()
    with LOG_FILE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        fh.flush()
    # Also echo a one-line summary to stdout so the terminal shows activity.
    status = record.get("response", {}).get("status", "?")
    path = record.get("request", {}).get("path", "?")
    model = ""
    body = record.get("request", {}).get("body")
    if isinstance(body, dict):
        model = f" model={body.get('model')!r}"
    stream = record.get("response", {}).get("streamed", False)
    print(f"[{record['ts']}] {path} -> {status} (stream={stream}){model}")


def safe_json(text):
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def parse_sse(raw_text):
    """Split an SSE body into event dicts (data lines parsed as JSON when possible)."""
    events = []
    for block in raw_text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event = {"raw": block}
        data_lines = []
        for line in block.splitlines():
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if data_lines:
            joined = "\n".join(data_lines)
            event["data"] = joined
            if joined == "[DONE]":
                event["done"] = True
            else:
                parsed = safe_json(joined)
                if parsed is not None:
                    event["json"] = parsed
        events.append(event)
    return events


class CaptureHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Silence default access logging; we log our own structured record.
        pass

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            return self.rfile.read(length)
        return b""

    def _forward(self, method):
        body = self._read_body()

        # Parse request body for logging (and to detect streaming).
        req_body_text = None
        req_body_json = None
        if body:
            req_body_text = body.decode("utf-8", errors="replace")
            req_body_json = safe_json(req_body_text)

        # Build the upstream request, forwarding headers minus the dropped set.
        url = UPSTREAM + self.path
        up_headers = {}
        for key, value in self.headers.items():
            if key.lower() not in DROP_REQUEST_HEADERS:
                up_headers[key] = value

        req = urllib.request.Request(
            url, data=body if body else None, method=method, headers=up_headers
        )

        try:
            resp = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:
            resp = e
        except urllib.error.URLError as e:
            self._send_error_record(method, req_body_json, req_body_text, str(e.reason))
            return
        except Exception as e:  # noqa: BLE001 - surface any upstream failure
            self._send_error_record(method, req_body_json, req_body_text, repr(e))
            return

        status = resp.status
        resp_headers = resp.headers
        content_type = resp_headers.get("Content-Type", "")
        is_stream = "text/event-stream" in content_type.lower()

        # Build response headers to send back (minus hop-by-hop/encoding).
        out_headers = []
        for key, value in resp_headers.items():
            if key.lower() not in DROP_RESPONSE_HEADERS:
                out_headers.append((key, value))

        if is_stream:
            self._stream_response(resp, method, req_body_json, req_body_text, status, out_headers)
        else:
            raw = resp.read()
            self._send_non_stream(raw, method, req_body_json, req_body_text, status, out_headers, content_type)

    def _send_non_stream(self, raw, method, req_body_json, req_body_text, status, out_headers, content_type):
        text = raw.decode("utf-8", errors="replace")
        # Send the body back to the client.
        self.send_response(status)
        for key, value in out_headers:
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

        resp_record = {
            "status": status,
            "headers": dict(out_headers),
            "content_type": content_type,
            "streamed": False,
            "body_text": text,
            "body_json": safe_json(text),
        }
        log_entry({
            "request": {
                "method": method,
                "path": self.path,
                "headers": dict(self.headers),
                "body": req_body_json if req_body_json is not None else req_body_text,
            },
            "response": resp_record,
        })

    def _stream_response(self, resp, method, req_body_json, req_body_text, status, out_headers):
        """Re-emit SSE chunks to the client while buffering the full body for logging."""
        self.send_response(status)
        for key, value in out_headers:
            self.send_header(key, value)
        # Chunked-ish: we flush per chunk; no Content-Length on a stream.
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        collected = bytearray()
        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                collected.extend(chunk)
                # Write as an HTTP/1.1 chunk.
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                self.wfile.flush()
            # Terminating zero-length chunk.
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # Client disconnected; we still log what we collected.
            pass

        raw_text = collected.decode("utf-8", errors="replace")
        resp_record = {
            "status": status,
            "headers": dict(out_headers),
            "streamed": True,
            "body_text": raw_text,
            "sse_events": parse_sse(raw_text),
        }
        # If the stream was actually JSON error (not SSE), surface parsed JSON too.
        parsed = safe_json(raw_text)
        if parsed is not None:
            resp_record["body_json"] = parsed

        log_entry({
            "request": {
                "method": method,
                "path": self.path,
                "headers": dict(self.headers),
                "body": req_body_json if req_body_json is not None else req_body_text,
            },
            "response": resp_record,
        })

    def _send_error_record(self, method, req_body_json, req_body_text, reason):
        body_text = json.dumps(
            {"error": {"message": f"capture proxy: upstream unreachable: {reason}"}}
        ).encode()
        self.send_response(502)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_text)))
        self.end_headers()
        self.wfile.write(body_text)
        log_entry({
            "request": {
                "method": method,
                "path": self.path,
                "headers": dict(self.headers),
                "body": req_body_json if req_body_json is not None else req_body_text,
            },
            "response": {
                "status": 502,
                "streamed": False,
                "error": reason,
                "body_text": body_text.decode(),
            },
        })

    def do_GET(self):
        self._forward("GET")

    def do_POST(self):
        self._forward("POST")

    def do_PUT(self):
        self._forward("PUT")

    def do_DELETE(self):
        self._forward("DELETE")

    def do_PATCH(self):
        self._forward("PATCH")


class ThreadingHTTPServer(
    socketserver.ThreadingMixIn, http.server.HTTPServer
):
    daemon_threads = True


def main():
    host, _, port = BIND.rpartition(":")
    host = host or "127.0.0.1"
    port = int(port or 8787)

    # Start each run with a fresh log so you're not swimming in old captures.
    if LOG_FILE.exists():
        LOG_FILE.unlink()

    server = ThreadingHTTPServer((host, port), CaptureHandler)
    print(f"capture-proxy: listening on http://{host}:{port} -> {UPSTREAM}")
    print(f"capture-proxy: logging to {LOG_FILE}")
    print("capture-proxy: set ZRO_ENDPOINT_ROOT=http://127.0.0.1:8787 in the")
    print("               environment that launches VS Code, then reload the window.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\ncapture-proxy: shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
