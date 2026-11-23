"""Nelio video rig: plays the whole story of the trailer (project/video-script.md, draft 3) on the
local copy of the system and photographs every screen the edit needs.

    python3 load.py                       # a fresh copy of the demo database
    node --experimental-transform-types server.mjs &
    python3 story.py out                  # about five minutes

Everything happens for real, in the real pages and the real server code: the demo is reset to
Monday 9/11 19:30, jumps to Wednesday 11/11 09:00 ("מחר היום האחרון" goes out to 12 clients),
David uploads three photos, the office marks the bank statement unreadable, David photographs it
again, the office approves, and on Friday 13/11 the owner gets the October summary.
The result: PNG stills (phone 1236 × 2772, office 3200 × 1800, "before" 3840 × 2160), a few short
MP4 clips of the moving parts, and shots.json with the size of every picture and the boxes
(x, y, width, height, in its pixels) of what the edit zooms to or marks."""
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import psycopg

from browser import DAVID_LINK, OFFICE, VIDEO, Rig
import pages

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / 'out').resolve()
DOCS = HERE / 'pages' / 'docs'
DSN = 'host=localhost port=%s user=postgres dbname=nelio' % __import__('os').environ.get('NELIO_PG_PORT', '54329')
SHOTS = {}


def sql(q, *args):
    with psycopg.connect(DSN, autocommit=True) as c:
        return c.execute(q, args).fetchall()


def demo(payload):
    return sql('select public.nelio_demo(%s::jsonb)', json.dumps(payload))[0][0]


def latest_message(client, template):
    rows = sql("select subject, body, to_char(created_at at time zone 'Asia/Jerusalem','HH24:MI') from public.messages "
               "where coalesce(client_id,'')=%s and template_id=%s order by created_at desc limit 1", client, template)
    return rows[0]


# ---------- recording helpers ----------

def scale_of(page):
    return page.evaluate('devicePixelRatio')


def box(page, locator, pad=0):
    b = locator.first.bounding_box()
    s = scale_of(page)
    return [round((b['x'] - pad) * s), round((b['y'] - pad) * s), round((b['width'] + 2 * pad) * s), round((b['height'] + 2 * pad) * s)]


def shot(page, name, scene, note='', boxes=None, element=None):
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(250)
    (element or page).screenshot(path=str(path))
    from PIL import Image
    w, h = Image.open(path).size
    SHOTS[name] = {'scene': scene, 'size': [w, h], 'note': note, 'boxes': boxes or {}}
    print('  ', name)


def clip(page, name, scene, seconds, note='', element=None, start=0.0, prepare=None):
    """Plays the page's own CSS animations frame by frame (30 per second) and encodes an MP4."""
    frames = OUT / '_frames'
    shutil.rmtree(frames, ignore_errors=True)
    frames.mkdir(parents=True)
    if prepare:
        page.evaluate(prepare)
    page.evaluate('document.getAnimations().forEach(a=>a.pause())')
    n = int(seconds * 30)
    for i in range(n):
        t = (start + i / 30) * 1000
        page.evaluate(f'document.getAnimations().forEach(a=>{{a.currentTime={t}}})')
        (element or page).screenshot(path=str(frames / f'{i:04d}.jpg'), type='jpeg', quality=92)
    page.evaluate('document.getAnimations().forEach(a=>a.play())')
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + '.part.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', str(frames / '%04d.jpg'),
                    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '18',
                    '-preset', 'veryfast', '-movflags', '+faststart', str(tmp)], check=True)
    tmp.rename(path)
    shutil.rmtree(frames)
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                            '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout.strip().split(',')
    SHOTS[name] = {'scene': scene, 'size': [int(probe[0]), int(probe[1])], 'seconds': seconds, 'note': note, 'boxes': {}}
    print('  ', name)


# ---------- the client's phone ----------

def open_doc(page, name):
    li = page.locator('li.doc', has_text=name)
    if li.locator('.doc-panel').first.is_hidden():
        li.locator('.doc-row').click()
    return li


def upload(page, doc_name, file_path, file_name):
    li = open_doc(page, doc_name)
    li.scroll_into_view_if_needed()
    with page.expect_file_chooser() as fc:
        li.locator('.doc-panel .actions button').first.click()
    data = Path(file_path).read_bytes()
    fc.value.set_files(files=[{'name': file_name, 'mimeType': 'image/jpeg', 'buffer': data}])
    page.wait_for_function('(n)=>[...document.querySelectorAll("li.doc")].some(li=>li.textContent.includes(n)&&li.dataset.state==="received")',
                           arg=doc_name, timeout=30000)
    page.wait_for_timeout(600)


def top(page):
    page.evaluate('window.scrollTo(0,0)')
    page.wait_for_timeout(300)


def phone_mail(rig, name_inbox, subject, body, scene, when='09:00', owner=False, highlight=None, prefix='phone'):
    """The inbox as the mail lands (clip + stills), and the open message (plain and marked)."""
    snippet = body.split('\n')[1] if '\n' in body else body
    p = rig.phone()
    pages.inbox(name_inbox + '_inbox.html', subject, snippet, time=when, owner=owner, arriving=True, notification=True)
    p.goto(VIDEO + name_inbox + '_inbox.html')
    p.evaluate('document.fonts.ready')
    p.wait_for_timeout(400)
    clip(p, f'{prefix}/{name_inbox}_arrives.mp4', scene, 2.0, 'the mail lands: banner from the top, the row slides in')
    pages.inbox(name_inbox + '_inbox_still.html', subject, snippet, time=when, owner=owner)
    p.goto(VIDEO + name_inbox + '_inbox_still.html'); p.evaluate('document.fonts.ready')
    shot(p, f'{prefix}/{name_inbox}_inbox.png', scene, 'the inbox with the new mail on top', {'new_mail': box(p, p.locator('.row.new'))})
    pages.inbox(name_inbox + '_inbox_note.html', subject, snippet, time=when, owner=owner, notification=True)
    p.goto(VIDEO + name_inbox + '_inbox_note.html'); p.evaluate('document.fonts.ready'); p.wait_for_timeout(900)
    shot(p, f'{prefix}/{name_inbox}_notification.png', scene, 'the banner over the inbox', {'banner': box(p, p.locator('.note'))})
    html = pages.email_html(body)
    pages.message(name_inbox + '_open.html', subject, html, time=when, owner=owner)
    p.goto(VIDEO + name_inbox + '_open.html'); p.evaluate('document.fonts.ready'); p.wait_for_timeout(500)
    boxes = {'subject': box(p, p.locator('h1'))}
    if p.locator('a', has_text='העלאת המסמכים').count():
        boxes['button'] = box(p, p.locator('a', has_text='העלאת המסמכים'))
    shot(p, f'{prefix}/{name_inbox}_open.png', scene, 'the mail opened (the office address is left out: Fiverr)', boxes)
    if highlight:
        for i, h in enumerate(highlight):
            pages.message(name_inbox + f'_marked{i}.html', subject, html, time=when, owner=owner, highlight=h)
            p.goto(VIDEO + name_inbox + f'_marked{i}.html'); p.evaluate('document.fonts.ready'); p.wait_for_timeout(500)
            shot(p, f'{prefix}/{name_inbox}_marked{"" if len(highlight) == 1 else i + 1}.png', scene,
                 'the same, with a highlighter on: ' + h, {'marked': box(p, p.locator('mark'), pad=6)})
    p.context.close()


def camera_shots(rig, name, photo, scene, shaky=False):
    DOCS.mkdir(parents=True, exist_ok=True)
    shutil.copy(photo, DOCS / Path(photo).name)
    url = VIDEO + 'docs/' + Path(photo).name
    p = rig.phone()
    for state in (['shake'] if shaky else []) + ['', 'press']:
        pages.camera(f'cam_{name}_{state or "look"}.html', url, url, state)
        p.goto(VIDEO + f'cam_{name}_{state or "look"}.html'); p.wait_for_timeout(500)
        if state == 'shake':
            clip(p, f'phone/camera_{name}_shaky.mp4', scene, 1.5, 'the hand shakes on purpose: this is the photo that comes out blurry')
        else:
            shot(p, f'phone/camera_{name}_{state or "look"}.png', scene,
                 'the camera, before the shot' if not state else 'the finger on the button')
    pages.camera(f'cam_{name}_flash.html', url, url, 'flashing')
    p.goto(VIDEO + f'cam_{name}_flash.html'); p.wait_for_timeout(200)
    clip(p, f'phone/camera_{name}_flash.mp4', scene, 0.5, 'the shutter flash')
    p.context.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    docs = HERE / 'work' / 'docs'
    if not docs.is_dir():
        sys.exit('First: python3 make_docs.py work/docs')
    print('reset to Monday 9/11 19:30:', demo({'action': 'reset', 'actor': 'S1', 'confirm': 'איפוס'}))
    with Rig() as rig:
        # ---------------- Act 1: the "before" screens (video/before.html) ----------------
        print('Act 1')
        b = rig.desktop(1920, 1080, 2)
        b.goto(VIDEO + 'before.html'); b.evaluate('document.fonts.ready'); b.wait_for_timeout(800)
        b.keyboard.press('1'); b.wait_for_timeout(500)
        phone_el = b.locator('#s1 .phone')
        shot(b, 'before/s1_owner_question_typing.png', 'ס1', 'the owner asks, typing dots on', {'question': box(b, b.locator('#s1 .msg').last)})
        shot(b, 'before/s1_owner_question_typing_phone.png', 'ס1', 'the same, only the phone', element=phone_el)
        clip(b, 'before/s1_owner_question_typing.mp4', 'ס1', 2.4, 'the typing dots move', element=phone_el)
        b.keyboard.press('t'); b.wait_for_timeout(300)
        shot(b, 'before/s3_owner_question_no_answer.png', 'ס3, ס15', 'the dots are gone: no answer')
        shot(b, 'before/s3_owner_question_no_answer_phone.png', 'ס3, ס15', 'the same, only the phone', element=phone_el)
        b.keyboard.press('2'); b.wait_for_timeout(200)
        clip(b, 'before/s2_clients_chat_scroll.mp4', 'ס2', 9.0, 'the clients chat scrolls up (9 s; speed it up in the edit)', element=b.locator('#s2 .phone'))
        b.keyboard.press('2'); b.wait_for_timeout(9500)
        shot(b, 'before/s2_clients_chat.png', 'ס2', 'the chat at the end of the scroll')
        shot(b, 'before/s2_clients_chat_phone.png', 'ס2', 'the same, only the phone', element=b.locator('#s2 .phone'))
        b.keyboard.press('3'); b.wait_for_timeout(400)
        shot(b, 'before/s2_downloads_folder.png', 'ס2', 'the downloads folder, IMG_4471.jpg selected',
             {'img_4471': box(b, b.locator('#s3 tr.pick'))})
        shot(b, 'before/s2_downloads_folder_window.png', 'ס2', 'the same, only the window', element=b.locator('#s3 .window'))
        b.keyboard.press('4'); b.wait_for_timeout(400)
        shot(b, 'before/s2_tracking_sheet.png', 'ס2', 'the tracking sheet with red cells',
             {'david_row': box(b, b.locator('#grid tr', has_text='מחשב עד הבית'))})
        shot(b, 'before/s2_tracking_sheet_window.png', 'ס2', 'the same, only the window', element=b.locator('#s4 .window'))
        b.context.close()

        # ---------------- Wednesday 11/11 09:00: the last-day reminder ----------------
        print('jump to Wednesday 11/11 09:00:', json.dumps(demo({'action': 'jump', 'actor': 'S1', 'target': '2026-11-11T09:00:00+02:00'}), ensure_ascii=False)[:200])
        office = rig.desktop(1600, 900, 2)
        office.goto(OFFICE); office.wait_for_selector('#dashboard:not([hidden])', timeout=20000); office.wait_for_timeout(1200)
        office.select_option('#actor', 'S2'); office.wait_for_timeout(300)

        before_row = {}

        def board(name, scene, note, glow=False, remember=False, as_before=None):
            office.goto(OFFICE); office.wait_for_selector('#dashboard:not([hidden])'); office.wait_for_timeout(1500)
            office.select_option('#actor', 'S2')
            row = office.locator('#panel-clients tbody tr', has_text='מחשב עד הבית')
            office.evaluate('(y)=>window.scrollTo(0,y)', row.bounding_box()['y'] + office.evaluate('scrollY') - 520)
            office.wait_for_timeout(300)
            if remember:
                before_row['html'] = row.inner_html()
            shot(office, name, scene, note, {'david_row': box(office, row), 'summary_cards': box(office, office.locator('.summary'))})
            if as_before and before_row:
                now_html = row.inner_html()
                row.evaluate('(r,h)=>{r.innerHTML=h}', before_row['html'])
                shot(office, as_before, scene, 'the same frame, with David\'s row as it was before the upload (for the change in place)', {'david_row': box(office, row)})
                row.evaluate('(r,h)=>{r.innerHTML=h}', now_html)
            if glow:
                row.evaluate("r=>{r.style.outline='3px solid #E0A526';r.style.outlineOffset='-1px';r.style.background='#FFF3D6';"
                             "r.style.boxShadow='0 0 0 8px rgba(224,165,38,.22),0 0 40px rgba(224,165,38,.35)'}")
                shot(office, name.replace('.png', '_glow.png'), scene, note + ' (David\'s row lit)', {'david_row': box(office, row)})

        print('Office board before David uploads')
        board('office/s9_board_before.png', 'ס9', 'the board on 11/11 09:00; David (מחשב עד הבית) is "השלימו חלק"', remember=True)

        subject, body, when = latest_message('C04', 'LAST_DAY')
        print('David gets:', subject)
        phone_mail(rig, 's4_last_day', subject, body, 'ס4, ס5', when=when, highlight=['עוד חסר: חשבוניות שהוצאתי, קבלות על הוצאות, דף בנק'])

        # ---------------- David uploads ----------------
        print('Act 2: David on his phone')
        p = rig.phone()
        p.goto(DAVID_LINK); p.wait_for_selector('#title:not(.skeleton-text)'); p.evaluate('document.fonts.ready'); p.wait_for_timeout(500)
        shot(p, 'phone/s6_client_page_open.png', 'ס6', 'the personal page opens: the folder, "חסרים עוד 3"',
             {'title': box(p, p.locator('#title')), 'subtitle': box(p, p.locator('#subtitle')),
              'camera_button': box(p, p.locator('li.doc', has_text='חשבוניות שהוצאתי').locator('.doc-panel .actions button').first)})
        camera_shots(rig, 'invoices', docs / 'ISSUED_INVOICES_photo.jpg', 'ס7')
        upload(p, 'חשבוניות שהוצאתי', docs / 'ISSUED_INVOICES_photo.jpg', 'IMG_4469.jpg'); top(p)
        shot(p, 'phone/s7_after_first.png', 'ס7', 'the first ✓: חשבוניות שהוצאתי התקבל',
             {'first_row': box(p, p.locator('li.doc', has_text='חשבוניות שהוצאתי').locator('.doc-row'))})
        camera_shots(rig, 'receipts', docs / 'EXPENSE_RECEIPTS_photo.jpg', 'ס8')
        upload(p, 'קבלות על הוצאות', docs / 'EXPENSE_RECEIPTS_photo.jpg', 'IMG_4470.jpg'); top(p)
        shot(p, 'phone/s8_after_second.png', 'ס8', 'the second ✓')
        camera_shots(rig, 'bank', docs / 'BANK_STATEMENT_photo_blurry.jpg', 'ס8', shaky=True)
        upload(p, 'דף בנק', docs / 'BANK_STATEMENT_photo_blurry.jpg', 'IMG_4471.jpg')
        top(p); p.wait_for_timeout(1500)
        shot(p, 'phone/s8_done_stamp.png', 'ס8', 'the third ✓: "תודה, קיבלנו הכול" and the stamp',
             {'title': box(p, p.locator('#title')), 'stamp': box(p, p.locator('#stamp'))})
        clip(p, 'phone/s8_done_stamp.mp4', 'ס8', 1.6, 'the stamp lands (the page\'s own movement)',
             prepare="(()=>{const s=document.getElementById('stamp');s.classList.remove('animate');void s.offsetWidth;s.classList.add('animate');})()")

        print('Act 3: the office')
        board('office/s9_board_waiting.png', 'ס9', 'after the upload: David is "ממתין לבדיקה"', glow=True, as_before='office/s9_board_waiting_as_before.png')

        office.click('#tab-settings'); office.wait_for_timeout(1200)
        quiet = office.locator('#settings-quiet')
        friday = quiet.locator('label', has_text='שישי')
        office.evaluate('(y)=>window.scrollTo(0,y)', quiet.bounding_box()['y'] + office.evaluate('scrollY') - 300); office.wait_for_timeout(300)
        shot(office, 'office/s10_settings_quiet_hours.png', 'ס10', 'הגדרות: שעות שקט. Circle "שישי וערב חג, מהשעה 13:00"',
             {'quiet_hours': box(office, quiet), 'friday_line': box(office, friday, pad=8)})
        office.click('#tab-demo'); office.wait_for_timeout(1500)
        shot(office, 'office/s10_alt_demo_plan.png', '(reference)', 'מצב הדגמה: the plan of the month, for reference only (no step moved this month, so it does not show Shabbat; use the settings shot)')
        office.click('#tab-clients'); office.wait_for_timeout(500)

        def drawer():
            office.goto(OFFICE); office.wait_for_selector('#dashboard:not([hidden])'); office.wait_for_timeout(1200)
            office.select_option('#actor', 'S2')
            office.locator('#panel-clients tbody tr', has_text='מחשב עד הבית').locator('button.client-open').click()
            office.wait_for_selector('#detail-items .document-item'); office.wait_for_timeout(800)

        drawer()
        bank = office.locator('#detail-items .document-item', has_text='דף בנק')
        bank.scroll_into_view_if_needed()
        bank_name = bank.locator('.document-file span').first
        shot(office, 'office/s11_drawer_files.png', 'ס11', "David's folder: every file with its new name",
             {'bank_file_name': box(office, bank_name, pad=4), 'files': box(office, office.locator('#detail-items'))})
        real_name = bank_name.text_content()
        bank_name.evaluate("e=>{e.dataset.real=e.textContent;e.textContent='IMG_4471.jpg'}")
        shot(office, 'office/s11_drawer_files_before_rename.png', 'ס11', 'the same frame with the name the photo came with (IMG_4471.jpg), for the crossfade',
             {'bank_file_name': box(office, bank_name, pad=4)})
        bank_name.evaluate('e=>{e.textContent=e.dataset.real}')
        SHOTS['office/s11_drawer_files.png']['note'] += ': ' + real_name

        bank.locator('button', has_text='צפייה').click()
        office.wait_for_selector('#inline-preview:not([hidden]) img', timeout=15000); office.wait_for_timeout(1200)
        shot(office, 'office/s12_preview_blurry.png', 'ס12', 'the bank statement in the preview: blurry',
             {'preview': box(office, office.locator('#inline-preview-content'))})
        office.click('#preview-expand'); office.wait_for_selector('#preview-modal:not([hidden]) img'); office.wait_for_timeout(1200)
        shot(office, 'office/s12_preview_blurry_large.png', 'ס12', 'the same, enlarged', {'document': box(office, office.locator('#preview-modal-content img'))})
        office.click('#preview-close'); office.wait_for_timeout(500)
        reject = bank.locator('button', has_text='לא קריא')
        reject.scroll_into_view_if_needed(); reject.hover(); office.wait_for_timeout(300)
        shot(office, 'office/s13_unreadable_button.png', 'ס13', 'the button "לא קריא…" (mouse on it)', {'button': box(office, reject, pad=6)})
        reject.click(); office.wait_for_selector('#action-dialog:not([hidden])'); office.wait_for_timeout(600)
        shot(office, 'office/s13_unreadable_dialog.png', 'ס13', 'the dialog: reason "התמונה מטושטשת" and the message to the client',
             {'dialog': box(office, office.locator('#action-dialog .action-pane')),
              'send': box(office, office.locator('#action-foot button', has_text='סימון'), pad=6)})
        office.locator('#action-foot button', has_text='סימון').click()
        office.wait_for_selector('#action-dialog', state='hidden'); office.wait_for_timeout(1500)
        shot(office, 'office/s13_after_unreadable.png', 'ס13', 'marked: the file is "(נדחה)" and the request to photograph again went out')

        subject, body, when = latest_message('C04', 'REJECTED')
        print('David gets:', subject)
        phone_mail(rig, 's14_again', subject, body, 'ס14', when=when)
        p.goto('about:blank'); p.goto(DAVID_LINK); p.wait_for_selector('#title:not(.skeleton-text)'); p.wait_for_timeout(800)
        li = open_doc(p, 'דף בנק'); li.scroll_into_view_if_needed(); p.wait_for_timeout(400)
        shot(p, 'phone/s14_client_page_again.png', 'ס14', 'the page: דף בנק is "לא קריא", with the reason',
             {'bank_row': box(p, li)})
        camera_shots(rig, 'bank_again', docs / 'BANK_STATEMENT_photo_retake.jpg', 'ס14')
        upload(p, 'דף בנק', docs / 'BANK_STATEMENT_photo_retake.jpg', 'IMG_4475.jpg')
        top(p); p.wait_for_timeout(1500)
        shot(p, 'phone/s14_done_again.png', 'ס14', 'the bank statement again ✓, everything received')
        p.context.close()

        drawer()
        approve = office.locator('#detail-actions button', has_text='בדקתי, תקין')
        approve.hover(); office.wait_for_timeout(300)
        shot(office, 'office/s14_approve_button.png', 'ס14', 'the folder with the new photo; "בדקתי, תקין"', {'button': box(office, approve, pad=6)})
        bank = office.locator('#detail-items .document-item', has_text='דף בנק')
        bank.locator('button', has_text='צפייה').first.click()
        office.wait_for_selector('#inline-preview:not([hidden]) img', timeout=15000); office.wait_for_timeout(1200)
        shot(office, 'office/s14_preview_sharp.png', 'ס14', 'the new photo of the bank statement: sharp')
        approve.click(); office.wait_for_timeout(2000)
        shot(office, 'office/s14_done.png', 'ס14', 'approved: "הושלם"', {'status': box(office, office.locator('#detail-meta'))})
        board('office/s14_board_done.png', 'ס14', 'the board: David is "הושלם"', glow=True)

        # ---------------- Friday 13/11 09:00: the summary ----------------
        print('jump to Friday 13/11 09:00:', json.dumps(demo({'action': 'jump', 'actor': 'S1', 'target': '2026-11-13T09:00:00+02:00'}), ensure_ascii=False)[:300])
        subject, body, when = latest_message('', 'SUMMARY')
        print('The owner gets:', subject)
        lines = [x for x in body.split('\n') if x.startswith('סיכום') or x.startswith('עוד לא השלימו')]
        phone_mail(rig, 's15_summary', subject, body, 'ס15', when=when, owner=True, highlight=lines, prefix='owner')
        board('office/s15_board_friday.png', 'ס15', 'the board on Friday 13/11, for reference')
    (OUT / 'shots.json').write_text(json.dumps(SHOTS, ensure_ascii=False, indent=1), encoding='utf-8')
    print(len(SHOTS), 'files ->', OUT)


if __name__ == '__main__':
    main()
