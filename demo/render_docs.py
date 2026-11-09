#!/usr/bin/env python3
"""Nelio · demo documents (stage 4.1, D37).

Draws one file for every upload in demo/seed.json (1,024 files for 1,025 uploads: one
upload is the same photo sent twice): bank statements, credit card statements,
Z reports, invoices, receipts, fuel receipts, employee hours and letters. Every document is in
Hebrew, marked "לדוגמה", and uses only invented names and hidden numbers (rules.md, D34).

- The text is laid out as HTML and drawn by Chrome (Playwright): a PDF for a "download", and a
  picture for a "camera" or "whatsapp" upload. A picture becomes a phone photo: a table under
  the paper, a small angle, a shadow, uneven light. A "blurry" upload is blurred, too dark or
  cut, according to the reason the office wrote when it rejected it.
- Deterministic: every document draws its numbers from its client, month and variant, so the
  same seed.json always gives the same files, byte for byte, and the two pages of one statement
  match. A PDF carries the time of its upload, not the time it was drawn.
- The result is a folder with the same paths as the "asset" fields (C07/2026-10/...). It goes
  to the demo-assets branch, where seedDemoFiles in apps-script/Seed.gs reads it.

Setup (once):  cd demo/fonts && npm install        (the fonts: Heebo, Assistant, Frank Ruhl
               Libre and Miriam Libre, all under the SIL Open Font License)
               pip install playwright pillow numpy
Run:           python3 demo/render_docs.py --out ../demo-assets
               python3 demo/render_docs.py --out /tmp/sample --only C07 --limit 10
"""

import argparse
import hashlib
import io
import json
import math
import multiprocessing
import os
import random
import re
import shutil
import sys
import tempfile
from datetime import date, timedelta
from html import escape
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
SEED = HERE / 'seed.json'
FONTS = HERE / 'fonts' / 'node_modules' / '@fontsource'
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')

VAT = 0.18
MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט',
             'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
DAYS_HE = ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון']

# ----------------------------------------------------------------------------------------------
# Invented names. Checked by web search on 9/11/2026: none of them is a bank, card company,
# fuel chain or supplier we could find (decisions.md). Everything else is a generic description.
# ----------------------------------------------------------------------------------------------
BANK = 'בנק תמר'
CARD_ISSUERS = ['כרטיסי שחר', 'כרטיסי נגה']
FUEL_CHAIN = 'נתיב אנרגיה'
SUPPLIERS = {
    'food': [('קמחית הפצה', ['קמח לבן 25 ק״ג', 'שמרים טריים', 'סוכר 25 ק״ג', 'שמן קנולה 18 ל׳',
                             'שומשום 5 ק״ג', 'מרגרינה לאפייה']),
             ('סלסלת הגליל', ['עגבניות', 'מלפפונים', 'בצל יבש', 'תפוחי אדמה', 'פטרוזיליה',
                              'לימונים', 'פלפל אדום']),
             ('מקרר הצפון', ['גבינה צהובה פרוסה', 'חלב 3% קרטון', 'שמנת לבישול', 'ביצים L תבנית',
                             'חמאה 200 גר׳', 'גבינה לבנה 5%']),
             ('אריזות נטע', ['קופסאות אריזה 1 ל׳', 'שקיות נייר', 'מפיות מודפסות', 'כוסות קרטון 8oz',
                             'נייר אפייה גליל'])],
    'retail': [('אריזות נטע', ['שקיות נשיאה ממותגות', 'נייר עטיפה', 'קופסאות מתנה', 'מדבקות מחיר',
                               'גליל קופה תרמי']),
               ('דפוס תכלת', ['שלט חלון מודפס', 'כרטיסי ביקור 500 יח׳', 'פליירים A5', 'מדבקות לוגו'])],
    'build': [('אבן וסיד חומרי בניין', ['מלט 25 ק״ג', 'בלוק 10', 'חול מחצבה (קוב)', 'דבק קרמיקה',
                                         'פרופיל גבס', 'לוח גבס ירוק']),
              ('רקפת צנרת', ['צינור PEX 16 מ״מ', 'ברז כדורי 1/2', 'מחבר T', 'סיפון לכיור',
                             'ניאגרה סמויה', 'סרט טפלון']),
              ('השכרת כלים גלבוע', ['השכרת פטישון – יום', 'השכרת פיגום נייד – שבוע',
                                    'השכרת מערבל בטון – יום', 'השכרת מקדחת יהלום – יום'])],
}
EXPENSE_VENDORS = [
    ('דפוס תכלת', ['הדפסה צבעונית', 'כריכה', 'כרטיסי ביקור', 'סריקה']),
    ('אריזות נטע', ['קלסרים', 'נייר A4 (חבילה)', 'מעטפות', 'טונר למדפסת']),
    (FUEL_CHAIN, ['בנזין 95']),
]
CITIES = ['עפולה', 'חדרה', 'כרמיאל', 'רחובות', 'נתניה', 'מודיעין', 'באר שבע', 'פתח תקווה',
          'ראשון לציון', 'חולון', 'אשדוד', 'קריית גת', 'טבריה', 'נוף הגליל', 'רמלה', 'הרצליה',
          'כפר סבא', 'אריאל', 'בית שמש', 'יקנעם']
FIRST_NAMES = ['נועה', 'דניאל', 'מאיה', 'איתן', 'יעל', 'עומר', 'שירה', 'אורי', 'תמר', 'אלון',
               'רוני', 'הילה', 'נדב', 'ליאור', 'אביגיל', 'עידו', 'מעיין', 'יונתן', 'ענבל', 'אסף']
SURNAMES = ['ב.', 'כ.', 'ל.', 'מ.', 'ש.', 'ר.', 'ג.', 'ד.', 'א.', 'פ.']

# What each business sells, by a word in its name (issued invoices).
SERVICES = [
    ('אימון', [('אימון אישי – 4 מפגשים', 450, 1600), ('תוכנית אימון חודשית', 600, 1800)]),
    ('מחשב', [('תיקון מחשב נייד', 250, 700), ('התקנת רשת משרדית', 600, 2400), ('שירות תחזוקה חודשי', 400, 900)]),
    ('גינון', [('אחזקת גינה חודשית', 450, 1200), ('שתילה ועבודות גינון', 800, 3500)]),
    ('טיולים', [('הדרכת טיול יומי לקבוצה', 1500, 4200)]),
    ('צילום', [('צילום אירוע', 2500, 7500), ('צילום מוצרים – יום עבודה', 1800, 4200)]),
    ('איטום', [('איטום גג', 3500, 14000), ('תיקון רטיבות', 900, 3200)]),
    ('משכנתאות', [('ליווי משכנתא – שלב א׳', 2500, 6000)]),
    ('חשמל', [('עבודות חשמל לפי הצעת מחיר', 900, 8000), ('החלפת לוח חשמל', 2500, 6500)]),
    ('מנעולן', [('פריצת דלת והחלפת צילינדר', 350, 900)]),
    ('אינסטלציה', [('תיקון נזילה', 350, 1200), ('החלפת צנרת בחדר רחצה', 2500, 7500)]),
    ('וידאו', [('עריכת סרטון תדמית', 1800, 5500)]),
    ('הפקות', [('הפקת אירוע', 4500, 18000)]),
    ('אנרגיה', [('סקר אנרגיה למבנה', 2200, 6500)]),
    ('נגרי', [('ארון מטבח לפי מידה', 6000, 22000), ('תיקון רהיטים', 400, 1500)]),
    ('מיזוג', [('התקנת מזגן', 900, 2600), ('ניקוי ותחזוקת מזגנים', 300, 900)]),
    ('אדריכלות', [('תכנון אדריכלי – שלב', 5500, 25000)]),
    ('מכשירי חשמל', [('תיקון מכונת כביסה', 250, 750)]),
    ('צבע', [('צביעת דירה', 3500, 9000)]),
    ('מתמטיקה', [('שיעורים פרטיים – 8 שעות', 1000, 1600)]),
    ('מסגרי', [('שער ברזל לפי מידה', 3500, 12000), ('ריתוך ותיקונים', 400, 1600)]),
    ('כתיבה', [('כתיבת תוכן לאתר', 1200, 4500)]),
    ('תרגומים', [('תרגום מסמך', 400, 2400)]),
    ('ייעוץ', [('ייעוץ עסקי – ריטיינר חודשי', 3000, 9000)]),
    ('שיפוצים', [('שיפוץ חדר רחצה', 9000, 28000), ('עבודות שיפוץ', 2500, 9000)]),
    ('מדידות', [('מדידה ותשריט', 1800, 5200)]),
    ('רשתות', [('ניהול רשתות חברתיות – חודש', 2200, 5500)]),
    ('דוד שמש', [('התקנת דוד שמש', 2800, 5800), ('החלפת גוף חימום', 350, 650)]),
    ('תוכנה', [('פיתוח תוכנה – שעות עבודה', 6000, 24000)]),
    ('ריצוף', [('ריצוף לפי מ״ר', 3500, 16000)]),
    ('גבס', [('עבודות גבס', 2200, 9000)]),
    ('סטודיו', [('עיצוב גרפי – פרויקט', 1500, 6000)]),
    ('הובלות', [('הובלת דירה', 1800, 6500), ('הובלה מסחרית', 900, 3200)]),
    ('בונים', [('עבודות שלד – חשבון חלקי', 25000, 90000)]),
]


def R(*parts):
    """A random generator that always gives the same numbers for the same parts."""
    return random.Random('|'.join(str(p) for p in parts))


def money(x):
    return f'{x:,.2f}'


def ddmmyyyy(d):
    return f'{d.day:02d}/{d.month:02d}/{d.year}'


def month_days(month):
    y, m = map(int, month.split('-'))
    first = date(y, m, 1)
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return [first + timedelta(i) for i in range((nxt - first).days)]


def month_name(month):
    y, m = map(int, month.split('-'))
    return f'{MONTHS_HE[m - 1]} {y}'


def hidden(rng, prefix='XXXX'):
    """D34: the middle of every number is hidden, only four digits are shown."""
    return f'{prefix}-{rng.randint(1000, 9999)}'


class World:
    """Everything a document needs to know about its client, built once."""

    def __init__(self, seed):
        self.holidays = {date.fromisoformat(h['date']) for h in seed['holidays']}
        self.items = {i['item_id']: i for i in seed['items']}
        self.clients = {c['client_id']: self._client(c) for c in seed['clients']}
        self.names = [c['business_name'] for c in seed['clients']]

    def workdays(self, month, friday=True):
        return [d for d in month_days(month)
                if d.weekday() != 5 and d not in self.holidays and (friday or d.weekday() != 4)]

    def _client(self, c):
        rng = R(c['client_id'], 'client')
        name = c['business_name']
        kind = 'build' if c['profile_id'] == 'CONTRACTOR' else (
            'food' if any(w in name for w in ['מאפ', 'פיצה', 'קפה', 'אטליז', 'מסעדת', 'מכולת', 'ירקות',
                                               'סופר', 'מעדני', 'שווארמה', 'דגי', 'חומוס', 'קונדיטור',
                                               'קיוסק']) else 'retail')
        services = next((s for w, s in SERVICES if w in name), [('שירות לפי הצעת מחיר', 800, 4500)])
        scale = {'CASH_REGISTER': rng.uniform(60000, 260000), 'SERVICE': rng.uniform(18000, 70000),
                 'CONTRACTOR': rng.uniform(40000, 180000)}[c['profile_id']]
        staff = []
        if c['has_employees']:
            for i in range(rng.randint(2, 5)):
                staff.append(f'{rng.choice(FIRST_NAMES)} {rng.choice(SURNAMES)}')
        return {
            **c,
            'kind': kind,
            'city': rng.choice(CITIES),
            'tax_id': hidden(rng, 'XXXXX'),
            'id_label': 'ח.פ.' if c['legal_type'] == 'company' else 'עוסק מורשה',
            'branch': (rng.randint(110, 980), rng.choice(CITIES)),
            'account': hidden(rng),
            'issuer': rng.choice(CARD_ISSUERS),
            'card': rng.randint(1000, 9999),
            'scale': scale,
            'services': services,
            'staff': staff,
            'opening': rng.uniform(4000, 60000),
        }


# ----------------------------------------------------------------------------------------------
# Page parts
# ----------------------------------------------------------------------------------------------

def font_css():
    css = []
    for family, weights in [('heebo', [400, 500, 700]), ('assistant', [400, 600, 700]),
                            ('frank-ruhl-libre', [400, 700]), ('miriam-libre', [400, 700])]:
        base = FONTS / family
        for w in weights:
            text = (base / f'{w}.css').read_text()
            css.append(text.replace('url(./files/', f'url({(base / "files").as_uri()}/'))
    return '\n'.join(css)


BASE_CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { direction: rtl; font-family: 'Heebo', sans-serif; color: #1d1d1f; font-size: 11.5px; }
.num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
.sheet { width: 794px; min-height: 1123px; padding: 46px 52px 70px; position: relative;
         overflow: hidden; background: #fff; }
.mark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
        pointer-events: none; z-index: 5; }
.mark span { transform: rotate(-32deg); font: 700 150px 'Heebo'; color: rgba(190, 30, 45, .07);
             letter-spacing: 6px; white-space: nowrap; }
.sheet .mark { position: absolute; }
.demo-note { position: absolute; bottom: 26px; left: 52px; right: 52px; text-align: center;
             font-size: 9.5px; color: #9a1b28; border-top: 1px solid #e5c4c8; padding-top: 6px; }
@media print { .demo-note { position: fixed; bottom: 14px; } }
table { width: 100%; border-collapse: collapse; }
th { text-align: right; font-weight: 600; }
h1 { font-size: 20px; font-weight: 700; }
h2 { font-size: 14px; font-weight: 600; }
.muted { color: #6b6b70; }
.right { text-align: left; }
"""

DEMO_NOTE = 'מסמך לדוגמה · כל השמות והמספרים בדויים · נוצר עבור הדגמה של Nelio'


def page(body, extra_css='', title='מסמך לדוגמה'):
    return (f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">'
            f'<title>{escape(title)}</title><link rel="stylesheet" href="fonts.css">'
            f'<style>{BASE_CSS}{extra_css}</style></head><body>{body}</body></html>')


def sheet(inner, cls=''):
    return (f'<div class="sheet {cls}"><div class="mark"><span>לדוגמה</span></div>{inner}'
            f'<div class="demo-note">{DEMO_NOTE}</div></div>')


def tape(inner, width=300):
    return (f'<div class="tape" style="width:{width}px">{inner}'
            f'<div class="t-c t-sep">*** לדוגמה · מסמך בדוי ***</div></div>')


TAPE_CSS = """
body { background: transparent; }
.tape { background: #fbfaf6; padding: 18px 16px 26px; font-family: 'Miriam Libre', monospace;
        font-size: 12.5px; color: #2b2b2b; line-height: 1.45; }
.t-c { text-align: center; }
.t-b { font-weight: 700; }
.t-big { font-size: 15px; font-weight: 700; }
.t-row { display: flex; justify-content: space-between; gap: 8px; }
.t-sep { border-top: 1px dashed #777; margin-top: 7px; padding-top: 7px; }
.t-dim { color: #555; font-size: 11.5px; }
"""


def header_block(c):
    return (f'<div class="party"><div class="t-b" style="font-weight:700">{escape(c["business_name"])}</div>'
            f'<div class="muted">{c["id_label"]} <span class="num">{c["tax_id"]}</span> · {c["city"]}</div></div>')


# ----------------------------------------------------------------------------------------------
# The documents. Each function returns (html, shape): shape is "a4" or "tape".
# ----------------------------------------------------------------------------------------------

def bank_transactions(w, c, month):
    rng = R(c['client_id'], 'bank', month)
    days = w.workdays(month)
    rows = []
    s = c['scale']
    n = rng.randint(16, 26)
    for _ in range(n):
        d = rng.choice(days)
        r = rng.random()
        if c['profile_id'] == 'CASH_REGISTER' and r < 0.35:
            rows.append((d, 'הפקדת מזומן', 0, round(s * rng.uniform(.02, .06), -1)))
        elif r < 0.55:
            rows.append((d, f'זיכוי {rng.choice(CARD_ISSUERS)} – מכירות', 0, round(s * rng.uniform(.03, .09), 2)))
        elif r < 0.68:
            payer = rng.choice([x for x in w.names if x != c['business_name']])
            rows.append((d, f'העברה מ{payer}', 0, round(s * rng.uniform(.01, .05), 2)))
        elif r < 0.78:
            sup = rng.choice(SUPPLIERS[c['kind'] if c['kind'] in SUPPLIERS else 'retail'])[0]
            rows.append((d, f'העברה ל{sup}', round(s * rng.uniform(.02, .08), 2), 0))
        elif r < 0.84:
            rows.append((d, 'הוראת קבע – ביטוח עסק', round(rng.uniform(180, 690), 2), 0))
        elif r < 0.88:
            rows.append((d, 'עמלת ניהול חשבון', round(rng.uniform(25, 70), 2), 0))
        elif r < 0.92:
            rows.append((d, 'משיכת מזומן – כספומט', round(rng.choice([500, 1000, 1500, 2000]), 2), 0))
        elif r < 0.96:
            rows.append((d, 'ביטוח לאומי – תשלום', round(rng.uniform(600, 2900), 2), 0))
        else:
            rows.append((d, 'מע״מ – תשלום', round(s * rng.uniform(.03, .08), 2), 0))
    # The card company's monthly charge, on the 10th or the next workday
    tenth = next(d for d in days if d.day >= 10)
    rows.append((tenth, f'חיוב {c["issuer"]} – כרטיס {c["card"]}', round(s * rng.uniform(.03, .1), 2), 0))
    rows.sort(key=lambda x: x[0])
    opening = round(c['opening'] * R(c['client_id'], 'open', month).uniform(.7, 1.4), 2)
    bal = opening
    out = []
    for d, desc, debit, credit in rows:
        bal = round(bal - debit + credit, 2)
        out.append({'date': d, 'desc': desc, 'ref': rng.randint(10000, 99999), 'debit': debit,
                    'credit': credit, 'bal': bal})
    return opening, out


BANK_CSS = """
body { font-family: 'Assistant', sans-serif; font-size: 12px; }
.bank-top { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 3px solid #1f5f5b; padding-bottom: 14px; margin-bottom: 16px; }
.bank-logo { display: flex; align-items: center; gap: 10px; }
.bank-logo .dot { width: 38px; height: 38px; border-radius: 50%; background: #1f5f5b; color: #fff;
                  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px; }
.bank-logo .name { font-size: 22px; font-weight: 700; color: #1f5f5b; }
.meta td { padding: 2px 0 2px 18px; }
.tx { margin-top: 14px; }
.tx th { background: #e6efee; color: #1f3f3d; padding: 6px 6px; font-size: 11.5px; }
.tx td { padding: 5px 6px; border-bottom: 1px solid #eceff0; }
.tx td.n, .tx th.n { text-align: left; }
.summary { margin-top: 16px; display: flex; gap: 18px; justify-content: flex-end; }
.summary div { background: #f4f7f7; padding: 8px 14px; border-radius: 6px; }
.pageno { position: absolute; top: 20px; left: 52px; font-size: 10.5px; color: #777; }
"""


def doc_bank(w, c, u):
    d = u['doc']
    month = d['month']
    opening, tx = bank_transactions(w, c, month)
    part, parts = d.get('part') or 1, d.get('parts') or 1
    if parts > 1:
        half = math.ceil(len(tx) / 2)
        shown = tx[:half] if part == 1 else tx[half:]
        start_bal = opening if part == 1 else tx[half - 1]['bal']
    else:
        shown, start_bal = tx, opening
    days = month_days(month)
    rows = ''.join(
        f'<tr><td class="num">{ddmmyyyy(t["date"])}</td><td>{escape(t["desc"])}</td>'
        f'<td class="num">{t["ref"]}</td><td class="n num">{money(t["debit"]) if t["debit"] else ""}</td>'
        f'<td class="n num">{money(t["credit"]) if t["credit"] else ""}</td><td class="n num">{money(t["bal"])}</td></tr>'
        for t in shown)
    last = part == parts
    summary = ''
    if last:
        summary = (f'<div class="summary"><div>יתרת פתיחה: <b class="num">{money(opening)} ₪</b></div>'
                   f'<div>סה״כ חובה: <b class="num">{money(sum(t["debit"] for t in tx))} ₪</b></div>'
                   f'<div>סה״כ זכות: <b class="num">{money(sum(t["credit"] for t in tx))} ₪</b></div>'
                   f'<div>יתרת סגירה: <b class="num">{money(tx[-1]["bal"])} ₪</b></div></div>')
    inner = f"""
<div class="pageno">עמוד {part} מתוך {parts}</div>
<div class="bank-top">
  <div class="bank-logo"><div class="dot">ת</div><div><div class="name">{BANK}</div>
  <div class="muted">סניף {c['branch'][1]} ({c['branch'][0]})</div></div></div>
  <div style="text-align:left"><h1>דף חשבון עו״ש</h1><div class="muted">חשבון עסקי</div></div>
</div>
<table class="meta" style="width:auto"><tr><td>בעל החשבון:</td><td><b>{escape(c['business_name'])}</b></td></tr>
<tr><td>מספר חשבון:</td><td class="num">{c['account']}</td></tr>
<tr><td>תקופה:</td><td><span class="num">{ddmmyyyy(days[0])}</span> – <span class="num">{ddmmyyyy(days[-1])}</span></td></tr>
<tr><td>יתרה בתחילת העמוד:</td><td class="num">{money(start_bal)} ₪</td></tr></table>
<table class="tx"><thead><tr><th>תאריך</th><th>תיאור הפעולה</th><th>אסמכתא</th><th class="n">חובה</th>
<th class="n">זכות</th><th class="n">יתרה</th></tr></thead><tbody>{rows}</tbody></table>
{summary}
<div class="muted" style="margin-top:22px;font-size:10.5px">הופק באתר הבנק בתאריך <span class="num">{ddmmyyyy(days[-1] + timedelta(R(c['client_id'], month).randint(1, 6)))}</span></div>
"""
    return page(sheet(inner), BANK_CSS), 'a4'


CARD_CSS = """
.card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.issuer { font-size: 24px; font-weight: 700; letter-spacing: .5px; }
.issuer.shachar { color: #c2410c; } .issuer.noga { color: #4338ca; }
.box { border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; margin-bottom: 14px;
       display: flex; justify-content: space-between; }
.box b { font-size: 15px; }
.ch th { border-bottom: 2px solid #333; padding: 6px 4px; }
.ch td { padding: 6px 4px; border-bottom: 1px solid #eee; }
.ch td.n, .ch th.n { text-align: left; }
.total { margin-top: 14px; text-align: left; font-size: 15px; }
"""

CARD_MERCHANTS = {
    'food': ['מקרר הצפון', 'אריזות נטע', 'קמחית הפצה', 'סלסלת הגליל', FUEL_CHAIN, 'חשבון חשמל – עסק',
             'שירות תוכנת קופה – מנוי', 'אינטרנט ותקשורת – עסק'],
    'retail': ['אריזות נטע', 'דפוס תכלת', FUEL_CHAIN, 'פרסום ממומן ברשת', 'אינטרנט ותקשורת – עסק',
               'אחסון אתר – מנוי שנתי', 'חשבון חשמל – עסק'],
    'build': ['אבן וסיד חומרי בניין', 'רקפת צנרת', 'השכרת כלים גלבוע', FUEL_CHAIN,
              'אינטרנט ותקשורת – עסק', 'ביגוד עבודה', 'חניון – תשלום חניה'],
}
SERVICE_MERCHANTS = ['דפוס תכלת', 'אריזות נטע', FUEL_CHAIN, 'אחסון ענן – מנוי חודשי',
                     'תוכנת חשבוניות – מנוי', 'אינטרנט ותקשורת – עסק', 'חניון – תשלום חניה',
                     'פרסום ממומן ברשת', 'בית קפה – פגישת עבודה']


def doc_card(w, c, u):
    month = u['doc']['month']
    rng = R(c['client_id'], 'card', month)
    merchants = SERVICE_MERCHANTS if c['profile_id'] == 'SERVICE' else CARD_MERCHANTS[c['kind']]
    days = w.workdays(month)
    rows = []
    for _ in range(rng.randint(7, 18)):
        amt = round(rng.uniform(40, 900) * (1 + c['scale'] / 120000), 2)
        inst = ''
        if amt > 900 and rng.random() < .35:
            k = rng.randint(2, 6)
            inst = f'תשלום {rng.randint(1, k)} מתוך {k}'
            amt = round(amt / k, 2)
        rows.append((rng.choice(days), rng.choice(merchants), inst or 'רגילה', amt))
    rows.sort()
    y, m = map(int, month.split('-'))
    charge = date(y + (m == 12), m % 12 + 1, 10)
    total = sum(r[3] for r in rows)
    cls = 'shachar' if c['issuer'] == 'כרטיסי שחר' else 'noga'
    body = ''.join(f'<tr><td class="num">{ddmmyyyy(d)}</td><td>{escape(mr)}</td><td>{escape(t)}</td>'
                   f'<td class="n num">{money(a)}</td></tr>' for d, mr, t, a in rows)
    inner = f"""
<div class="card-top"><div class="issuer {cls}">{c['issuer']}</div>
<div style="text-align:left"><h1>פירוט חיובים חודשי</h1><div class="muted">כרטיס עסקי</div></div></div>
<div class="box"><div>שם בעל הכרטיס<br><b>{escape(c['business_name'])}</b></div>
<div>כרטיס המסתיים ב-<br><b class="num">{c['card']}</b></div>
<div>חודש העסקאות<br><b>{month_name(month)}</b></div>
<div>מועד החיוב<br><b class="num">{ddmmyyyy(charge)}</b></div></div>
<table class="ch"><thead><tr><th>תאריך עסקה</th><th>שם בית העסק</th><th>סוג עסקה</th><th class="n">סכום חיוב (₪)</th></tr></thead>
<tbody>{body}</tbody></table>
<div class="total">סה״כ לחיוב ב-<span class="num">{ddmmyyyy(charge)}</span>: <b class="num">{money(total)} ₪</b></div>
<div class="muted" style="margin-top:8px">החיוב ירד מחשבון {BANK}, חשבון <span class="num">{c['account']}</span></div>
"""
    return page(sheet(inner), CARD_CSS), 'a4'


def z_days(w, c, month):
    rng = R(c['client_id'], 'z', month)
    days = w.workdays(month)
    daily = c['scale'] / max(len(days), 1)
    z0 = R(c['client_id'], 'z0').randint(1200, 4800) + (int(month[5:]) - 8) * 26
    out = []
    for i, d in enumerate(days):
        total = round(daily * rng.uniform(.6, 1.35) * (.55 if d.weekday() == 4 else 1), 2)
        credit = round(total * rng.uniform(.55, .8), 2)
        out.append({'z': z0 + i, 'date': d, 'total': total, 'credit': credit, 'cash': round(total - credit, 2),
                    'count': int(total / rng.uniform(45, 120)) + 1})
    return out


Z_CSS = """
.z th { background: #f1f1f1; padding: 5px; border-bottom: 1px solid #ccc; font-size: 11px; }
.z td { padding: 4px 5px; border-bottom: 1px solid #f0f0f0; font-size: 11px; }
.z td.n, .z th.n { text-align: left; }
.z tfoot td { font-weight: 700; border-top: 2px solid #333; }
"""


def doc_z(w, c, u):
    d = u['doc']
    days = z_days(w, c, d['month'])
    if d['format'] == 'pdf':
        body = ''.join(
            f'<tr><td class="num">{z["z"]}</td><td class="num">{ddmmyyyy(z["date"])}</td><td>{DAYS_HE[z["date"].weekday()]}</td>'
            f'<td class="n num">{z["count"]}</td><td class="n num">{money(z["cash"])}</td><td class="n num">{money(z["credit"])}</td>'
            f'<td class="n num">{money(z["total"] - z["total"] / (1 + VAT))}</td><td class="n num">{money(z["total"])}</td></tr>'
            for z in days)
        tot = sum(z['total'] for z in days)
        inner = f"""
<div style="display:flex;justify-content:space-between;margin-bottom:16px">{header_block(c)}
<div style="text-align:left"><h1>ריכוז דוחות Z</h1><div class="muted">{month_name(d['month'])} · הופק ממערכת הקופה</div></div></div>
<table class="z"><thead><tr><th>מס׳ Z</th><th>תאריך</th><th>יום</th><th class="n">עסקאות</th><th class="n">מזומן</th>
<th class="n">אשראי</th><th class="n">מע״מ כלול</th><th class="n">סה״כ מכירות</th></tr></thead><tbody>{body}</tbody>
<tfoot><tr><td colspan="4">סה״כ לחודש ({len(days)} ימי עבודה)</td><td class="n num">{money(sum(z['cash'] for z in days))}</td>
<td class="n num">{money(sum(z['credit'] for z in days))}</td><td class="n num">{money(tot - tot / (1 + VAT))}</td>
<td class="n num">{money(tot)}</td></tr></tfoot></table>
"""
        return page(sheet(inner), Z_CSS), 'a4'
    # A photo of the printed tape: the days of this part of the month, then the totals
    part, parts = d.get('part') or 1, d.get('parts') or 1
    size = math.ceil(len(days) / parts)
    shown = days[(part - 1) * size: part * size]
    lines = ''.join(
        f'<div class="t-row"><span>Z <span class="num">{z["z"]}</span> · <span class="num">{z["date"].day:02d}/{z["date"].month:02d}</span></span>'
        f'<span class="num">{money(z["total"])}</span></div>' for z in shown)
    tot = sum(z['total'] for z in shown)
    inner = f"""
<div class="t-c t-big">{escape(c['business_name'])}</div>
<div class="t-c t-dim">{c['id_label']} <span class="num">{c['tax_id']}</span></div>
<div class="t-c t-dim">{c['city']}</div>
<div class="t-c t-b t-sep">דוח Z מצטבר · {month_name(d['month'])}</div>
<div class="t-c t-dim">חלק {part} מתוך {parts}</div>
<div class="t-sep">{lines}</div>
<div class="t-sep t-row"><span>מזומן</span><span class="num">{money(sum(z['cash'] for z in shown))}</span></div>
<div class="t-row"><span>אשראי</span><span class="num">{money(sum(z['credit'] for z in shown))}</span></div>
<div class="t-row"><span>מע״מ <span class="num">18%</span></span><span class="num">{money(tot - tot / (1 + VAT))}</span></div>
<div class="t-row t-big t-sep"><span>סה״כ</span><span class="num">{money(tot)}</span></div>
"""
    return page(tape(inner), TAPE_CSS), 'tape'


INV_CSS = """
.inv-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
.seller-name { font-size: 22px; font-weight: 700; }
.doc-title { font-size: 19px; font-weight: 700; text-align: left; }
.to { background: #f6f6f6; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; }
.lines th { border-bottom: 2px solid #222; padding: 7px 5px; }
.lines td { padding: 7px 5px; border-bottom: 1px solid #eee; }
.lines td.n, .lines th.n { text-align: left; }
.sums { width: 260px; margin: 16px auto 0 0; }
.sums td { padding: 4px 0; } .sums td.n { text-align: left; }
.sums tr.t td { font-weight: 700; font-size: 15px; border-top: 2px solid #222; padding-top: 6px; }
.pay { margin-top: 20px; font-size: 11px; }
"""


def invoice_html(seller_name, seller_meta, title, number, when, to_name, lines, pay=''):
    body = ''.join(f'<tr><td>{escape(name)}</td><td class="n num">{q:g}</td><td class="n num">{money(p)}</td>'
                   f'<td class="n num">{money(q * p)}</td></tr>' for name, q, p in lines)
    net = sum(q * p for _, q, p in lines)
    vat = round(net * VAT, 2)
    inner = f"""
<div class="inv-top"><div><div class="seller-name">{escape(seller_name)}</div><div class="muted">{seller_meta}</div></div>
<div><div class="doc-title">{title}</div><div class="muted" style="text-align:left">מספר <b class="num">{number}</b></div>
<div class="muted" style="text-align:left">תאריך <span class="num">{ddmmyyyy(when)}</span></div></div></div>
<div class="to">לכבוד: <b>{escape(to_name)}</b></div>
<table class="lines"><thead><tr><th>תיאור</th><th class="n">כמות</th><th class="n">מחיר ליחידה</th><th class="n">סה״כ (₪)</th></tr></thead>
<tbody>{body}</tbody></table>
<table class="sums"><tr><td>סה״כ לפני מע״מ</td><td class="n num">{money(net)}</td></tr>
<tr><td>מע״מ <span class="num">18%</span></td><td class="n num">{money(vat)}</td></tr>
<tr class="t"><td>סה״כ לתשלום</td><td class="n num">{money(net + vat)} ₪</td></tr></table>
<div class="pay muted">{pay}</div>
<div class="muted" style="margin-top:30px;font-size:10.5px">מסמך ממוחשב · הופק בתוכנת חשבוניות</div>
"""
    return page(sheet(inner), INV_CSS)


EXTRAS = ['חומרים ואביזרים', 'נסיעות', 'שעת עבודה נוספת', 'הובלה ופינוי']


def customer(rng, w, c):
    if rng.random() < .55:
        return rng.choice([x for x in w.names if x != c['business_name']])
    return f'{rng.choice(FIRST_NAMES)} {rng.choice(SURNAMES)} (לקוח פרטי)'


def issued_list(w, c, month):
    rng = R(c['client_id'], 'issued', month)
    days = w.workdays(month)
    n0 = R(c['client_id'], 'inv0').randint(1040, 1900) + (int(month[5:]) - 7) * 14
    out = []
    for i in range(rng.randint(5, 14)):
        name, lo, hi = rng.choice(c['services'])
        net = round(rng.uniform(lo, hi), -1)
        out.append({'no': n0 + i, 'date': sorted(rng.sample(days, 1))[0], 'to': customer(rng, w, c),
                    'what': name, 'net': net, 'kind': rng.choice(['חשבונית מס', 'חשבונית מס / קבלה'])})
    out.sort(key=lambda x: (x['date'], x['no']))
    for i, x in enumerate(out):
        x['no'] = n0 + i
    return out


def doc_issued(w, c, u):
    d = u['doc']
    if d.get('kind') == 'invoice':
        rng = R(c['client_id'], 'one-invoice', d['variant'])
        days = w.workdays(d['month'])
        name, lo, hi = rng.choice(c['services'])
        lines = [(name, 1, round(rng.uniform(lo, hi), -1))]
        for extra in rng.sample(EXTRAS, rng.choice([0, 0, 1, 2])):
            lines.append((extra, rng.choice([1, 1, 2, 3]), round(rng.uniform(.04, .12) * lines[0][2], -1) or 50))
        html = invoice_html(c['business_name'], f'{c["id_label"]} <span class="num">{c["tax_id"]}</span> · {c["city"]}',
                            'חשבונית מס / קבלה', rng.randint(1040, 1999), rng.choice(days), customer(rng, w, c),
                            lines, 'שולם בהעברה בנקאית')
        return html, 'a4'
    rows = issued_list(w, c, d['month'])
    body = ''.join(f'<tr><td class="num">{x["no"]}</td><td class="num">{ddmmyyyy(x["date"])}</td><td>{x["kind"]}</td>'
                   f'<td>{escape(x["to"])}</td><td>{escape(x["what"])}</td><td class="n num">{money(x["net"])}</td>'
                   f'<td class="n num">{money(x["net"] * VAT)}</td><td class="n num">{money(x["net"] * (1 + VAT))}</td></tr>'
                   for x in rows)
    net = sum(x['net'] for x in rows)
    inner = f"""
<div style="display:flex;justify-content:space-between;margin-bottom:18px">{header_block(c)}
<div style="text-align:left"><h1>דוח מסמכים שהופקו</h1><div class="muted">{month_name(d['month'])} · הופק בתוכנת החשבוניות</div></div></div>
<table class="z"><thead><tr><th>מספר</th><th>תאריך</th><th>סוג</th><th>לקוח</th><th>תיאור</th><th class="n">לפני מע״מ</th>
<th class="n">מע״מ</th><th class="n">סה״כ</th></tr></thead><tbody>{body}</tbody>
<tfoot><tr><td colspan="5">סה״כ ({len(rows)} מסמכים)</td><td class="n num">{money(net)}</td><td class="n num">{money(net * VAT)}</td>
<td class="n num">{money(net * (1 + VAT))}</td></tr></tfoot></table>
"""
    return page(sheet(inner), Z_CSS), 'a4'


def doc_supplier(w, c, u):
    d = u['doc']
    rng = R(c['client_id'], 'supplier', d['variant'])
    sup, goods = rng.choice(SUPPLIERS[c['kind']])
    days = w.workdays(d['month'])
    lines = []
    for g in rng.sample(goods, min(len(goods), rng.randint(2, 5))):
        lines.append((g, rng.choice([1, 2, 3, 4, 5, 6, 10, 12, 20]), round(rng.uniform(12, 380), 1)))
    meta = f'ח.פ. <span class="num">{hidden(rng, "XXXXX")}</span> · {rng.choice(CITIES)}'
    html = invoice_html(sup, meta, 'חשבונית מס', rng.randint(20000, 89999), rng.choice(days), c['business_name'],
                        lines, rng.choice(['תנאי תשלום: שוטף + 30', 'תנאי תשלום: מזומן באספקה', 'תנאי תשלום: שוטף + 60']))
    return html, 'a4'


def doc_receipt(w, c, u):
    d = u['doc']
    rng = R(c['client_id'], 'receipt', d['variant'])
    days = w.workdays(d['month'])
    when = rng.choice(days)
    hour = f'{rng.randint(8, 18):02d}:{rng.randint(0, 59):02d}'
    if d['type'] == 'FUEL_RECEIPTS':
        fuel = 'סולר' if c['profile_id'] == 'CONTRACTOR' and rng.random() < .6 else 'בנזין 95'
        price = round(rng.uniform(6.85, 7.45), 2)
        liters = round(rng.uniform(22, 68), 2)
        total = round(price * liters, 2)
        inner = f"""
<div class="t-c t-big">{FUEL_CHAIN}</div>
<div class="t-c t-dim">תחנת {rng.choice(CITIES)} · ח.פ. <span class="num">{hidden(rng, 'XXXXX')}</span></div>
<div class="t-c t-b t-sep">חשבונית מס / קבלה</div>
<div class="t-row"><span>מס׳</span><span class="num">{rng.randint(100000, 999999)}</span></div>
<div class="t-row"><span>תאריך</span><span class="num">{ddmmyyyy(when)} {hour}</span></div>
<div class="t-row"><span>משאבה</span><span class="num">{rng.randint(1, 12)}</span></div>
<div class="t-sep t-row"><span>{fuel}</span><span><span class="num">{liters}</span> ליטר</span></div>
<div class="t-row"><span>מחיר לליטר</span><span class="num">{price}</span></div>
<div class="t-row"><span>מע״מ <span class="num">18%</span></span><span class="num">{money(total - total / (1 + VAT))}</span></div>
<div class="t-row t-big t-sep"><span>סה״כ</span><span class="num">{money(total)}</span></div>
<div class="t-row t-dim"><span>אשראי</span><span class="num">XXXX-{c['card']}</span></div>
"""
        return page(tape(inner), TAPE_CSS), 'tape'
    vendor, goods = rng.choice(EXPENSE_VENDORS[:2])
    picks = [(g, rng.randint(1, 3), round(rng.uniform(9, 160), 2)) for g in rng.sample(goods, rng.randint(1, 3))]
    total = sum(q * p for _, q, p in picks)
    lines = ''.join(f'<div class="t-row"><span>{escape(g)} <span class="num">x{q}</span></span><span class="num">{money(q * p)}</span></div>'
                    for g, q, p in picks)
    inner = f"""
<div class="t-c t-big">{vendor}</div>
<div class="t-c t-dim">עוסק מורשה <span class="num">{hidden(rng, 'XXXXX')}</span> · {rng.choice(CITIES)}</div>
<div class="t-c t-b t-sep">חשבונית מס / קבלה</div>
<div class="t-row"><span>מס׳</span><span class="num">{rng.randint(10000, 99999)}</span></div>
<div class="t-row"><span>תאריך</span><span class="num">{ddmmyyyy(when)} {hour}</span></div>
<div class="t-sep">{lines}</div>
<div class="t-row"><span>מע״מ <span class="num">18%</span></span><span class="num">{money(total - total / (1 + VAT))}</span></div>
<div class="t-row t-big t-sep"><span>סה״כ</span><span class="num">{money(total)}</span></div>
<div class="t-row t-dim"><span>{rng.choice(['אשראי', 'מזומן'])}</span><span></span></div>
<div class="t-c t-dim t-sep">תודה ולהתראות</div>
"""
    return page(tape(inner), TAPE_CSS), 'tape'


def doc_hours(w, c, u):
    d = u['doc']
    rng = R(c['client_id'], 'hours', d['month'])
    staff = c['staff'] or ['עובד/ת 1']
    days = len(w.workdays(d['month']))
    body = ''
    for name in staff:
        worked = rng.randint(max(8, days - 8), days)
        reg = round(worked * rng.uniform(6.5, 8.6), 1)
        ot1 = round(rng.uniform(0, 14), 1)
        ot2 = round(rng.uniform(0, 5), 1) if rng.random() < .4 else 0
        body += (f'<tr><td>{escape(name)}</td><td class="n num">{worked}</td><td class="n num">{reg}</td>'
                 f'<td class="n num">{ot1}</td><td class="n num">{ot2}</td><td class="n num">{round(reg + ot1 + ot2, 1)}</td>'
                 f'<td class="n num">{rng.choice([0, 0, 0, 1, 2])}</td></tr>')
    inner = f"""
<div style="display:flex;justify-content:space-between;margin-bottom:18px">{header_block(c)}
<div style="text-align:left"><h1>דוח נוכחות חודשי</h1><div class="muted">{month_name(d['month'])} · הופק ממערכת הנוכחות</div></div></div>
<table class="z"><thead><tr><th>עובד/ת</th><th class="n">ימי עבודה</th><th class="n">שעות רגילות</th><th class="n">נוספות <span class="num">125%</span></th>
<th class="n">נוספות <span class="num">150%</span></th><th class="n">סה״כ שעות</th><th class="n">ימי מחלה</th></tr></thead><tbody>{body}</tbody></table>
<div class="muted" style="margin-top:22px">ימי עבודה אפשריים בחודש: <span class="num">{days}</span>. שמות העובדים מקוצרים.</div>
<div style="margin-top:40px">חתימת המעסיק: ____________________</div>
"""
    return page(sheet(inner), Z_CSS), 'a4'


LETTER_CSS = """
body { font-family: 'Frank Ruhl Libre', serif; font-size: 14px; line-height: 1.7; }
.lh { border-bottom: 2px solid #444; padding-bottom: 10px; margin-bottom: 30px; display: flex;
      justify-content: space-between; align-items: flex-end; }
.lh .n1 { font-size: 22px; font-weight: 700; }
p { margin-bottom: 12px; }
"""


def doc_letter(w, c, u):
    d = u['doc']
    rng = R(c['client_id'], 'letter', d['variant'])
    when = rng.choice(w.workdays(d['month']))
    first = rng.choice(FIRST_NAMES)
    options = [
        ('ניהול נכסים – בית האלה', 'הנדון: עדכון דמי השכירות',
         [f'בהתאם להסכם השכירות, דמי השכירות החודשיים יעודכנו החל מ-1 ב{MONTHS_HE[(when.month) % 12]} '
          f'לסך של <span class="num">{money(round(rng.uniform(3200, 9800), -1))}</span> ₪ בתוספת מע״מ.',
          'יתר תנאי ההסכם נשארים ללא שינוי. נשמח לעמוד לרשותכם בכל שאלה.']),
        ('סוכנות ביטוח צמרת השרון', 'הנדון: אישור תשלום פוליסת ביטוח עסק',
         [f'הרינו לאשר כי התקבל תשלום בסך <span class="num">{money(round(rng.uniform(1800, 6400), -1))}</span> ₪ '
          'עבור פוליסת ביטוח העסק לשנה הקרובה.', 'הפוליסה בתוקף עד לחידושה בשנה הבאה.']),
        ('ליסינג דרך צלחה', 'הנדון: חשבון תקופתי לרכב העסק',
         [f'מצורף פירוט החיוב החודשי בגין רכב העסק: <span class="num">{money(round(rng.uniform(1900, 3900), -1))}</span> ₪ כולל מע״מ.',
          'החיוב יבוצע באמצעות הוראת הקבע הקיימת.']),
    ]
    sender, subject, paras = rng.choice(options)
    inner = f"""
<div class="lh"><div class="n1">{sender}</div><div class="num" style="font-size:13px">{ddmmyyyy(when)}</div></div>
<p>לכבוד<br><b>{escape(c['business_name'])}</b><br>{c['city']}</p>
<p><b><u>{subject}</u></b></p>
{''.join(f'<p>{x}</p>' for x in paras)}
<p style="margin-top:40px">בברכה,<br>{first}<br><span style="font-size:12px">{sender}</span></p>
"""
    return page(sheet(inner, 'letter'), LETTER_CSS), 'a4'


DRAW = {
    'BANK_STATEMENT': doc_bank, 'CREDIT_CARD': doc_card, 'Z_REPORTS': doc_z,
    'ISSUED_INVOICES': doc_issued, 'SUPPLIER_INVOICES': doc_supplier,
    'EXPENSE_RECEIPTS': doc_receipt, 'FUEL_RECEIPTS': doc_receipt,
    'EMPLOYEE_HOURS': doc_hours, 'OTHER': doc_letter,
}

# ----------------------------------------------------------------------------------------------
# A phone photo of a paper
# ----------------------------------------------------------------------------------------------

def find_coeffs(dst, src):
    rows = []
    for (x, y), (u, v) in zip(dst, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    return np.linalg.solve(np.array(rows, float), np.array(src, float).reshape(8))


def surface(rng, w, h):
    """A table, a desk or a counter under the paper."""
    kind = rng.choice(['wood', 'wood', 'gray', 'beige', 'dark'])
    small = (w // 4, h // 4)
    yy, xx = np.mgrid[0:small[1], 0:small[0]].astype(float)
    nrng = np.random.default_rng(rng.randint(0, 10 ** 9))
    if kind == 'wood':
        base = np.array(rng.choice([(150, 105, 70), (176, 132, 90), (120, 82, 55)]), float)
        wobble = np.cumsum(nrng.normal(0, .35, small[0]))[None, :]
        grain = (np.sin((yy + wobble * 3) / rng.uniform(1.2, 2.2)) * 6
                 + np.sin((yy + wobble * 5) / rng.uniform(6, 11)) * 9)
        streak = nrng.normal(0, 1, (small[1], 1)).repeat(small[0], 1) * 5
        img = base + (grain + streak)[..., None] + nrng.normal(0, 3, (*grain.shape, 1))
    else:
        base = np.array({'gray': (182, 184, 186), 'beige': (214, 204, 186), 'dark': (62, 64, 70)}[kind], float)
        img = base + nrng.normal(0, 5, (small[1], small[0], 1))
    img = Image.fromarray(np.clip(img, 0, 255).astype('uint8')).resize((w, h), Image.BICUBIC)
    return img.filter(ImageFilter.GaussianBlur(1.2))


def phone_photo(png, rng, shape, quality, reason, whatsapp):
    doc = Image.open(io.BytesIO(png)).convert('RGB')
    W, H = (1200, 1600) if shape == 'a4' else (1080, 1440)
    if quality == 'cropped' and shape == 'a4':
        W, H = 1600, 1200        # the phone turned sideways, too close to the page
    if quality == 'cropped':      # too close: the bottom of the paper, with the totals, is out of the frame
        doc = doc.crop((0, 0, doc.width, int(doc.height * (.6 if shape == 'a4' else .72))))
        s = 1.0 * W / doc.width if shape == 'a4' else 1.08 * H / doc.height
    else:
        s = min(0.86 * W / doc.width, (0.88 if shape == 'tape' else 0.84) * H / doc.height)
    s *= rng.uniform(.94, 1.0)
    dw, dh = doc.width * s, doc.height * s
    cx = W / 2 + rng.uniform(-30, 30)
    cy = H / 2 + rng.uniform(-25, 25) + (dh / 2 + 45 - H / 2 if quality == 'cropped' else 0)
    ang = math.radians(rng.uniform(-4, 4))
    corners = [(-dw / 2, -dh / 2), (dw / 2, -dh / 2), (dw / 2, dh / 2), (-dw / 2, dh / 2)]
    dst = []
    k = 0.035
    for x, y in corners:
        x += rng.uniform(-k, k) * dw
        y += rng.uniform(-k, k) * dh
        if y < 0:          # the top of the page is a little farther from the phone
            x *= rng.uniform(.93, .97)
        dst.append((cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)))
    src = [(0, 0), (doc.width, 0), (doc.width, doc.height), (0, doc.height)]
    coeffs = find_coeffs(dst, src)
    paper = doc.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new('L', doc.size, 255).transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    bg = surface(rng, W, H)
    shadow = mask.filter(ImageFilter.GaussianBlur(18)).point(lambda p: p * .55)
    off = (rng.randint(6, 18), rng.randint(8, 22))
    dark = Image.new('RGB', (W, H), (0, 0, 0))
    sh = Image.new('L', (W, H), 0)
    sh.paste(shadow, off)
    bg = Image.composite(dark, bg, sh)
    bg.paste(paper, (0, 0), mask)
    # Uneven light: brighter on one side, a soft vignette, a warm indoor color
    arr = np.asarray(bg).astype(float)
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    a = rng.uniform(0, 2 * math.pi)
    light = 1 + 0.1 * ((xx / W - .5) * math.cos(a) + (yy / H - .5) * math.sin(a))
    vign = 1 - 0.18 * (((xx / W - .5) ** 2 + (yy / H - .5) ** 2) * 2.2)
    warm = np.array([1.0, rng.uniform(.96, .99), rng.uniform(.88, .95)])
    arr = arr * (light * vign)[..., None] * warm
    if quality == 'dark':
        arr = arr * 0.33 + 4
    nrng = np.random.default_rng(rng.randint(0, 10 ** 9))
    arr += nrng.normal(0, 7 if quality == 'dark' else 2.5, arr.shape)
    img = Image.fromarray(np.clip(arr, 0, 255).astype('uint8'))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    if quality == 'blur':
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(5.5, 7.5)))
    if whatsapp:
        img = img.resize((W * 4 // 5, H * 4 // 5), Image.BICUBIC)
    out = io.BytesIO()
    img.save(out, 'JPEG', quality=58 if whatsapp else 74, optimize=True, progressive=True)
    return out.getvalue()


def blur_kind(w, u):
    """A "blurry" photo looks like the reason the office gave when it rejected it."""
    if u['doc']['quality'] != 'blurry':
        return 'ok'
    reason = w.items[u['item_id']]['reject_reason']
    if 'חשוכה' in reason:
        return 'dark'
    if 'חתוך' in reason:
        return 'cropped'
    return 'blur'


# ----------------------------------------------------------------------------------------------
# Drawing with Chrome
# ----------------------------------------------------------------------------------------------

def pdf_dated(data, uploaded_at):
    """Chrome writes the time of drawing into the PDF. The file gets the time of the upload instead,
    so the same seed.json always gives the same bytes. Same length, so the PDF's offsets stay right."""
    stamp = 'D:' + re.sub(r'[-T:]', '', uploaded_at[:19]) + uploaded_at[19:22] + "'" + uploaded_at[23:25] + "'"
    out = re.sub(rb"D:\d{14}[+-]\d\d'\d\d'", stamp.encode(), data)
    assert len(out) == len(data)
    return out


def check(html, u):
    """Rules.md: every document says "לדוגמה", and no number is long enough to be a real phone,
    account or ID number (the longest allowed is a 6-digit document number)."""
    text = re.sub(r'<style>.*?</style>|<[^>]+>', ' ', html, flags=re.S)
    if 'לדוגמה' not in text:
        raise ValueError(f'{u["asset"]}: the document is not marked "לדוגמה"')
    long_number = re.search(r'(?<![\d,.])\d{7,}', text)
    if long_number:
        raise ValueError(f'{u["asset"]}: a long number that could be real: {long_number.group()}')


def render_batch(args):
    uploads, out_dir = args
    from playwright.sync_api import sync_playwright
    seed = json.loads(SEED.read_text())
    w = World(seed)
    work = Path(tempfile.mkdtemp(prefix='nelio-docs-'))
    (work / 'fonts.css').write_text(font_css())
    done = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=['--allow-file-access-from-files'])
        ctx = browser.new_context(viewport={'width': 900, 'height': 1200}, device_scale_factor=1.6)
        pg = ctx.new_page()
        for u in uploads:
            c = w.clients[u['client_id']]
            html, shape = DRAW[u['doc']['type']](w, c, u)
            check(html, u)
            f = work / 'doc.html'
            f.write_text(html)
            pg.goto(f.as_uri())
            pg.evaluate('document.fonts.ready')
            target = Path(out_dir) / u['asset']
            target.parent.mkdir(parents=True, exist_ok=True)
            if u['doc']['format'] == 'pdf':
                data = pg.pdf(format='A4', print_background=True, margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
                data = pdf_dated(data, u['uploaded_at'])
            else:
                png = pg.locator('.tape' if shape == 'tape' else '.sheet').screenshot()
                rng = R(u['upload_id'], 'photo', u['doc']['variant'])
                data = phone_photo(png, rng, shape, blur_kind(w, u), None, u['doc']['source'] == 'whatsapp')
            target.write_bytes(data)
            done.append((u['asset'], len(data)))
        browser.close()
    shutil.rmtree(work, ignore_errors=True)
    return done


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', required=True, help='the folder to write to (the demo-assets branch)')
    ap.add_argument('--only', help='client IDs, comma separated (C07,C11)')
    ap.add_argument('--types', help='document types, comma separated (BANK_STATEMENT,Z_REPORTS)')
    ap.add_argument('--limit', type=int, help='at most this many documents')
    ap.add_argument('--workers', type=int, default=3)
    a = ap.parse_args()
    seed = json.loads(SEED.read_text())
    # A duplicate upload (the same photo sent twice) points to the same file: drawn once.
    uploads = [u for u in seed['uploads'] if not u['duplicate_of']]
    if a.only:
        keep = set(a.only.split(','))
        uploads = [u for u in uploads if u['client_id'] in keep]
    if a.types:
        keep = set(a.types.split(','))
        uploads = [u for u in uploads if u['doc']['type'] in keep]
    if a.limit:
        uploads = uploads[:a.limit]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    n = max(1, min(a.workers, len(uploads)))
    chunks = [(uploads[i::n], str(out)) for i in range(n)]
    with multiprocessing.Pool(n) as pool:
        results = [r for part in pool.map(render_batch, chunks) for r in part]
    total = sum(s for _, s in results)
    (out / 'manifest.json').write_text(json.dumps(
        {'seed_id': seed['seed_id'], 'files': len(results), 'bytes': total,
         'sha256': {p: hashlib.sha256((out / p).read_bytes()).hexdigest()[:16] for p, _ in sorted(results)}},
        ensure_ascii=False, indent=1))
    print(f'{len(results)} documents, {total / 1e6:.1f} MB, for seed {seed["seed_id"]} -> {out}')


if __name__ == '__main__':
    sys.exit(main())
