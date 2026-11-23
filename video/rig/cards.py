"""The 21 black cards of the trailer (project/video-script.md, draft 3), the Nelio title, the phone
frame and the paper pile, drawn by Chrome at 3840 × 2160 (4K, so a slow push-in stays sharp).

    python3 cards.py OUT_FOLDER

Each card comes twice: on black (cards/NN.png) and as text only on a transparent background
(cards/NN_text.png), for an edit that animates the words over its own black."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'cards').resolve()
FS = HERE / 'node_modules/@fontsource'  # npm install (package.json)

CARDS = [
    'כל חודש.', 'אותו בלגן.', 'ואין תשובה.', 'עד עכשיו.', 'התזכורת יוצאת לבד.', 'רק מה שחסר.', 'בלי סיסמה.',
    'בלי אפליקציה.', 'פחות משתי דקות.', 'והמשרד רואה מיד.', 'ואף פעם לא בשבת.', 'כל קובץ במקום.', 'רגע.', 'לחיצה אחת.',
    'בלי אף שיחת טלפון.', 'עכשיו יש תשובה.', 'פחות בלגן.', 'תמיד יודעים איפה עומדים.', None,
    'מתאים גם לסוכני ביטוח,<br>יועצי משכנתאות ועורכי דין.', 'בקרוב, במשרד שלכם.',
]

FONTS = f"""
@font-face{{font-family:FRL;font-weight:700;src:url('{(FS / 'frank-ruhl-libre/files/frank-ruhl-libre-hebrew-700-normal.woff2').as_uri()}')}}
@font-face{{font-family:FRL;font-weight:400;src:url('{(FS / 'frank-ruhl-libre/files/frank-ruhl-libre-hebrew-400-normal.woff2').as_uri()}')}}
@font-face{{font-family:Bellefair;src:url('{(FS / 'bellefair/files/bellefair-latin-400-normal.woff2').as_uri()}')}}
@font-face{{font-family:BellefairHe;src:url('{(FS / 'bellefair/files/bellefair-hebrew-400-normal.woff2').as_uri()}')}}
"""
INK = '#F3EDE2'      # warm white: the brand's "paper", on black
BASE = FONTS + f"""
html,body{{margin:0;width:1920px;height:1080px;overflow:hidden}}
body{{background:#060606;display:flex;align-items:center;justify-content:center;direction:rtl}}
body.clear{{background:transparent}}
.line{{font-family:FRL;font-weight:700;color:{INK};font-size:112px;letter-spacing:.5px;text-align:center;line-height:1.35}}
.line.long{{font-size:82px}}
.small{{position:absolute;bottom:84px;left:0;right:0;text-align:center;font-family:FRL;font-weight:400;color:#9E978B;font-size:36px;letter-spacing:1px;direction:rtl}}
.title{{font-family:Bellefair;color:{INK};font-size:250px;letter-spacing:22px;line-height:1;padding-left:22px}}
.rule{{width:260px;height:1px;background:#6f6a62;margin:34px auto 26px}}
.sub{{font-family:FRL;font-weight:400;color:#B9B2A6;font-size:34px;letter-spacing:3px;text-align:center}}
"""


def card_html(text, clear=False, small=''):
    cls = 'line long' if text and len(text) > 30 else 'line'
    s = f'<div class="small">{small}</div>' if small else ''
    return f'<!doctype html><html lang="he"><head><meta charset="utf-8"><style>{BASE}</style></head><body class="{"clear" if clear else ""}"><div class="{cls}">{text}</div>{s}</body></html>'


def title_html(clear=False, sub=True):
    s = '<div class="rule"></div><div class="sub">איסוף המסמכים החודשי, אוטומטי</div>' if sub else ''
    return (f'<!doctype html><html lang="he"><head><meta charset="utf-8"><style>{BASE}</style></head><body class="{"clear" if clear else ""}">'
            f'<div style="text-align:center"><div class="title" dir="ltr">Nelio</div>{s}</div></body></html>')


PHONE_FRAME = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}
.ph{position:absolute;left:40px;top:40px;width:448px;height:960px;border-radius:58px;border:18px solid #101214;box-sizing:border-box;
 background:transparent;box-shadow:0 0 0 2px #2b2f33,0 30px 80px rgba(0,0,0,.45)}
.scr{position:absolute;left:58px;top:58px;width:412px;height:924px;border-radius:40px;background:#00ff00}
.cam{position:absolute;left:254px;top:70px;width:20px;height:20px;border-radius:50%;background:#0b0c0d}
.btn{position:absolute;width:5px;border-radius:3px;background:#1d2023}
</style></head><body style="width:528px;height:1040px">
<div class="scr" id="scr"></div><div class="ph"></div><div class="cam"></div>
<div class="btn" style="left:487px;top:250px;height:90px"></div><div class="btn" style="left:487px;top:360px;height:60px"></div>
</body></html>"""


def main():
    (OUT / 'cards').mkdir(parents=True, exist_ok=True)
    (OUT / 'frames').mkdir(parents=True, exist_ok=True)
    made = {}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = b.new_context(viewport={'width': 1920, 'height': 1080}, device_scale_factor=2).new_page()

        def render(html, path, clear=False):
            f = OUT / '_tmp.html'
            f.write_text(html, encoding='utf-8')
            pg.goto(f.as_uri())
            pg.evaluate('document.fonts.ready')
            pg.wait_for_timeout(150)
            pg.screenshot(path=str(path), omit_background=clear)
            f.unlink()

        for i, text in enumerate(CARDS, start=1):
            n = f'{i:02d}'
            if text is None:
                render(title_html(sub=False), OUT / 'cards' / f'{n}_nelio.png')
                render(title_html(clear=True, sub=False), OUT / 'cards' / f'{n}_nelio_text.png', clear=True)
                render(title_html(), OUT / 'cards' / f'{n}_nelio_with_line_alternative.png')
                made[n] = 'Nelio, in Bellefair (the font of the office logo). A proposal: there is no Nelio logo yet'
                continue
            small = 'Nelio · פרויקט הדגמה · משרד בדיוני' if i == 21 else ''
            render(card_html(text, small=small), OUT / 'cards' / f'{n}.png')
            render(card_html(text, clear=True, small=small), OUT / 'cards' / f'{n}_text.png', clear=True)
            made[n] = text.replace('<br>', ' ')
        # The phone frame: a generic phone (no brand), the screen in pure green (#00FF00) for keying,
        # and the screen box in the frame's pixels, so a screenshot can be scaled into it.
        f = OUT / '_tmp.html'
        f.write_text(PHONE_FRAME)
        pg2 = b.new_context(viewport={'width': 528, 'height': 1040}, device_scale_factor=3).new_page()
        pg2.goto(f.as_uri())
        pg2.screenshot(path=str(OUT / 'frames' / 'phone_frame_green_screen.png'), omit_background=True)
        pg2.evaluate("document.getElementById('scr').style.background='transparent'")
        pg2.screenshot(path=str(OUT / 'frames' / 'phone_frame.png'), omit_background=True)
        f.unlink()
        b.close()
    (OUT / 'frames' / 'phone_frame.json').write_text(json.dumps({
        'size': [1584, 3120], 'screen_box': [174, 174, 1236, 2772], 'screen_corner_radius': 120,
        'note': 'x, y, width, height in the PNG pixels. The phone shots are 1236 × 2772, the size of the screen: put them at x=174, y=174, under the frame; the frame hides their corners.'},
        indent=1), encoding='utf-8')
    (OUT / 'cards' / 'cards.json').write_text(json.dumps(made, ensure_ascii=False, indent=1), encoding='utf-8')
    print(len(made), 'cards ->', OUT)


if __name__ == '__main__':
    main()
