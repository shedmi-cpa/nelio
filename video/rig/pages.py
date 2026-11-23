"""The two phone screens that are not Nelio: a plain mail app and a camera. Both are generic (no
real brand), in Hebrew, and show only what the video needs. The emails inside them are the real
ones: the subject and body come from the local database, and renderEmail draws them."""
import html
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
PAGES = HERE / 'pages'
PAGES.mkdir(exist_ok=True)
REPO = Path(__import__('os').environ.get('NELIO_REPO', HERE.parents[1]))
OFFICE_NAME = "שדמי ושות', רואי חשבון"


def email_html(body, link='https://shedmi-cpa.github.io/nelio/#t=video'):
    out = subprocess.run(['node', '--experimental-transform-types', '--no-warnings', str(HERE / 'render_email.mjs')],
                         input=json.dumps({'body': body, 'link': link, 'officeName': OFFICE_NAME}),
                         capture_output=True, text=True, check=True, env={**__import__('os').environ, 'NELIO_REPO': str(REPO)})
    return out.stdout


MAIL_CSS = """
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:Heebo,Assistant,Arial,sans-serif;background:#fff;color:#1f1f1f;direction:rtl;overflow:hidden}
.bar{height:64px;display:flex;align-items:center;gap:14px;padding:0 16px;margin:10px 12px 4px;background:#eef1f5;border-radius:32px}
.bar .t{flex:1;font-size:17px;color:#5f6368}
.ico{width:24px;height:24px;flex:none}
.label{font-size:13px;color:#5f6368;padding:14px 22px 6px;font-weight:500}
.row{display:flex;gap:14px;padding:12px 18px 12px 16px;align-items:flex-start;background:#fff;position:relative}
.row .av{width:42px;height:42px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:19px}
.row .av img{width:42px;height:42px;border-radius:50%}
.row .tx{flex:1;min-width:0}
.row .top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.row .from{font-size:16.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .time{font-size:12.5px;color:#5f6368;white-space:nowrap}
.row .subj{font-size:15px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .snip{font-size:14px;color:#5f6368;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.row.unread .from,.row.unread .subj,.row.unread .time{font-weight:700;color:#1f1f1f}
.row.new{background:#e8f0fe}
.row.arrive{animation:arrive .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes arrive{from{transform:translateY(-100%);opacity:0}to{transform:none;opacity:1}}
.list.push{animation:push .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes push{from{transform:translateY(-78px)}to{transform:none}}
.fab{position:absolute;left:18px;bottom:26px;background:#c2e7ff;border-radius:16px;padding:16px 20px;font-size:15px;font-weight:600;display:flex;gap:10px;align-items:center}
.note{position:absolute;top:10px;left:10px;right:10px;background:#f2f2f2;border-radius:22px;padding:14px 16px;display:flex;gap:12px;
 box-shadow:0 6px 24px rgba(0,0,0,.18);animation:drop .6s cubic-bezier(.2,.8,.2,1) both}
.note img{width:38px;height:38px;border-radius:50%}
.note .a{font-size:13px;color:#5f6368}.note .b{font-size:15px;font-weight:700}.note .c{font-size:14px;color:#3c4043;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes drop{from{transform:translateY(-130%)}to{transform:none}}
.msg{height:100%;overflow:hidden}
.msg .head{display:flex;align-items:center;gap:18px;padding:16px 16px 6px}
.msg h1{font-size:22px;font-weight:500;margin:6px 20px 14px;line-height:1.35}
.msg .who{display:flex;gap:12px;align-items:center;padding:0 18px 12px}
.msg .who img{width:40px;height:40px;border-radius:50%}
.msg .who .n{font-size:15.5px;font-weight:700}.msg .who .d{font-size:13px;color:#5f6368}
.msg .body{padding:0 4px}
mark{color:inherit;padding:1px 3px;border-radius:3px;-webkit-box-decoration-break:clone;box-decoration-break:clone;
 background:linear-gradient(100deg,rgba(255,221,64,0) 0,rgba(255,221,64,.78) 4%,rgba(255,214,40,.72) 96%,rgba(255,221,64,0) 100%)}
"""

ICON_MENU = '<svg class="ico" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" stroke="#444" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
ICON_BACK = '<svg class="ico" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" stroke="#444" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
ICON_PEN = '<svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z" stroke="#1f1f1f" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>'
MARK = 'https://shedmi-cpa.github.io/nelio/brand/mark-circle-email.png'

# Ordinary, invented mail around the office's message, so the inbox looks lived in.
FILLER_DAVID = [
    ('נ', '#7b61a8', 'נתיב אנרגיה', 'הקבלה שלך מתחנת התדלוק', 'תודה שתדלקת אצלנו. הקבלה מצורפת.', '08:12'),
    ('ד', '#c2185b', 'דפוס תכלת', 'ההזמנה שלך מוכנה לאיסוף', 'הכרטיסים מוכנים, אפשר לאסוף מהיום.', 'אתמול'),
    ('ר', '#00796b', 'רוני ב.', 'המחשב הנייד', 'מעולה, תודה רבה! עובד כמו חדש.', 'אתמול'),
    ('ב', '#2e7d32', 'בנק תמר', 'הודעה חדשה באזור האישי', 'יש לך הודעה חדשה. לצפייה, היכנסו לאזור האישי.', '9 בנוב׳'),
    ('ע', '#ef6c00', 'עידו ש.', 'הצעת מחיר להתקנת רשת', 'היי דוד, אשמח להצעה לשלוש עמדות.', '8 בנוב׳'),
    ('א', '#455a64', 'אריזות נטע', 'מבצע סוף חודש', 'קלסרים ונייר בהנחה עד סוף החודש.', '7 בנוב׳'),
]
FILLER_OWNER = [
    ('מ', '#00796b', 'מירב סלעי', 'רשימת טלפונים להיום: אוקטובר', 'שלום עמית, היום תאריך היעד של אוקטובר.', 'אתמול'),
    ('ל', '#7b61a8', 'לשכת רואי החשבון', 'כנס מקצועי בדצמבר', 'ההרשמה לכנס השנתי נפתחה.', 'אתמול'),
    ('א', '#ef6c00', 'אסף מורג', 'שאלה על דוח שנתי', 'עמית, יש לך דקה מחר בבוקר?', '11 בנוב׳'),
    ('ת', '#c2185b', 'תוכנת החשבוניות', 'עדכון גרסה', 'הגרסה החדשה זמינה. מה חדש?', '10 בנוב׳'),
    ('ב', '#2e7d32', 'בנק תמר', 'הודעה חדשה באזור האישי', 'יש לך הודעה חדשה. לצפייה, היכנסו לאזור האישי.', '9 בנוב׳'),
]


def _row(av, color, sender, subj, snip, time, cls=''):
    a = f'<div class="av" style="background:{color}">{html.escape(av)}</div>' if av != 'mark' else f'<div class="av"><img src="{MARK}"></div>'
    return (f'<div class="row {cls}">{a}<div class="tx"><div class="top"><span class="from">{html.escape(sender)}</span>'
            f'<span class="time">{html.escape(time)}</span></div><div class="subj">{html.escape(subj)}</div>'
            f'<div class="snip">{html.escape(snip)}</div></div></div>')


def inbox(name, subject, snippet, time='09:00', owner=False, arriving=False, notification=False, with_new=True):
    """The inbox. arriving: the office's mail slides in at the top. notification: a banner, too."""
    filler = FILLER_OWNER if owner else FILLER_DAVID
    rows = ''.join(_row(*f) for f in filler)
    new = _row('mark', '', OFFICE_NAME if not owner else 'Nelio · ' + OFFICE_NAME, subject, snippet, time,
               'unread new' + (' arrive' if arriving else '')) if with_new else ''
    note = (f'<div class="note"><img src="{MARK}"><div style="min-width:0"><div class="a">דואר · עכשיו</div>'
            f'<div class="b">{html.escape(OFFICE_NAME)}</div><div class="c">{html.escape(subject)}</div></div></div>') if notification else ''
    page = (f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo"><style>{MAIL_CSS}</style></head><body>'
            f'<div class="bar">{ICON_MENU}<span class="t">חיפוש בדואר</span></div><div class="label">דואר נכנס</div>'
            f'<div class="list{" push" if arriving else ""}">{new}{rows}</div>'
            f'<div class="fab">{ICON_PEN}כתיבה</div>{note}</body></html>')
    (PAGES / name).write_text(page, encoding='utf-8')
    return name


def message(name, subject, body_html, time='09:00', owner=False, highlight=None):
    """One open message. highlight: a phrase in the body to mark with a highlighter."""
    if highlight:
        body_html = body_html.replace(html.escape(highlight), '<mark>' + html.escape(highlight) + '</mark>', 1)
    to = 'אל: עמית' if owner else 'אל: דוד'
    page = (f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo"><style>{MAIL_CSS}</style></head><body><div class="msg">'
            f'<div class="head">{ICON_BACK}</div><h1>{html.escape(subject)}</h1>'
            f'<div class="who"><img src="{MARK}"><div><div class="n">{html.escape(OFFICE_NAME)}</div><div class="d">{to} · {html.escape(time)}</div></div></div>'
            f'<div class="body">{body_html}</div></div></body></html>')
    (PAGES / name).write_text(page, encoding='utf-8')
    return name


CAMERA_CSS = """
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:Heebo,Arial,sans-serif}
.view{position:absolute;top:70px;bottom:190px;left:0;right:0;overflow:hidden}
.view img{width:100%;height:100%;object-fit:cover;transform:scale(1.04)}
.grid{position:absolute;inset:0;background:
 linear-gradient(to right,transparent 33.2%,rgba(255,255,255,.28) 33.3%,transparent 33.5%,transparent 66.5%,rgba(255,255,255,.28) 66.6%,transparent 66.8%),
 linear-gradient(to bottom,transparent 33.2%,rgba(255,255,255,.28) 33.3%,transparent 33.5%,transparent 66.5%,rgba(255,255,255,.28) 66.6%,transparent 66.8%)}
.shake img{animation:shake .35s steps(2) infinite}
@keyframes shake{0%{transform:scale(1.04) translate(0,0) rotate(0)}25%{transform:scale(1.05) translate(-9px,6px) rotate(-.8deg)}
 50%{transform:scale(1.04) translate(7px,-5px) rotate(.6deg)}75%{transform:scale(1.05) translate(-5px,-7px) rotate(-.4deg)}}
.bottom{position:absolute;bottom:0;left:0;right:0;height:190px;display:flex;align-items:center;justify-content:space-around}
.shutter{width:78px;height:78px;border-radius:50%;border:5px solid #fff;display:flex;align-items:center;justify-content:center}
.shutter i{display:block;width:60px;height:60px;border-radius:50%;background:#fff}
.press .shutter i{transform:scale(.86);background:#ddd}
.thumb{width:48px;height:48px;border-radius:10px;background:#333 center/cover;border:2px solid #fff}
.flip{width:48px;height:48px;border-radius:50%;background:#2a2a2a}
.modes{position:absolute;bottom:160px;left:0;right:0;text-align:center;color:#ccc;font-size:14px;letter-spacing:.5px}
.modes b{color:#ffd54f;font-weight:600;margin:0 14px}
.flash{position:absolute;inset:0;background:#fff;opacity:0}
.flashing .flash{animation:flash .35s ease-out both}
@keyframes flash{0%{opacity:.95}100%{opacity:0}}
"""


def camera(name, photo_url, thumb_url='', state=''):
    """state: '' (looking), 'press' (finger on the button), 'flashing', 'shake' (hand moving)."""
    page = (f'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<style>{CAMERA_CSS}</style></head><body class="{state}"><div class="view {"shake" if state == "shake" else ""}"><img src="{photo_url}"><div class="grid"></div></div>'
            f'<div class="modes">וידאו<b>תמונה</b>פורטרט</div><div class="bottom"><div class="flip"></div><div class="shutter"><i></i></div>'
            f'<div class="thumb" style="background-image:url(\'{thumb_url}\')"></div></div><div class="flash"></div></body></html>')
    (PAGES / name).write_text(page, encoding='utf-8')
    return name
