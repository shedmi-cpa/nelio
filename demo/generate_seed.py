#!/usr/bin/env python3
"""Nelio · demo data generator (stage 4.1, D36 and D37).

Builds the fictional office "שדמי ושות', רואי חשבון": 60 clients, the closed cycles of August
and September 2026, and the open October cycle up to the moment the demo shows (D36):
Monday 9/11/2026, in the evening. The result, demo/seed.json, is read by seedDemo() in
apps-script/Seed.gs, which writes it to the sheet and turns every upload into a file in Drive.

- Deterministic: a fixed random seed, so the same code always builds the same office.
- No secrets: no tokens and no e-mail addresses here. The server creates them (rules.md).
- Israel time. No activity on Shabbat and holidays, not even by clients (D36). The system sends
  messages only at allowed times (data-model.md, chapter 3.4): not at night, not on Shabbat or
  holidays, and not after 13:00 on Fridays and holiday eves.
- Every file a client uploads has its own document ("asset"). demo/render_docs.py draws them,
  and they live on the demo-assets branch (D37).

Run from the repository root:   python3 demo/generate_seed.py
"""

import hashlib
import heapq
import itertools
import json
import random
import uuid
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Jerusalem')
OUT = Path(__file__).resolve().parent / 'seed.json'
RANDOM_SEED = 4108   # any fixed number. Another number builds another office, just as fixed.
ASSETS_BASE = 'https://raw.githubusercontent.com/shedmi-cpa/nelio/demo-assets/'


def at(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=TZ)


def on(day, hh, mm=0):
    return datetime.combine(day, time(hh, mm)).replace(tzinfo=TZ)


SNAPSHOT = at(2026, 11, 9, 19, 30)   # D36: Monday evening, day 9 of the October cycle

# Yom tov days of Tishrei 5787 (decisions.md, research of stage 4.1). Stage 7 fills the full list.
HOLIDAYS = {
    date(2026, 9, 12): 'ראש השנה',
    date(2026, 9, 13): 'ראש השנה',
    date(2026, 9, 21): 'יום כיפור',
    date(2026, 9, 26): 'סוכות',
    date(2026, 10, 3): 'שמחת תורה',
}

MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט',
             'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

# ----------------------------------------------------------------------------------------------
# Document types and business profiles (D33). The server keeps the full definitions
# (DocTypes and Profiles in apps-script/Setup.gs); these lists only decide what each client owes.
# ----------------------------------------------------------------------------------------------

DOC_ORDER = ['Z_REPORTS', 'ISSUED_INVOICES', 'SUPPLIER_INVOICES', 'EXPENSE_RECEIPTS',
             'FUEL_RECEIPTS', 'BANK_STATEMENT', 'CREDIT_CARD', 'EMPLOYEE_HOURS', 'OTHER']
DOC_NAMES = {
    'Z_REPORTS': 'דוחות Z',
    'ISSUED_INVOICES': 'חשבוניות שהוצאתי',
    'SUPPLIER_INVOICES': 'חשבוניות ספקים',
    'EXPENSE_RECEIPTS': 'קבלות על הוצאות',
    'FUEL_RECEIPTS': 'קבלות דלק',
    'BANK_STATEMENT': 'דף בנק',
    'CREDIT_CARD': 'פירוט אשראי',
    'EMPLOYEE_HOURS': 'דוח שעות עובדים',
    'OTHER': 'מסמך אחר',
}
PROFILE_DOCS = {
    'CASH_REGISTER': ['Z_REPORTS', 'SUPPLIER_INVOICES', 'BANK_STATEMENT', 'CREDIT_CARD'],
    'SERVICE': ['ISSUED_INVOICES', 'EXPENSE_RECEIPTS', 'BANK_STATEMENT', 'CREDIT_CARD'],
    'CONTRACTOR': ['ISSUED_INVOICES', 'SUPPLIER_INVOICES', 'FUEL_RECEIPTS', 'BANK_STATEMENT',
                   'CREDIT_CARD'],
}

# "לא היה לי החודש": how often a client marks each type, and the note they write.
NA_CHANCE = {
    'CREDIT_CARD': 0.08, 'EXPENSE_RECEIPTS': 0.08, 'FUEL_RECEIPTS': 0.04,
    'SUPPLIER_INVOICES': 0.03, 'ISSUED_INVOICES': 0.03, 'EMPLOYEE_HOURS': 0.02,
}
NA_NOTES = {
    'CREDIT_CARD': ['לא השתמשנו בכרטיס החודש', 'אין לעסק כרטיס אשראי נפרד', ''],
    'EXPENSE_RECEIPTS': ['לא היו הוצאות החודש', ''],
    'FUEL_RECEIPTS': ['הרכב היה במוסך רוב החודש', ''],
    'SUPPLIER_INVOICES': ['לא היו קניות מספקים החודש', ''],
    'ISSUED_INVOICES': ['לא היו עבודות החודש', ''],
    'EMPLOYEE_HOURS': ['העובד היה בחופשה כל החודש', ''],
}

CLIENT_NOTES = [
    'צירפתי גם את החשבונית של הספק החדש',
    'יש לי שאלה על החשבונית של הרכב, אפשר לחזור אליי?',
    'דף הבנק כולל גם את ההעברה לביטוח הלאומי',
    'החודש היה שקט, פחות עבודות מהרגיל',
    'שלחתי שני צילומים של אותו מסמך, כי הראשון יצא כהה',
    'אם חסר משהו, עדיף להתקשר אחרי חמש',
]
CLIENT_NOTES_TISHREI = ['החודש היה סגור כמה ימים בגלל החגים']

REJECT_REASONS = {
    'blurry': ['התמונה מטושטשת, לא רואים את הסכומים', 'לא רואים את הסכומים',
               'הצילום חתוך, חסר הסכום הכולל', 'התמונה חשוכה מדי, אי אפשר לקרוא'],
    'wrong_period': ['זה המסמך של החודש הקודם'],
}
MONTHLY_STATEMENTS = {'BANK_STATEMENT', 'CREDIT_CARD', 'Z_REPORTS', 'EMPLOYEE_HOURS'}

# ----------------------------------------------------------------------------------------------
# The office (D35) and its 60 clients (D36)
# ----------------------------------------------------------------------------------------------

STAFF = [
    {'staff_id': 'S1', 'name': 'עמית שדמי', 'role': 'owner', 'email_tag': 's1', 'active': True},
    {'staff_id': 'S2', 'name': 'מירב סלעי', 'role': 'bookkeeper', 'email_tag': 's2', 'active': True},
    {'staff_id': 'S3', 'name': 'אסף מורג', 'role': 'bookkeeper', 'email_tag': 's3', 'active': True},
]
BOOKKEEPERS = ['S2', 'S3']

C, S, K = 'CASH_REGISTER', 'SERVICE', 'CONTRACTOR'
L, CO = 'licensed', 'company'
M, B = 'monthly', 'bimonthly'

# (business name, profile, legal type, has employees, reporting frequency, owner's first name)
ROSTER = [
    ('מאפיית השקד', C, L, True, M, ''),
    ('מכולת הרימון', C, L, False, B, ''),
    ('פיצה בכיכר', C, L, True, M, 'רונן'),
    ('קפה פינת השוק', C, L, True, M, 'רונן'),
    ('ירקות השדה', C, L, False, B, ''),
    ('אטליז נחום', C, L, True, M, 'נחום'),
    ('מסעדת הגפן בע״מ', C, CO, True, M, ''),
    ('בגדי עומר', C, L, False, B, 'עומר'),
    ('פרחי הגליל', C, L, False, B, ''),
    ('ציוד ובניין הדקל בע״מ', C, CO, True, M, ''),
    ('מספרת אבי', C, L, False, B, 'אבי'),
    ('קונדיטוריית מתוק לי בע״מ', C, CO, True, M, ''),
    ('מעדניית הכפר בע״מ', C, CO, True, M, ''),
    ('שווארמה בן ציון', C, L, True, M, 'בן ציון'),
    ('צעצועי דובי', C, L, False, B, 'דב'),
    ('אופני גלגל', C, L, False, B, ''),
    ('סופר הכל פה בע״מ', C, CO, True, M, ''),
    ('דגי הים', C, L, False, M, ''),
    ('קיוסק התחנה', C, L, False, B, ''),
    ('חומוס אליהו בע״מ', C, CO, True, M, 'אליהו'),
    ('ספרים דף חדש', C, L, False, B, ''),
    ('חנות הטבע שורש', C, L, False, B, ''),
    ('קפה הקשת', C, L, True, M, ''),
    ('כלי בית אורן', C, L, False, B, 'אורן'),
    ('Pixel – צילום אירועים', S, L, False, B, ''),
    ('מחשבים בראש שקט', S, L, False, M, ''),
    ('סטודיו קו ונקודה', S, L, False, M, ''),
    ('נועם פיתוח תוכנה בע״מ', S, CO, True, M, 'נועם'),
    ('שפה ברורה – תרגומים', S, L, False, B, ''),
    ('סטודיו קווים – אדריכלות בע״מ', S, CO, True, M, ''),
    ('ליאור אימון אישי', S, L, False, B, 'ליאור'),
    ('מתמטיקה בקלות', S, L, False, B, ''),
    ('הפקות שמחה גדולה', S, L, True, M, ''),
    ('צומת החלטות – ייעוץ עסקי בע״מ', S, CO, False, M, ''),
    ('שבילי הארץ – הדרכת טיולים', S, L, False, B, ''),
    ('פריים אחרון – עריכת וידאו', S, L, False, B, ''),
    ('בית ראשון – ייעוץ משכנתאות', S, L, False, M, ''),
    ('מדידות מדויק', S, L, False, M, ''),
    ('אור טוב – צילום מוצרים', S, L, False, M, ''),
    ('מילה טובה – כתיבה שיווקית', S, L, False, B, ''),
    ('קליק – ניהול רשתות בע״מ', S, CO, True, M, ''),
    ('מחשב עד הבית', S, L, False, M, ''),
    ('צעד קדימה – אימון עסקי', S, L, False, M, ''),
    ('תכנון חכם – ייעוץ אנרגיה', S, L, False, M, ''),
    ("ג'ו שיפוצים בע״מ", K, CO, True, M, 'יוסף'),
    ('24/7 מיזוג', K, L, False, B, ''),
    ('חשמל אור ישר בע״מ', K, CO, True, M, ''),
    ('זורם – אינסטלציה', K, L, False, M, ''),
    ('נגריית העץ הישן', K, L, True, M, ''),
    ('צבע טרי – עבודות צבע', K, L, False, B, ''),
    ('מסגריית הברזל', K, L, False, M, ''),
    ('ירוק עד – גינון', K, L, False, M, ''),
    ('אבן דרך – ריצוף', K, L, False, B, ''),
    ('על הדרך – הובלות בע״מ', K, CO, True, M, ''),
    ('גג בטוח – איטום', K, L, True, M, ''),
    ('מנעולן מהיר', K, L, False, M, ''),
    ('גבס וקו – עבודות גבס', K, L, False, M, ''),
    ('דוד שמש – התקנות', K, L, False, B, ''),
    ('בונים יחד בע״מ', K, CO, True, M, ''),
    ('סיבוב – תיקון מכשירי חשמל', K, L, False, M, ''),
]
BAKERY = 'מאפיית השקד'
TWO_BUSINESSES = ('פיצה בכיכר', 'קפה פינת השוק')   # one owner, two links (an edge case of brief.md)

FIRST_NAMES = ['אבי', 'יוסי', 'משה', 'דני', 'איתי', 'עמיר', 'גיל', 'אלון', 'שי', 'ניר', 'עידו',
               'יואב', 'אריאל', 'אורי', 'בני', 'חיים', 'שלמה', 'דוד', 'עומר', 'תומר', 'ערן',
               'רועי', 'יעקב', 'מאיר', 'מיכל', 'רחל', 'שרית', 'אורנה', 'טלי', 'נעמה', 'הדס',
               'ליאת', 'סיגל', 'רונית', 'דנה', 'יעל', 'אפרת', 'שירן', 'מורן', 'אילנה', 'נורית']
SURNAMES = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'דהן', 'אברהם', 'פרידמן', 'אזולאי', 'מלכה',
            'חדד', 'גבאי', 'שפירא', 'קליין', 'אוחיון', 'יוסף', 'עמר', 'בן דוד', 'סעדה',
            'רוזנברג', 'גולן', 'שטרן', 'אשכנזי', 'ברק', 'כץ', 'חזן', 'טל', 'שמואלי', 'וקנין',
            'נגר', 'אלמוג', 'רביבו', 'זכאי', 'טנא', 'קורן', 'ששון']

OFFICE_NOTES = [
    'מעדיף וואטסאפ על פני מייל',
    'לקוח ותיק, מעדיף טלפון',
    'עבר אלינו ממשרד אחר בינואר 2026',
    'שולח את דף הבנק בדרך כלל בסוף השבוע',
    'עונתי: עבודה רבה בקיץ',
    'לבדוק בדוח השנתי את הרכב החדש',
    'החשבוניות מגיעות כדוח אחד מתוכנת החשבוניות',
    'עובד גם מול חברות בנייה גדולות',
    'שני שותפים. איש הקשר הוא השותף שמטפל בכספים',
    'פתח סניף שני ביולי 2026',
]

PERSONAS = ['early'] * 30 + ['after_reminder'] * 15 + ['last_minute'] * 9 + ['unreadable'] * 6

# ----------------------------------------------------------------------------------------------
# The calendar: who may act when
# ----------------------------------------------------------------------------------------------


def is_rest_day(d):
    """Shabbat or a holiday."""
    return d.weekday() == 5 or d in HOLIDAYS


def is_short_day(d):
    """Friday, or the eve of a holiday."""
    return d.weekday() == 4 or (d + timedelta(days=1)) in HOLIDAYS


def client_ok(t):
    d = t.date()
    if is_rest_day(d):
        # Only after nightfall on the last day of a rest period.
        return t.hour >= 20 and not is_rest_day(d + timedelta(days=1))
    if is_short_day(d):
        return t.hour < 14
    return True


def staff_day(d):
    """The office works Sunday to Thursday, not on holidays."""
    return d.weekday() in (6, 0, 1, 2, 3) and d not in HOLIDAYS


def staff_hours(d):
    if (d + timedelta(days=1)) in HOLIDAYS:
        return time(8, 30), time(12, 30)
    return time(8, 30), time(17, 30)


def system_ok(t):
    """Quiet hours (data-model.md, Settings): 21:00-08:00, Fridays and holiday eves from 13:00,
    and all of Shabbat and holidays."""
    d = t.date()
    if is_rest_day(d):
        return False
    if t.time() < time(8, 0) or t.time() >= time(21, 0):
        return False
    if is_short_day(d) and t.time() >= time(13, 0):
        return False
    return True


def next_system_time(t):
    """The first allowed moment at or after t: t itself, or 08:00 of the next allowed day."""
    if system_ok(t):
        return t
    morning = on(t.date(), 8)
    if morning > t and system_ok(morning):
        return morning
    d = t.date() + timedelta(days=1)
    while not system_ok(on(d, 8)):
        d += timedelta(days=1)
    return on(d, 8)


# When clients upload: mostly in the evening, some in the morning and at lunch.
CLIENT_HOURS = {7: 3, 8: 4, 9: 3, 10: 3, 11: 3, 12: 4, 13: 4, 14: 3, 15: 3, 16: 3, 17: 4,
                18: 5, 19: 7, 20: 10, 21: 11, 22: 9, 23: 5}


def client_time_on(rng, d):
    hours = [h for h in CLIENT_HOURS if client_ok(on(d, h, 30))]
    if not hours:
        return None
    h = rng.choices(hours, weights=[CLIENT_HOURS[x] for x in hours])[0]
    t = on(d, h, rng.randrange(60))
    # A sitting takes a few minutes, so it has to end before Shabbat or a holiday begins too.
    return t if client_ok(t) and client_ok(t + timedelta(minutes=15)) else None


def client_time_between(rng, lo, hi):
    """A random moment in [lo, hi) when a client may act."""
    if hi <= lo:
        hi = lo + timedelta(days=1)
    span = (hi.date() - lo.date()).days
    for _ in range(80):
        t = client_time_on(rng, lo.date() + timedelta(days=rng.randint(0, span)))
        if t and lo <= t < hi:
            return t
    t = lo
    while not client_ok(t):
        t += timedelta(minutes=30)
    return t


def staff_time_after(rng, t, min_hours=1.0, days=2, flat=False):
    """A moment within the next working days of the office, at least min_hours after t."""
    start = t + timedelta(hours=min_hours)
    candidates = []
    d = start.date()
    while len(candidates) < days and d < start.date() + timedelta(days=21):
        if staff_day(d):
            lo, hi = staff_hours(d)
            if on(d, hi.hour, hi.minute) > start:
                candidates.append(d)
        d += timedelta(days=1)
    for _ in range(40):
        weights = [4, 3, 2, 1, 1] if flat else [4, 3, 2, 2, 1]
        d = rng.choices(candidates, weights=weights[:len(candidates)])[0]
        lo, hi = staff_hours(d)
        minutes = (hi.hour * 60 + hi.minute) - (lo.hour * 60 + lo.minute) - 10
        tt = on(d, lo.hour, lo.minute) + timedelta(minutes=rng.randrange(minutes))
        if tt > start:
            return tt
    lo, hi = staff_hours(candidates[-1])
    return on(candidates[-1], hi.hour - 1, 0)


# ----------------------------------------------------------------------------------------------
# Cycles (data-model.md, chapter 3.3)
# ----------------------------------------------------------------------------------------------

CYCLES = [
    # August: the due date (12/9) falls on Shabbat and Rosh Hashana. On 2/9 the owner moves it
    # to Thursday 10/9 (D36). The request of 1/9 still said 12/9.
    {'cycle_id': '2026-08', 'opened': at(2026, 9, 1, 9), 'closed': at(2026, 10, 1, 9),
     'due': date(2026, 9, 10), 'due_initial': date(2026, 9, 12),
     'due_changed_at': at(2026, 9, 2, 8, 45), 'bimonthly': True},
    # September: an odd month, so only the monthly clients (data-model.md, chapter 1).
    {'cycle_id': '2026-09', 'opened': at(2026, 10, 1, 9), 'closed': at(2026, 11, 1, 9),
     'due': date(2026, 10, 12), 'bimonthly': False},
    # October: open. Day 9 is the moment the demo shows.
    {'cycle_id': '2026-10', 'opened': at(2026, 11, 1, 9), 'closed': None,
     'due': date(2026, 11, 12), 'bimonthly': True},
]


def month_label(ym):
    y, m = ym.split('-')
    return MONTHS_HE[int(m) - 1] + ' ' + y


def period_of(cycle, client):
    if client['frequency'] == 'bimonthly':
        y, m = cycle['cycle_id'].split('-')
        return f'{y}-{int(m) - 1:02d}_{int(m):02d}'
    return cycle['cycle_id']


def months_of(period):
    """'2026-09_10' -> ['2026-09', '2026-10']."""
    if '_' in period:
        first, second = period.split('_')
        return [first, first[:5] + second]
    return [period]


def previous_month(ym):
    y, m = map(int, ym.split('-'))
    return f'{y - 1}-12' if m == 1 else f'{y}-{m - 1:02d}'


def schedule(cycle):
    """The steps of a cycle (data-model.md, Settings): 7, 3 and 1 days before the due date,
    the call list on the due date, and the summary a day after. Messages go out at 09:00."""
    due = cycle['due']

    def nine(d):
        return next_system_time(on(d, 9))
    return {
        'REMINDER_1': nine(due - timedelta(days=7)),
        'REMINDER_2': nine(due - timedelta(days=3)),
        'LAST_DAY': nine(due - timedelta(days=1)),
        'CALL_LIST': nine(due),
        'SUMMARY': nine(due + timedelta(days=1)),
        'due_end': on(due, 23, 59),
    }


def iso(t):
    return t.isoformat() if t else ''


def fmt_date(d):
    return d.strftime('%d/%m/%Y')


# ----------------------------------------------------------------------------------------------
# Building the clients
# ----------------------------------------------------------------------------------------------


def build_clients(rng):
    roster = list(ROSTER)
    rng.shuffle(roster)
    bakery = next(r for r in roster if r[0] == BAKERY)
    roster.remove(bakery)
    roster.insert(6, bakery)   # C07, as in the examples of D31 and rules.md

    personas = list(PERSONAS)
    personas.remove('unreadable')   # the bakery is the "unreadable" story of data-model.md
    rng.shuffle(personas)

    prefixes = ['050', '052', '053', '054', '055', '058']
    endings = rng.sample(range(1000, 10000), len(roster))
    surnames = list(SURNAMES)
    rng.shuffle(surnames)
    notes = list(OFFICE_NOTES)
    rng.shuffle(notes)

    clients = []
    owner_of = {}
    for i, (name, profile, legal, employees, freq, first) in enumerate(roster):
        cid = f'C{i + 1:02d}'
        persona = 'unreadable' if name == BAKERY else personas.pop()
        contact = (first or rng.choice(FIRST_NAMES)) + ' ' + surnames[i % len(surnames)]
        client = {
            'client_id': cid, 'business_name': name, 'contact_name': contact,
            'email_tag': cid.lower(),
            'phone': f'{rng.choice(prefixes)}-XXX-{endings[i]}',   # D34: hidden middle digits
            'profile_id': profile, 'has_employees': employees, 'frequency': freq,
            'legal_type': legal, 'bookkeeper_id': '', 'active': True, 'notes': '',
            # The office started using Nelio at the end of August 2026 and created all the links.
            'token_created_at': iso(at(2026, 8, 30, 10) + timedelta(minutes=7 * i)),
            'persona': persona,
        }
        if name in TWO_BUSINESSES:
            owner_of[name] = client
        clients.append(client)

    # One owner, two businesses: the same person, phone and e-mail (data-model.md, Clients).
    first, second = owner_of[TWO_BUSINESSES[0]], owner_of[TWO_BUSINESSES[1]]
    if first['client_id'] > second['client_id']:
        first, second = second, first
    second['contact_name'] = first['contact_name']
    second['phone'] = first['phone']
    second['email_tag'] = first['email_tag']
    first['notes'] = 'יש לו שני עסקים: גם ' + second['business_name']
    second['notes'] = 'יש לו שני עסקים: גם ' + first['business_name']

    # Office notes for some of the clients.
    others = [c for c in clients if not c['notes']]
    for client, note in zip(rng.sample(others, len(notes)), notes):
        client['notes'] = note

    # 30 clients for each bookkeeper, with a similar mix (D36). The bakery is Merav's.
    order = sorted(clients, key=lambda c: (c['profile_id'], c['frequency'], c['persona'],
                                           c['has_employees'], c['client_id']))
    for i, client in enumerate(order):
        client['bookkeeper_id'] = BOOKKEEPERS[i % 2]
    bakery_client = clients[6]
    if bakery_client['bookkeeper_id'] != 'S2':
        swap = next(c for c in order if c['bookkeeper_id'] == 'S2' and c is not bakery_client
                    and c['profile_id'] == bakery_client['profile_id'])
        swap['bookkeeper_id'], bakery_client['bookkeeper_id'] = 'S3', 'S2'
    return clients


# ----------------------------------------------------------------------------------------------
# Files
# ----------------------------------------------------------------------------------------------


def file_plan(rng, doc, period, bimonthly):
    """The files a client uploads for one document type: format, source, month and part."""
    months = months_of(period)
    files = []
    if doc == 'BANK_STATEMENT':
        for m in months:
            if rng.random() < 0.55:
                files.append({'format': 'pdf', 'source': 'download', 'month': m})
            else:
                pages = 2 if rng.random() < 0.2 else 1
                files += [{'format': 'jpg', 'source': 'camera', 'month': m, 'part': p + 1,
                           'parts': pages} for p in range(pages)]
    elif doc == 'CREDIT_CARD':
        for m in months:
            files.append({'format': 'pdf', 'source': 'download', 'month': m}
                         if rng.random() < 0.8 else {'format': 'jpg', 'source': 'camera', 'month': m})
    elif doc == 'Z_REPORTS':
        for m in months:
            if rng.random() < 0.6:
                files.append({'format': 'pdf', 'source': 'download', 'month': m})
            else:
                tapes = 2 if rng.random() < 0.35 else 1
                files += [{'format': 'jpg', 'source': 'camera', 'month': m, 'part': p + 1,
                           'parts': tapes} for p in range(tapes)]
    elif doc == 'EMPLOYEE_HOURS':
        for m in months:
            files.append({'format': 'pdf', 'source': 'download', 'month': m}
                         if rng.random() < 0.6 else {'format': 'jpg', 'source': 'camera', 'month': m})
    elif doc == 'ISSUED_INVOICES':
        if rng.random() < 0.7:
            files += [{'format': 'pdf', 'source': 'download', 'month': m, 'kind': 'report'}
                      for m in months]
        else:
            n = rng.randint(1, 2) + (1 if bimonthly else 0)
            files += [{'format': 'pdf', 'source': 'download', 'month': rng.choice(months),
                       'kind': 'invoice'} for _ in range(n)]
    elif doc in ('SUPPLIER_INVOICES', 'EXPENSE_RECEIPTS', 'FUEL_RECEIPTS'):
        n = rng.choice([1, 1, 1, 2, 2, 3]) if doc != 'FUEL_RECEIPTS' else rng.choice([1, 1, 2])
        if bimonthly:
            n += 1
        for _ in range(n):
            photo = doc != 'SUPPLIER_INVOICES' or rng.random() < 0.6
            files.append({'format': 'jpg' if photo else 'pdf',
                          'source': 'camera' if photo else 'download',
                          'month': rng.choice(months)})
    elif doc == 'OTHER':
        files.append({'format': 'pdf', 'source': 'download', 'month': months[-1], 'kind': 'letter'}
                     if rng.random() < 0.7 else
                     {'format': 'jpg', 'source': 'camera', 'month': months[-1], 'kind': 'letter'})
    return files


def original_name(rng, spec, doc, t):
    """A realistic name of the file on the phone or computer."""
    y, m = spec['month'].split('-')
    month_he = MONTHS_HE[int(m) - 1]
    if spec['source'] == 'whatsapp':
        return f'IMG-{t:%Y%m%d}-WA{rng.randint(1, 60):04d}.jpg'
    if spec['format'] == 'jpg':
        shot = t - timedelta(seconds=rng.randint(20, 300))
        if rng.random() < 0.65:
            return f'IMG_{shot:%Y%m%d_%H%M%S}.jpg'
        return f'IMG_{rng.randint(1000, 9999)}.jpg'
    choices = {
        'BANK_STATEMENT': [f'דף חשבון {m}-{y}.pdf', f'statement_{y}{m}.pdf', f'תדפיס עו״ש {m}.{y}.pdf'],
        'CREDIT_CARD': [f'פירוט חיובים {month_he} {y}.pdf', f'card_statement_{y}_{m}.pdf'],
        'Z_REPORTS': [f'Z_{y}-{m}.pdf', f'דוח Z חודשי {m}-{y}.pdf'],
        'EMPLOYEE_HOURS': [f'דוח שעות {month_he} {y}.pdf', f'hours_{y}_{m}.pdf'],
        'ISSUED_INVOICES': ([f'דוח הכנסות {m}-{y}.pdf', f'invoices_{y}_{m}.pdf']
                            if spec.get('kind') == 'report' else
                            [f'חשבונית מס {rng.randint(1001, 1999)}.pdf']),
        'SUPPLIER_INVOICES': [f'חשבונית {rng.randint(10000, 99999)}.pdf',
                              f'invoice_{rng.randint(10000, 99999)}.pdf'],
        'OTHER': ['מכתב.pdf', f'Scan_{t:%Y%m%d_%H%M}.pdf', 'אישור.pdf'],
    }
    return rng.choice(choices.get(doc, [f'Scan_{t:%Y%m%d_%H%M}.pdf']))


# ----------------------------------------------------------------------------------------------
# One request: a client in a cycle
# ----------------------------------------------------------------------------------------------


class Office:
    """Collects the rows of all the tabs."""

    def __init__(self, rng, clients):
        self.rng = rng
        self.clients = clients
        self.by_id = {c['client_id']: c for c in clients}
        self.requests, self.items, self.uploads, self.messages, self.log = [], [], [], [], []
        self.cycle_rows = []
        self.counter = itertools.count()
        self.timelines = {}      # request_id -> [(time, status, missing)]
        self.reject_times = {}   # cycle_id -> [times]

    def message(self, created, template, cycle, ctx, client=None, staff_id='', request_id='',
                horizon=None, created_by='system'):
        send_after = next_system_time(created)
        sent = send_after if (horizon is None or send_after <= horizon) else None
        self.messages.append({
            'created_at': iso(created), 'send_after': iso(send_after), 'template_id': template,
            'cycle_id': cycle['cycle_id'], 'request_id': request_id,
            'client_id': client['client_id'] if client else '', 'staff_id': staff_id,
            # D11: in demo mode a message is written in full and logged, not sent.
            'status': 'simulated' if sent else 'queued', 'sent_at': iso(sent),
            'note': '', 'created_by': created_by, 'ctx': ctx,
        })

    def event(self, t, actor, event, client=None, request_id='', item_id='', details='',
              upload_id='', details_template=''):
        row = {'at': iso(t), 'actor': actor, 'event': event,
               'client_id': client['client_id'] if client else '', 'request_id': request_id,
               'item_id': item_id, 'details': details}
        if upload_id:
            row['upload_id'] = upload_id
            row['details_template'] = details_template
        self.log.append(row)

    # ------------------------------------------------------------------------------------------

    def run_request(self, cycle, sched, horizon, client, persona, specials):
        rng = self.rng
        cid = client['client_id']
        bookkeeper = client['bookkeeper_id']
        request_id = f"{cycle['cycle_id']}_{cid}"
        period = period_of(cycle, client)
        bimonthly = '_' in period
        docs = PROFILE_DOCS[client['profile_id']] + (['EMPLOYEE_HOURS'] if client['has_employees'] else []) + ['OTHER']
        docs.sort(key=DOC_ORDER.index)
        required = [d for d in docs if d != 'OTHER']
        opened = cycle['opened']

        items = {d: {'status': 'missing', 'active': [], 'last_seq': 0, 'na_note': '',
                     'reject_reason': '', 'updated_at': opened, 'updated_by': 'system'} for d in docs}
        req = {'status': 'not_started', 'reminder_count': 0, 'last_reminder_at': None,
               'last_activity': '', 'last_activity_at': None, 'client_note': '',
               'submitted_at': None, 'completed_at': None, 'completed_by': '',
               'completion_note': ''}
        timeline = [(opened, 'not_started', [{'doc': d, 'rejected': False} for d in required])]
        self.timelines[request_id] = timeline
        heap = []
        state = {'pending_reject': False, 'approve_planned': False}

        def push(t, kind, data=None):
            if t is not None and t <= horizon:
                heapq.heappush(heap, (t, next(self.counter), kind, data or {}))

        def missing():
            return [{'doc': d, 'rejected': items[d]['status'] == 'rejected'}
                    for d in required if items[d]['status'] in ('missing', 'rejected')]

        def compute_status():
            if req['completed_at']:
                return 'complete'
            if all(items[d]['status'] in ('received', 'not_applicable') for d in required):
                return 'submitted'
            if any(items[d]['status'] != 'missing' for d in required):
                return 'partial'
            return 'not_started'

        def settle(t):
            """Data model 3.2: the status is computed after every change, by one rule."""
            old = req['status']
            new = compute_status()
            req['status'] = new
            if new == 'submitted' and old != 'submitted':
                req['submitted_at'] = t
                self.message(t, 'CONFIRMATION', cycle, {}, client=client, request_id=request_id,
                             horizon=horizon)
                if not state['pending_reject'] and not state['approve_planned']:
                    state['approve_planned'] = True
                    push(specials.get('approve_at') or staff_time_after(rng, t, 18, 5, flat=True), 'approve')
            timeline.append((t, new, missing()))

        def activity(t, text):
            req['last_activity'] = text
            req['last_activity_at'] = t

        # -------- the plan for this month: when the client uploads what --------

        na = {d: rng.choice(NA_NOTES[d]) for d in required if rng.random() < NA_CHANCE.get(d, 0)
              and d != specials.get('extra', {}).get('duplicate')}
        to_upload = [d for d in required if d not in na]
        if not to_upload:
            to_upload, na = required[:1], {k: v for k, v in na.items() if k != required[0]}
        with_other = rng.random() < 0.07

        def session(t, upload_docs, na_marks=None, bad=None, note='', by='client', source=None,
                    extra=None):
            push(t, 'session', {'docs': list(upload_docs), 'na': dict(na_marks or {}), 'bad': bad,
                                'note': note, 'by': by, 'source': source, 'extra': extra or {}})

        def pick_note():
            if rng.random() < 0.1:
                pool = CLIENT_NOTES + (CLIENT_NOTES_TISHREI if cycle['cycle_id'] in ('2026-08', '2026-09') else [])
                return rng.choice(pool)
            return ''

        r1, r2, last, call = sched['REMINDER_1'], sched['REMINDER_2'], sched['LAST_DAY'], sched['CALL_LIST']
        main_docs = to_upload + (['OTHER'] if with_other else [])

        if 'script' in specials:
            specials['script'](session, push, items)
        elif persona == 'early':
            t1 = client_time_between(rng, opened + timedelta(minutes=40), opened + timedelta(days=3, hours=12))
            if len(to_upload) >= 2 and rng.random() < 0.2:
                forgot = rng.choice(to_upload)
                session(t1, [d for d in main_docs if d != forgot], na, note=pick_note())
                session(client_time_between(rng, r1 + timedelta(minutes=30), r1 + timedelta(days=2)), [forgot])
            else:
                session(t1, main_docs, na, note=pick_note(), extra=specials.get('extra'))
        elif persona == 'after_reminder':
            t1 = client_time_between(rng, r1 + timedelta(minutes=20), r1 + timedelta(days=3))
            if len(to_upload) >= 2 and rng.random() < 0.4:
                later = rng.sample(to_upload, 1)
                session(t1, [d for d in main_docs if d not in later], na, note=pick_note())
                session(client_time_between(rng, r2 + timedelta(minutes=30), r2 + timedelta(days=1, hours=12)), later)
            else:
                session(t1, main_docs, na, note=pick_note())
        elif persona == 'last_minute':
            rest = list(main_docs)
            if rng.random() < 0.6 and len(to_upload) >= 2:
                first = rng.choice(to_upload)
                rest.remove(first)
                session(client_time_between(rng, opened + timedelta(days=1), opened + timedelta(days=6)), [first])
            if specials.get('never_finish'):
                rest = rest[:1]
            if specials.get('via_whatsapp'):
                # After the phone call the client sends photos in WhatsApp, and the office uploads
                # them on the client's behalf ("העלאה בשם הלקוח").
                session(staff_time_after(rng, call + timedelta(hours=2), 0.5, 2), rest, na,
                        by=bookkeeper, source='whatsapp')
            elif specials.get('manual_complete'):
                kept = [d for d in rest if d != 'BANK_STATEMENT'] or rest
                session(client_time_between(rng, last - timedelta(hours=8), sched['due_end']), kept, na)
                push(staff_time_after(rng, call + timedelta(days=2), 1, 2), 'manual_complete',
                     {'note': 'את דף הבנק קיבלנו במייל'})
            elif rng.random() < 0.5:
                session(client_time_between(rng, last - timedelta(hours=8), sched['due_end']), rest, na, note=pick_note())
            else:
                # After the phone call of the due date: a day or a few days later.
                session(client_time_between(rng, call + timedelta(days=1), call + timedelta(days=6)), rest, na, note=pick_note())
        elif persona == 'unreadable':
            t1 = client_time_between(rng, opened + timedelta(hours=1), opened + timedelta(days=4))
            choices = [d for d in ['BANK_STATEMENT', 'Z_REPORTS', 'SUPPLIER_INVOICES', 'FUEL_RECEIPTS',
                                   'EXPENSE_RECEIPTS', 'CREDIT_CARD'] if d in to_upload]
            bad = choices[0] if choices and rng.random() < 0.6 else (rng.choice(choices) if choices else to_upload[0])
            session(t1, main_docs, na, bad=bad, note=pick_note())

        # The system's reminders: only to whoever still misses something (data-model.md 3.2).
        for template in ('REMINDER_1', 'REMINDER_2', 'LAST_DAY'):
            push(sched[template], 'reminder', {'template': template})
        if 'whatsapp_at' in specials:
            push(specials['whatsapp_at'], 'whatsapp')
        elif cycle['closed'] and persona == 'last_minute' and rng.random() < 0.6:
            push(staff_time_after(rng, call, 3, 1), 'whatsapp')
        for extra_event in specials.get('events', []):
            push(extra_event[0], extra_event[1], extra_event[2])

        # -------- what happens, in order of time --------

        while heap:
            t, _, kind, data = heapq.heappop(heap)
            if kind == 'session':
                by = data['by']
                actor = 'client:' + cid if by == 'client' else 'staff:' + by
                moment = t
                names = []
                duplicate_done = False
                for doc in data['docs']:
                    item = items[doc]
                    item_id = f'{request_id}_{doc}'
                    if item['status'] == 'not_applicable':
                        item['na_note'] = ''   # data model 3.1: uploading clears "לא היה לי"
                    plan = data['extra'].get('files', {}).get(doc) or file_plan(rng, doc, period, bimonthly)
                    is_bad = data['bad'] == doc
                    for k, spec in enumerate(plan):
                        if data['source'] == 'whatsapp':
                            spec = dict(spec, format='jpg', source='whatsapp')
                        item['last_seq'] += 1
                        seq = item['last_seq']
                        moment = moment + timedelta(seconds=rng.randint(15, 70))
                        quality = 'ok'
                        if is_bad and (k == 0 or data['extra'].get('all_bad')):
                            quality = 'wrong_period' if (doc in MONTHLY_STATEMENTS and rng.random() < 0.3) else 'blurry'
                            if quality == 'blurry':
                                spec = dict(spec, format='jpg', source='camera')
                        ext = spec['format']
                        upload_id = f'{item_id}_{seq:02d}'
                        doc_spec = {'type': doc, 'format': ext, 'source': spec['source'],
                                    'month': previous_month(spec['month']) if quality == 'wrong_period' else spec['month'],
                                    'part': spec.get('part', 1), 'parts': spec.get('parts', 1),
                                    'kind': spec.get('kind', ''), 'quality': quality,
                                    'variant': rng.randint(1, 10 ** 6)}
                        row = {
                            'upload_id': upload_id, 'uploaded_at': iso(moment), 'item_id': item_id,
                            'request_id': request_id, 'client_id': cid, 'uploaded_by': by,
                            'original_name': original_name(rng, spec, doc, moment),
                            'seq': seq, 'mime_type': 'application/pdf' if ext == 'pdf' else 'image/jpeg',
                            'duplicate_of': '', 'upload_key': str(uuid.UUID(int=rng.getrandbits(128))),
                            'status': 'active', 'asset': f'{cid}/{period}/{doc}_{seq:02d}.{ext}',
                            'doc': doc_spec,
                        }
                        self.uploads.append(row)
                        item['active'].append(row)
                        self.event(moment, actor, 'upload' if by == 'client' else 'upload_by_staff',
                                   client, request_id, item_id, upload_id=upload_id,
                                   details_template='הועלה קובץ: {file}' if by == 'client' else 'המשרד העלה בשם הלקוח: {file}')
                        # The duplicate of brief.md: the same photo, uploaded twice.
                        if data['extra'].get('duplicate') == doc and not duplicate_done:
                            duplicate_done = True
                            item['last_seq'] += 1
                            seq2 = item['last_seq']
                            moment = moment + timedelta(seconds=rng.randint(20, 50))
                            twin = dict(row, upload_id=f'{item_id}_{seq2:02d}', uploaded_at=iso(moment),
                                        seq=seq2, duplicate_of=upload_id,
                                        upload_key=str(uuid.UUID(int=rng.getrandbits(128))))
                            self.uploads.append(twin)
                            item['active'].append(twin)
                            self.event(moment, actor, 'upload', client, request_id, item_id,
                                       upload_id=twin['upload_id'], details_template='הועלה קובץ: {file}')
                    item['status'] = 'received'
                    item['updated_at'] = moment
                    item['updated_by'] = by
                    names.append(DOC_NAMES[doc])
                for doc, note in data['na'].items():
                    if items[doc]['status'] != 'missing':
                        continue
                    items[doc].update(status='not_applicable', na_note=note, updated_at=moment, updated_by='client')
                    self.event(moment, actor, 'na', client, request_id, f'{request_id}_{doc}',
                               details="סומן 'לא היה לי': " + DOC_NAMES[doc] + (('. הערה: ' + note) if note else ''))
                if data['note']:
                    req['client_note'] = data['note']
                    self.event(moment, actor, 'client_note', client, request_id,
                               details='הערה מהלקוח: ' + data['note'])
                if names:
                    who = 'המשרד העלה בשם הלקוח: ' if by != 'client' else 'העלה '
                    activity(moment, who + ', '.join(names))
                elif data['na']:
                    activity(moment, "סימן 'לא היה לי': " + ', '.join(DOC_NAMES[d] for d in data['na']))
                if data['bad']:
                    state['pending_reject'] = True
                    reason_kind = next((u['doc']['quality'] for u in items[data['bad']]['active']
                                        if u['doc']['quality'] != 'ok'), 'blurry')
                    push(specials.get('reject_at') or staff_time_after(rng, moment, 0.75, 1), 'reject',
                         {'doc': data['bad'],
                          'reason': specials.get('reject_reason') or rng.choice(REJECT_REASONS[reason_kind])})
                settle(moment)
            elif kind == 'reminder':
                if req['status'] in ('not_started', 'partial'):
                    self.message(t, data['template'], cycle,
                                 {'due': cycle['due'].isoformat(), 'missing': missing()},
                                 client=client, request_id=request_id, horizon=horizon)
                    req['reminder_count'] += 1
                    req['last_reminder_at'] = t
            elif kind == 'whatsapp':
                if req['status'] in ('not_started', 'partial'):
                    req['reminder_count'] += 1
                    req['last_reminder_at'] = t
                    self.event(t, 'staff:' + bookkeeper, 'whatsapp', client, request_id,
                               details='נפתח וואטסאפ עם תזכורת: חסר ' + ', '.join(DOC_NAMES[m['doc']] for m in missing()))
            elif kind == 'reject':
                doc = data['doc']
                item = items[doc]
                for u in item['active']:
                    u['status'] = 'rejected'
                item['active'] = []
                item.update(status='rejected', reject_reason=data['reason'], updated_at=t, updated_by=bookkeeper)
                state['pending_reject'] = False
                state['approve_planned'] = False
                if req['completed_at']:
                    req['completed_at'], req['completed_by'] = None, ''   # data model 3.2
                self.event(t, 'staff:' + bookkeeper, 'reject', client, request_id, f'{request_id}_{doc}',
                           details='סומן לא קריא: ' + DOC_NAMES[doc] + '. הסיבה: ' + data['reason'])
                activity(t, 'המשרד סימן לא קריא: ' + DOC_NAMES[doc])
                self.reject_times.setdefault(cycle['cycle_id'], []).append(t)
                self.message(t, 'REJECTED', cycle, {'doc': doc, 'reason': data['reason']},
                             client=client, request_id=request_id, horizon=horizon)
                if 'reupload_at' in specials:
                    session(specials['reupload_at'], [doc])
                elif rng.random() < 0.8:
                    session(client_time_between(rng, t + timedelta(hours=2), t + timedelta(days=3)), [doc])
                else:
                    next_reminder = min([sched[x] for x in ('REMINDER_1', 'REMINDER_2', 'LAST_DAY') if sched[x] > t],
                                        default=call)
                    session(client_time_between(rng, next_reminder + timedelta(hours=1), next_reminder + timedelta(days=1)), [doc])
                settle(t)
            elif kind == 'approve':
                state['approve_planned'] = False
                if req['status'] == 'submitted' and not state['pending_reject']:
                    req['completed_at'], req['completed_by'] = t, bookkeeper
                    self.event(t, 'staff:' + bookkeeper, 'approve', client, request_id,
                               details='בדקתי, תקין: המסמכים של ' + month_label(cycle['cycle_id']) + ' נבדקו')
                    activity(t, 'המשרד אישר: בדקתי, תקין')
                    settle(t)
            elif kind == 'manual_complete':
                if req['status'] != 'complete':
                    req['completed_at'], req['completed_by'] = t, bookkeeper
                    req['completion_note'] = data['note']
                    self.event(t, 'staff:' + bookkeeper, 'complete_manual', client, request_id,
                               details='סומן הושלם ידנית: ' + data['note'])
                    activity(t, 'המשרד סימן הושלם: ' + data['note'])
                    settle(t)
            elif kind == 'new_link':
                client['token_created_at'] = iso(t)
                self.event(t, 'staff:' + bookkeeper, 'new_link', client,
                           details='נוצר קישור חדש, והקישור הקודם הפסיק לעבוד. הסיבה: ' + data['reason'])
                self.message(t, 'NEW_LINK', cycle, {}, client=client, request_id=request_id, horizon=horizon)

        # -------- the rows of this request --------

        self.requests.append({
            'request_id': request_id, 'cycle_id': cycle['cycle_id'], 'client_id': cid,
            'period': period, 'status': req['status'], 'reminder_count': req['reminder_count'],
            'last_reminder_at': iso(req['last_reminder_at']),
            'last_activity': req['last_activity'] or 'נשלחה בקשה',
            'last_activity_at': iso(req['last_activity_at'] or opened),
            'client_note': req['client_note'], 'submitted_at': iso(req['submitted_at']),
            'completed_at': iso(req['completed_at']), 'completed_by': req['completed_by'],
            'completion_note': req['completion_note'],
        })
        for doc in docs:
            item = items[doc]
            self.items.append({
                'item_id': f'{request_id}_{doc}', 'request_id': request_id, 'doc_type_id': doc,
                'required': doc != 'OTHER', 'status': item['status'], 'file_count': len(item['active']),
                'na_note': item['na_note'], 'reject_reason': item['reject_reason'],
                'updated_at': iso(item['updated_at']), 'updated_by': item['updated_by'],
                'last_seq': item['last_seq'],
            })
        return req

    # ------------------------------------------------------------------------------------------

    def status_at(self, request_id, t):
        status, miss = 'not_started', []
        for when, s, m in self.timelines[request_id]:
            if when <= t:
                status, miss = s, m
        return status, miss

    def run_cycle(self, cycle, clients, specials_for):
        sched = schedule(cycle)
        horizon = cycle['closed'] or SNAPSHOT
        cid = cycle['cycle_id']
        members = [c for c in clients if c['frequency'] == 'monthly' or cycle['bimonthly']]
        due_at_open = cycle.get('due_initial', cycle['due'])

        self.event(cycle['opened'], 'system', 'cycle_open',
                   details=f'נפתח מחזור {month_label(cid)}: {len(members)} בקשות. תאריך היעד: {fmt_date(due_at_open)}')
        if cycle.get('due_changed_at'):
            self.event(cycle['due_changed_at'], 'staff:S1', 'due_date_change',
                       details=(f"תאריך היעד הוזז מ-{fmt_date(cycle['due_initial'])} ל-{fmt_date(cycle['due'])}: "
                                'ראש השנה נופל בשבת, 12/09'))

        for client in members:
            persona = client['persona'] if cycle['closed'] is None else persona_for_month(self.rng, client['persona'])
            specials = specials_for(cycle, client, sched)
            persona = specials.get('persona', persona)
            # The request of day 1, with the due date as it was at that moment.
            docs = PROFILE_DOCS[client['profile_id']] + (['EMPLOYEE_HOURS'] if client['has_employees'] else [])
            docs.sort(key=DOC_ORDER.index)
            self.message(cycle['opened'], 'REQUEST', cycle, {'due': due_at_open.isoformat(), 'docs': docs},
                         client=client, request_id=f"{cid}_{client['client_id']}", horizon=horizon)
            self.run_request(cycle, sched, horizon, client, persona, specials)

        # The call list for each bookkeeper, and the summary for the owner (brief.md).
        for step in ('CALL_LIST', 'SUMMARY'):
            t = sched[step]
            if t > horizon:
                continue
            rows = []
            for client in members:
                rid = f"{cid}_{client['client_id']}"
                status, miss = self.status_at(rid, t)
                rows.append((client, status, miss))
            if step == 'CALL_LIST':
                for staff_id in BOOKKEEPERS:
                    late = [{'client_id': c['client_id'], 'missing': m} for c, s, m in rows
                            if c['bookkeeper_id'] == staff_id and s in ('not_started', 'partial')]
                    if late:
                        self.message(t, 'CALL_LIST', cycle, {'due': cycle['due'].isoformat(), 'clients': late},
                                     staff_id=staff_id, horizon=horizon)
            else:
                done = [c for c, s, m in rows if s in ('submitted', 'complete')]
                late = [c['client_id'] for c, s, m in rows if s in ('not_started', 'partial')]
                rejected = len([x for x in self.reject_times.get(cid, []) if x <= t])
                self.message(t, 'SUMMARY', cycle, {'x': len(done), 'y': len(rows), 'late': late,
                                                   'rejected_count': rejected},
                             staff_id='S1', horizon=horizon)

        if cycle['closed']:
            final = [r for r in self.requests if r['cycle_id'] == cid]
            complete = len([r for r in final if r['status'] == 'complete'])
            self.event(cycle['closed'], 'system', 'cycle_close',
                       details=f'מחזור {month_label(cid)} נסגר: {complete} מתוך {len(final)} בקשות הושלמו')

        self.cycle_rows.append({
            'cycle_id': cid, 'due_date': cycle['due'].isoformat(),
            'includes_bimonthly': cycle['bimonthly'],
            'status': 'closed' if cycle['closed'] else 'open',
            'opened_at': iso(cycle['opened']), 'closed_at': iso(cycle['closed']),
            'reminder1_sent_at': iso(sched['REMINDER_1']) if sched['REMINDER_1'] <= horizon else '',
            'reminder2_sent_at': iso(sched['REMINDER_2']) if sched['REMINDER_2'] <= horizon else '',
            'last_day_sent_at': iso(sched['LAST_DAY']) if sched['LAST_DAY'] <= horizon else '',
            'call_list_sent_at': iso(sched['CALL_LIST']) if sched['CALL_LIST'] <= horizon else '',
            'summary_sent_at': iso(sched['SUMMARY']) if sched['SUMMARY'] <= horizon else '',
        })


def persona_for_month(rng, base):
    """Small changes from month to month, as in real life (D36)."""
    r = rng.random()
    if base == 'early':
        return 'early' if r < 0.8 else 'after_reminder'
    if base == 'after_reminder':
        return 'after_reminder' if r < 0.7 else ('early' if r < 0.85 else 'last_minute')
    if base == 'last_minute':
        return 'last_minute' if r < 0.75 else 'after_reminder'
    return 'unreadable' if r < 0.65 else 'early'


# ----------------------------------------------------------------------------------------------
# Special cases: the edge cases of brief.md that the history shows (D36)
# ----------------------------------------------------------------------------------------------


def make_specials(rng, clients):
    by_persona = {}
    for c in clients:
        by_persona.setdefault(c['persona'], []).append(c)
    monthly = lambda group: [c for c in group if c['frequency'] == 'monthly' and c['business_name'] != BAKERY]
    early = monthly(by_persona['early'])
    last_minute = monthly(by_persona['last_minute'])
    pick = rng.sample

    with_suppliers = [c for c in early if 'SUPPLIER_INVOICES' in PROFILE_DOCS[c['profile_id']]]
    aug_duplicate = pick(with_suppliers, 1)[0]
    aug_manual, aug_never = pick(last_minute, 2)
    sep_whatsapp = pick([c for c in last_minute if c not in (aug_manual, aug_never)], 2)
    sep_new_link = pick([c for c in early if c is not aug_duplicate], 1)[0]
    sep_after_complete = pick([c for c in early if c not in (aug_duplicate, sep_new_link)], 1)[0]
    oct_whatsapp = pick(monthly(by_persona['last_minute']) + monthly(by_persona['after_reminder']), 3)
    bakery = next(c for c in clients if c['business_name'] == BAKERY)

    def specials_for(cycle, client, sched):
        cid = cycle['cycle_id']
        out = {}
        if cid == '2026-08':
            if client is aug_duplicate:
                out.update(persona='early', extra={'duplicate': 'SUPPLIER_INVOICES'})
            if client is aug_manual:
                out.update(persona='last_minute', manual_complete=True)
            if client is aug_never:
                out.update(persona='last_minute', never_finish=True)
        if cid == '2026-09':
            if client in sep_whatsapp:
                out.update(persona='last_minute', via_whatsapp=True)
            if client is sep_new_link:
                out['events'] = [(at(2026, 10, 14, 11, 20), 'new_link',
                                  {'reason': 'הלקוח החליף טלפון וביקש קישור חדש'})]
            if client is sep_after_complete:
                out['persona'] = 'early'
                # An upload after everything was complete: received and logged, the status stays.
                late = at(2026, 10, 15, 19, 40)
                out['events'] = [(late, 'session', {'docs': ['OTHER'], 'na': {}, 'bad': None,
                                                    'note': 'קיבלנו מכתב מרשות המסים, מצרף לידיעתכם',
                                                    'by': 'client', 'source': None, 'extra': {}})]
        if cid == '2026-10':
            if client in oct_whatsapp:
                out['whatsapp_at'] = staff_time_after(rng, at(2026, 11, 9, 12), 0.5, 1)
            if client is bakery:
                out.update(persona='unreadable', script=bakery_october)
                out['reupload_at'] = at(2026, 11, 5, 13, 10)
                out['approve_at'] = at(2026, 11, 8, 10, 20)
                out['reject_at'] = at(2026, 11, 3, 10, 15)
                out['reject_reason'] = 'לא רואים את הסכומים'
        return out

    return specials_for, {
        'duplicate': aug_duplicate['client_id'], 'manual_complete': aug_manual['client_id'],
        'never_finish': aug_never['client_id'],
        'via_whatsapp': [c['client_id'] for c in sep_whatsapp],
        'new_link': sep_new_link['client_id'], 'after_complete': sep_after_complete['client_id'],
    }


def bakery_october(session, push, items):
    """The bakery in October, exactly as in the walkthrough of data-model.md (chapter 4)."""
    # Monday 2/11, 20:40: two photos of the bank statement (blurry) and one Z report.
    session(at(2026, 11, 2, 20, 40), ['BANK_STATEMENT', 'Z_REPORTS'], bad='BANK_STATEMENT',
            extra={'all_bad': True, 'files': {
                'BANK_STATEMENT': [{'format': 'jpg', 'source': 'camera', 'month': '2026-10', 'part': 1, 'parts': 2},
                                   {'format': 'jpg', 'source': 'camera', 'month': '2026-10', 'part': 2, 'parts': 2}],
                'Z_REPORTS': [{'format': 'pdf', 'source': 'download', 'month': '2026-10'}]}})
    # Thursday 5/11, 13:10, after the reminder: the rest, and "לא היה לי" for the credit card.
    session(at(2026, 11, 5, 13, 10), ['SUPPLIER_INVOICES', 'EMPLOYEE_HOURS'],
            {'CREDIT_CARD': 'לא השתמשנו בכרטיס החודש'})


# ----------------------------------------------------------------------------------------------
# Checks: the rules of the calendar and of the data model hold in the output
# ----------------------------------------------------------------------------------------------


def check(office):
    problems = []
    parse = datetime.fromisoformat
    for u in office.uploads:
        t = parse(u['uploaded_at'])
        ok = client_ok(t) if u['uploaded_by'] == 'client' else staff_day(t.date())
        if not ok:
            problems.append(f"upload at a forbidden time: {u['upload_id']} {u['uploaded_at']}")
    for row in office.log:
        t = parse(row['at'])
        if row['actor'].startswith('staff:') and not staff_day(t.date()):
            problems.append(f"office action on a day off: {row['event']} {row['at']}")
        if row['actor'].startswith('client:') and not client_ok(t):
            problems.append(f"client action at a forbidden time: {row['event']} {row['at']}")
    for m in office.messages:
        if m['sent_at'] and not system_ok(parse(m['sent_at'])):
            problems.append(f"message at a quiet time: {m['template_id']} {m['sent_at']}")
    active = {}
    for u in office.uploads:
        if u['status'] == 'active':
            active[u['item_id']] = active.get(u['item_id'], 0) + 1
    for item in office.items:
        if item['file_count'] != active.get(item['item_id'], 0):
            problems.append(f"file count does not match: {item['item_id']}")
        if item['status'] == 'received' and item['file_count'] == 0:
            problems.append(f"received without files: {item['item_id']}")
    ids = [u['upload_id'] for u in office.uploads]
    if len(ids) != len(set(ids)):
        problems.append('upload IDs repeat')
    assets = {}
    for u in office.uploads:
        if not u['duplicate_of']:
            if u['asset'] in assets:
                problems.append(f"asset used twice: {u['asset']}")
            assets[u['asset']] = True
    if problems:
        raise SystemExit('Checks failed:\n' + '\n'.join(problems[:30]))


# ----------------------------------------------------------------------------------------------


def main():
    rng = random.Random(RANDOM_SEED)
    clients = build_clients(rng)
    office = Office(rng, clients)
    specials_for, special_ids = make_specials(rng, clients)
    for cycle in CYCLES:
        office.run_cycle(cycle, clients, specials_for)

    office.uploads.sort(key=lambda u: (u['uploaded_at'], u['upload_id']))
    office.messages.sort(key=lambda m: (m['created_at'], m['template_id'], m['client_id'], m['staff_id']))
    for i, m in enumerate(office.messages):
        m['message_id'] = f'M{i + 1:05d}'
    office.log.sort(key=lambda r: r['at'])
    check(office)

    seed = {
        'format': 1,
        'generator': 'demo/generate_seed.py',
        'snapshot': iso(SNAPSHOT),
        'assets_base': ASSETS_BASE,
        'holidays': [{'date': d.isoformat(), 'name': n} for d, n in sorted(HOLIDAYS.items())],
        'staff': STAFF,
        'clients': [{k: v for k, v in c.items() if k != 'persona'} for c in clients],
        'cycles': office.cycle_rows,
        'requests': office.requests,
        'items': office.items,
        'uploads': office.uploads,
        'messages': office.messages,
        'log': office.log,
    }
    body = json.dumps(seed, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    seed['seed_id'] = hashlib.sha256(body.encode('utf-8')).hexdigest()[:12]
    OUT.write_text(json.dumps(seed, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n',
                   encoding='utf-8')

    # A short report.
    print(f"seed {seed['seed_id']} -> {OUT} ({OUT.stat().st_size // 1024} KB)")
    for cycle in office.cycle_rows:
        rows = [r for r in office.requests if r['cycle_id'] == cycle['cycle_id']]
        count = {s: len([r for r in rows if r['status'] == s]) for s in ('complete', 'submitted', 'partial', 'not_started')}
        print(f"{cycle['cycle_id']} ({cycle['status']}): {len(rows)} requests, {count}")
    files = office.uploads
    print(f"uploads: {len(files)} (jpg {len([u for u in files if u['doc']['format'] == 'jpg'])}, "
          f"pdf {len([u for u in files if u['doc']['format'] == 'pdf'])}, "
          f"rejected {len([u for u in files if u['status'] == 'rejected'])}, "
          f"by the office {len([u for u in files if u['uploaded_by'] != 'client'])})")
    templates = {}
    for m in office.messages:
        templates[m['template_id']] = templates.get(m['template_id'], 0) + 1
    print(f"messages: {len(office.messages)} {templates}")
    print(f"log: {len(office.log)} rows. items: {len(office.items)}")
    print(f"special cases: {special_ids}")
    personas = {}
    for c in clients:
        personas[c['persona']] = personas.get(c['persona'], 0) + 1
    print(f"personas: {personas}. bookkeepers: S2 {len([c for c in clients if c['bookkeeper_id'] == 'S2'])}, "
          f"S3 {len([c for c in clients if c['bookkeeper_id'] == 'S3'])}")


if __name__ == '__main__':
    main()
