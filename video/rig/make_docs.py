"""David's October documents (C04, 2026-10) for the video, drawn by demo/render_docs.py itself:
the clean sheet, the phone photo the client sends, and the shaky photo of the bank statement."""
import json, sys, shutil, tempfile
from pathlib import Path
REPO = Path(__import__('os').environ.get('NELIO_REPO', Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(REPO / 'demo'))
import render_docs as rd
from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/docs')
OUT.mkdir(parents=True, exist_ok=True)
seed = json.loads(rd.SEED.read_text())
w = rd.World(seed)
c = w.clients['C04']
def up(t, n, variant, quality='ok', when='2026-11-11T09:14:00+02:00'):
    return {'asset': f'C04/2026-10/{t}_{n:02d}.jpg', 'upload_id': f'2026-10_C04_{t}_{n:02d}', 'client_id': 'C04',
            'item_id': f'2026-10_C04_{t}', 'uploaded_at': when, 'seq': n, 'mime_type': 'image/jpeg', 'original_name': '',
            'doc': {'type': t, 'format': 'jpg', 'month': '2026-10', 'part': 1, 'parts': 1, 'quality': quality, 'source': 'camera', 'kind': '', 'variant': variant}}
plan = [('ISSUED_INVOICES', up('ISSUED_INVOICES', 1, 41001)), ('EXPENSE_RECEIPTS', up('EXPENSE_RECEIPTS', 1, 41002)),
        ('BANK_STATEMENT', up('BANK_STATEMENT', 1, 41003))]
work = Path(tempfile.mkdtemp())
(work / 'fonts.css').write_text(rd.font_css())
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=rd.CHROME, args=['--allow-file-access-from-files'])
    pg = b.new_context(viewport={'width': 900, 'height': 1200}, device_scale_factor=1.6).new_page()
    for t, u in plan:
        html, shape = rd.DRAW[t](w, c, u)
        rd.check(html, u)
        (work / 'doc.html').write_text(html)
        pg.goto((work / 'doc.html').as_uri()); pg.evaluate('document.fonts.ready')
        png = pg.locator('.tape' if shape == 'tape' else '.sheet').screenshot()
        (OUT / f'{t}_sheet.png').write_bytes(png)
        rng = rd.R(u['upload_id'], 'photo', u['doc']['variant'])
        (OUT / f'{t}_photo.jpg').write_bytes(rd.phone_photo(png, rng, shape, 'ok', None, False))
        if t == 'BANK_STATEMENT':
            rng = rd.R(u['upload_id'], 'photo-shaky', 7)
            (OUT / f'{t}_photo_blurry.jpg').write_bytes(rd.phone_photo(png, rng, shape, 'blur', None, False))
            rng = rd.R(u['upload_id'], 'photo-again', 8)
            (OUT / f'{t}_photo_retake.jpg').write_bytes(rd.phone_photo(png, rng, shape, 'ok', None, False))
    b.close()
shutil.rmtree(work)
print(sorted(x.name for x in OUT.iterdir()))
