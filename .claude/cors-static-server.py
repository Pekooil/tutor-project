#!/usr/bin/env python3
# CORS-enabling static file server, used only for Task 10's real-page no-leak
# harness (serving the built extension/dist/chrome-mv3 bundle so a real
# third-party page's fetch() of the content-script stylesheet isn't blocked
# by CORS, mirroring how a real chrome-extension:// origin is always
# fetchable cross-origin). Not part of the shipped product.
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8935
    HTTPServer(("127.0.0.1", port), CORSRequestHandler).serve_forever()
