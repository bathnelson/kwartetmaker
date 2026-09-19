#!/usr/bin/env python3
"""Kleine lokale webserver voor de Kwartetmaker.

    python3 serve.py <map> [--port 4177] [--cert certificaat.pem] [--lan]

Met --cert serveert hij https (nodig voor Safari, dat http weigert), anders
http. Zonder --lan luistert hij alleen op deze computer.
"""
import argparse
import functools
import http.server
import os
import socket
import ssl
import subprocess
import sys


def local_hostname():
    """Bonjour-naam van deze Mac, bijv. JouwMac.local."""
    try:
        name = subprocess.run(["scutil", "--get", "LocalHostName"],
                              capture_output=True, text=True, timeout=5).stdout.strip()
        if name:
            return name + ".local"
    except Exception:
        pass
    return socket.gethostname()


def lan_addresses():
    addrs = []
    for iface in ("en0", "en1", "en2"):
        try:
            ip = subprocess.run(["ipconfig", "getifaddr", iface],
                                capture_output=True, text=True, timeout=5).stdout.strip()
            if ip and ip not in addrs:
                addrs.append(ip)
        except Exception:
            pass
    return addrs


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # Deze server kan geen php draaien. Zonder deze afscherming zou hij
        # api.php en config.php als platte tekst uitserveren - met wachtwoord
        # en al - aan iedereen in het netwerk.
        pad = self.path.split("?")[0].lower()
        if (pad.endswith(".php") or pad.startswith(("/data/", "/vimexx/"))
                or pad in ("/data", "/vimexx")):
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def end_headers(self):
        # Tijdens het bouwen geen oude versies uit de browsercache.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description="Lokale server voor de Kwartetmaker")
    ap.add_argument("directory")
    ap.add_argument("--port", type=int, default=4177)
    ap.add_argument("--cert", default=None, help="pem-bestand met sleutel en certificaat")
    ap.add_argument("--lan", action="store_true", help="ook bereikbaar voor andere computers")
    args = ap.parse_args()

    directory = args.directory
    if not os.path.isabs(directory):
        directory = os.path.abspath(directory)

    bind = "0.0.0.0" if args.lan else "127.0.0.1"
    handler = functools.partial(Handler, directory=directory)
    httpd = http.server.ThreadingHTTPServer((bind, args.port), handler)

    scheme = "http"
    if args.cert and os.path.exists(args.cert):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert)
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"

    print(f"Kwartetmaker draait op {scheme}://localhost:{args.port}/")
    if args.lan:
        for target in [local_hostname()] + lan_addresses():
            print(f"  andere computer: {scheme}://{target}:{args.port}/")
    print("Sluit dit venster (of Ctrl-C) om te stoppen.\n", flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nGestopt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
