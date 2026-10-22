"""Extrai fotos e tabelas do "Manual Fotográfico IAN-AF.pdf" para o site.

Uso:  python tools/extract.py
Requer: pymupdf, pillow
Gera:  site/img/*.webp  e  site/data.js
"""
import glob
import io
import json
import re
import subprocess
import sys
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PDF = glob.glob(str(ROOT / "*.pdf"))[0]
OUT = ROOT / "site"
IMG = OUT / "img"
IMG.mkdir(parents=True, exist_ok=True)

doc = pymupdf.open(PDF)

CODE = r"MQA\d{3}[A-Z]?"
LETTERS = "ABCDEFGH"


def save_webp(img: Image.Image, name: str, width: int) -> str:
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    img.convert("RGB").save(IMG / f"{name}.webp", "WEBP", quality=80, method=6)
    return f"img/{name}.webp"


# ---------------------------------------------------------------- índice (p. 9–13)
# pdftotext -layout mantém o nome e o número da página na mesma linha
index_lines = subprocess.run(["pdftotext", "-layout", "-f", "9", "-l", "13", PDF, "-"],
                             capture_output=True, text=True, check=True).stdout.splitlines()
categories, series = [], []
current = None
for raw in index_lines:
    line = raw.strip()
    m = re.match(rf"^({CODE})\s+(.+?)\s+(\d+)$", line)
    if m:
        series.append({"code": m[1], "name": m[2].strip(), "page": int(m[3]),
                       "category": current})
        continue
    m = re.match(r"^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^\d]+?)\s+(\d+)$", line)
    # categorias ficam entre "I. Alimentos e receitas" (p. 14) e "II. Medidas caseiras" (p. 198)
    if m and 14 < int(m[2]) < 198 and not m[1].startswith("Tabela"):
        current = m[1].strip()
        categories.append(current)
if not series:
    sys.exit("índice não encontrado")

# ---------------------------------------------------------------- fotos das séries
# o índice do PDF tem alguns números de página errados: localizamos cada série
# pelo código no título da página (canto superior esquerdo)
title_page = {}
for pno in range(16, 198):
    for x0, y0, x1, y1, word, *_ in doc[pno - 1].get_text("words"):
        if y0 < 160 and re.fullmatch(CODE, word):
            title_page[word] = pno
for s in series:
    if s["code"] not in title_page:
        sys.exit(f"página de {s['code']} não encontrada")
    page = doc[title_page[s["code"]] - 1]
    labels = {}
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        m = re.fullmatch(rf"{re.escape(s['code'])}-([A-H])", word)
        if m:
            labels[m[1]] = (x0, y0)
    photos = {}
    for info in page.get_image_info(xrefs=True):
        bx0, by0, bx1, by1 = info["bbox"]
        # etiqueta logo abaixo da foto, alinhada à esquerda
        best = min(labels.items(),
                   key=lambda kv: abs(kv[1][0] - bx0) + abs(kv[1][1] - by1) * 2,
                   default=None)
        if best is None:
            continue
        letter = best[0]
        pix = pymupdf.Pixmap(doc, info["xref"])
        if pix.n - pix.alpha >= 4:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        photos[letter] = save_webp(img, f"{s['code']}-{letter}", 800)
    s["photos"] = [photos[k] for k in LETTERS if k in photos]
    # miniatura para a lista: a foto "C" (porção média típica, segundo o manual)
    mid = "C" if "C" in photos else sorted(photos)[len(photos) // 2]
    s["thumb"] = save_webp(Image.open(IMG / f"{s['code']}-{mid}.webp"), f"{s['code']}-thumb", 360)
    s["letters"] = [k for k in LETTERS if k in photos]


# ---------------------------------------------------------------- tabelas 1 e 2
def parse_weights(first: int, last: int) -> dict:
    out = {}
    for p in range(first, last + 1):
        rows = {}
        for x0, y0, x1, y1, word, *_ in doc[p - 1].get_text("words"):
            rows.setdefault(round((y0 + y1) / 2), []).append((x0, word))
        for y, words in rows.items():
            words.sort()
            if not re.fullmatch(CODE, words[0][1]):
                continue
            nums = [w for _, w in words[1:] if re.fullmatch(r"\d+", w)]
            out[words[0][1]] = [int(n) for n in nums]
    return out


total = parse_weights(206, 209)
edible = parse_weights(210, 213)

# ---------------------------------------------------------------- tabela 3
nut_rows = []
for p in range(214, 239):
    rows = {}
    for x0, y0, x1, y1, word, *_ in doc[p - 1].get_text("words"):
        rows.setdefault(round((y0 + y1) / 2), []).append((x0, word))
    for y in sorted(rows):
        words = sorted(rows[y])
        vals = [w for x, w in words if x > 180]
        codes = [w for x, w in words if x < 180 and re.fullmatch(CODE, w)]
        if len(vals) == 8 and vals[0] in LETTERS:
            nums = [float(v.replace(",", ".")) for v in vals[1:]]
            nut_rows.append({"letter": vals[0], "values": nums, "code": None, "page": p, "y": y})
        if codes:
            nut_rows.append({"letter": None, "code": codes[0], "page": p, "y": y})

# agrupa: cada "A" inicia uma nova série
groups = []
for r in nut_rows:
    if r["letter"] == "A":
        groups.append({"rows": [], "codes": [], "page": r["page"], "y0": r["y"]})
    if not groups:
        continue
    if r["letter"]:
        groups[-1]["rows"].append(r)
        groups[-1]["y1"] = r["y"]
# associa códigos (quando legíveis) ao grupo cuja faixa vertical os contém
for r in nut_rows:
    if r["code"]:
        for g in groups:
            if g["page"] == r["page"] and g["y0"] - 5 <= r["y"] <= g.get("y1", g["y0"]) + 5:
                g["codes"].append(r["code"])

order = list(total.keys())  # tabela 3 segue a mesma ordem da tabela 1
nutrition = {}
if len(groups) != len(order):
    print(f"AVISO: {len(groups)} grupos nutricionais vs {len(order)} séries", file=sys.stderr)
for code, g in zip(order, groups):
    if g["codes"] and code not in g["codes"]:
        print(f"AVISO: ordem diferente em {code}: {g['codes']}", file=sys.stderr)
    nutrition[code] = [r["values"] for r in g["rows"]]

# ---------------------------------------------------------------- medidas caseiras
measures = []
mc_page_words = {}
for x0, y0, x1, y1, word, *_ in doc[239 - 1].get_text("words"):
    mc_page_words.setdefault(round((y0 + y1) / 2), []).append((x0, word))
mc_current = None
mc_items = {}
for y in sorted(mc_page_words):
    words = sorted(mc_page_words[y])
    texts = [w for _, w in words]
    code = next((w for w in texts if re.fullmatch(r"MC\d+", w)), None)
    letter = next((w for x, w in words if 150 < x < 180 and w in LETTERS), None)
    nums = [int(w) for x, w in words if x > 340 and w.isdigit()]
    name = " ".join(w for x, w in words if 180 <= x < 340)
    if letter and len(nums) == 4:
        mc_items.setdefault("_pending", []).append({"letter": letter, "name": name, "ml": nums, "y": y})
    if code:
        mc_items.setdefault("_codes", []).append((y, code))
# associa cada linha ao código MC mais próximo verticalmente (o código fica centrado no bloco)
pending = mc_items.get("_pending", [])
codes_y = mc_items.get("_codes", [])
blocks = []
for row in pending:
    if row["letter"] == "A":
        blocks.append([])
    blocks[-1].append(row)
mc_table = {}
for b in blocks:
    ymid = (b[0]["y"] + b[-1]["y"]) / 2
    code = min(codes_y, key=lambda c: abs(c[0] - ymid))[1]
    mc_table[code] = [{"letter": r["letter"], "name": r["name"], "ml": r["ml"]} for r in b]

# fotos das medidas caseiras: renderiza a faixa entre um título e o seguinte,
# para incluir as letras e as marcas de fração desenhadas sobre a imagem
for p in range(199, 205):
    page = doc[p - 1]
    titles = []
    for block in page.get_text("blocks"):
        m = re.match(r"^(MC\d+)\s*[–-]\s*(.+)$", block[4].strip().replace("\n", " "))
        if m:
            titles.append((block[1], block[3], m[1], " ".join(m[2].split())))
    titles.sort()
    for i, (_, top, raw_code, name) in enumerate(titles):
        bottom = titles[i + 1][0] - 8 if i + 1 < len(titles) else 750  # acima do rodapé
        clip = pymupdf.Rect(80, top + 6, 515, bottom)
        pix = page.get_pixmap(clip=clip, dpi=200)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        # recorta a margem branca à volta da fotografia
        mask = img.convert("L").point(lambda v: 255 if v < 240 else 0)
        img = img.crop(mask.getbbox())
        code = "MC%02d" % int(raw_code[2:])
        measures.append({
            "code": code,
            "name": name,
            "photo": save_webp(img, code, 1100),
            "items": mc_table.get(code, []),
        })
measures.sort(key=lambda m: m["code"])

# ---------------------------------------------------------------- correções
# Gralhas do manual corrigidas com o acordo dos autores: (série, coluna, índice) -> valor
CORRECTIONS = {
    ("MQA020", "total", 1): 96,  # 60 g no manual, menos que o edível (95 g); valor da MQA021
    ("MQA031", "total", 1): 28,  # 142 g no manual para 20 g edíveis (~70% nas outras fotos)
    ("MQA032", "total", 1): 28,  # 200 g no manual, idem
    # MQA155: total c/ espeto < edível em B–D; a nutrição bate com o edível, por isso
    # corrige-se o total para edível + espeto (~2 g, pelas fotos A e E)
    ("MQA155", "total", 1): 91,  # 87 g no manual
    ("MQA155", "total", 2): 181,  # 173 g no manual
    ("MQA155", "total", 3): 275,  # 269 g no manual
}
# séries com linhas nas tabelas sem fotografia correspondente: ficam só as linhas com foto
TRUNCATE = {"MQA108"}  # Chop suey: tabelas A–F, fotos A–E

# ---------------------------------------------------------------- montagem
problems = []
for s in series:
    c = s["code"]
    s["total"] = total.get(c, [])
    s["edible"] = edible.get(c, [])
    s["nutrition"] = nutrition.get(c, [])
    n = len(s["photos"])
    if c in TRUNCATE:
        for key in ("total", "edible", "nutrition"):
            s[key] = s[key][:n]
    for (code, key, i), value in CORRECTIONS.items():
        if code == c:
            s[key][i] = value
    for key in ("total", "edible", "nutrition"):
        if len(s[key]) != n:
            problems.append(f"{c}: {n} fotos, {len(s[key])} valores em {key}")
    del s["page"]

data = {
    "categories": categories,
    "series": series,
    "measures": measures,
    "nutrients": [
        {"key": "kcal", "label": "Energia", "unit": "kcal"},
        {"key": "prot", "label": "Proteína", "unit": "g"},
        {"key": "hc", "label": "Hidratos de carbono", "unit": "g"},
        {"key": "acu", "label": "Açúcares", "unit": "g"},
        {"key": "gord", "label": "Gordura", "unit": "g"},
        {"key": "ags", "label": "Ácidos gordos saturados", "unit": "g"},
        {"key": "fibra", "label": "Fibra", "unit": "g"},
    ],
}
(OUT / "data.js").write_text(
    "// Gerado automaticamente por tools/extract.py a partir do manual IAN-AF.\n"
    "window.MQA_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print(f"{len(series)} séries, {len(categories)} categorias, {len(measures)} imagens de medidas caseiras")
print("\n".join(problems) or "sem inconsistências")
