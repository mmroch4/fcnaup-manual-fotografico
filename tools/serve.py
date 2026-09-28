"""Servidor local para desenvolvimento, com a mesma regra da Vercel:
rotas sem extensão (/serie/MQA001, /refeicao, …) devolvem site/index.html.

Uso:  python3 tools/serve.py [porta]     (por omissão 8000)
"""
import functools
import http.server
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if not Path(path).suffix and not (SITE / path.lstrip("/")).is_file():
            self.path = "/index.html"
        return super().send_head()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(SPAHandler, directory=str(SITE))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"A servir {SITE} em http://localhost:{port}")
        httpd.serve_forever()
