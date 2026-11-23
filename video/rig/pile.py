"""A messy pile of the month's papers on a wooden desk (Act 1), drawn from the demo documents
themselves (demo/render_docs.py), seen from above. 3840 × 2160, for a slow push-in.
Every paper is a demo document marked "לדוגמה". No hands: stock with real hands can replace it.

    python3 pile.py OUT.png"""
import json
import math
import random
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

REPO = Path(__import__('os').environ.get('NELIO_REPO', Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(REPO / 'demo'))
import render_docs as rd  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'pile.png')
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 3840, 2160
seed = json.loads(rd.SEED.read_text())
w = rd.World(seed)
types = ['EXPENSE_RECEIPTS', 'FUEL_RECEIPTS', 'Z_REPORTS', 'SUPPLIER_INVOICES', 'ISSUED_INVOICES', 'BANK_STATEMENT', 'CREDIT_CARD']
picked, seen = [], set()
for u in seed['uploads']:
    k = (u['doc']['type'], u['client_id'])
    if u['doc']['type'] in types and k not in seen and not u['duplicate_of'] and u['request_id'].startswith('2026-09'):
        seen.add(k)
        picked.append(u)
random.Random(4).shuffle(picked)
picked = picked[:26]

work = Path(tempfile.mkdtemp())
(work / 'fonts.css').write_text(rd.font_css())
sheets = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=rd.CHROME, args=['--allow-file-access-from-files'])
    pg = b.new_context(viewport={'width': 900, 'height': 1200}, device_scale_factor=1.3).new_page()
    for u in picked:
        html, shape = rd.DRAW[u['doc']['type']](w, w.clients[u['client_id']], u)
        (work / 'doc.html').write_text(html)
        pg.goto((work / 'doc.html').as_uri())
        pg.evaluate('document.fonts.ready')
        f = work / f"{u['upload_id']}.png"
        pg.locator('.tape' if shape == 'tape' else '.sheet').screenshot(path=str(f))
        sheets.append((Image.open(f).convert('RGBA'), shape))
    b.close()

rng = random.Random(11)
desk = rd.surface(random.Random(3), W, H).convert('RGBA')
# darker edges, like a desk lamp in the middle
vign = Image.new('L', (W // 8, H // 8))
for y in range(H // 8):
    for x in range(W // 8):
        d = math.hypot((x - W / 16) / (W / 16), (y - H / 16) / (H / 16))
        vign.putpixel((x, y), int(255 * max(0.0, min(1.0, 1 - 0.55 * d ** 1.6))))
vign = vign.resize((W, H), Image.BICUBIC)
black = Image.new('RGBA', (W, H), (0, 0, 0, 255))
desk = Image.composite(desk, black, vign)
for img, shape in sheets:
    scale = rng.uniform(1.05, 1.35) if shape == 'tape' else rng.uniform(0.95, 1.2)
    img = img.resize((int(img.width * scale), int(img.height * scale)))
    img = img.rotate(rng.uniform(-38, 38), expand=True, resample=Image.BICUBIC)
    a = img.split()[3]
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    shadow.putalpha(a.point(lambda v: int(v * 0.45)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    cx = int(W / 2 + rng.gauss(0, W * 0.17))
    cy = int(H / 2 + rng.gauss(0, H * 0.15))
    x, y = cx - img.width // 2, cy - img.height // 2
    desk.alpha_composite(shadow, (x + 14, y + 22)) if 0 <= x + 14 and 0 <= y + 22 else desk.paste(shadow, (x + 14, y + 22), shadow)
    desk.paste(img, (x, y), img)
desk.convert('RGB').save(OUT, quality=92)
shutil.rmtree(work)
print('pile ->', OUT)
