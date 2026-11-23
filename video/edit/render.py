"""Nelio trailer (project/video-script.md, draft 3): renders the whole video from the files on the
video-assets branch. 1920 × 1080, 30 fps, H.264, with the trailer's sound effects (no music yet).

    python3 video/edit/render.py ASSETS_FOLDER OUT.mp4            # the whole video
    python3 video/edit/render.py ASSETS_FOLDER OUT.mp4 --frames 3.0,20.5,35.5   # stills to check

Every scene is drawn frame by frame (Pillow) from a "world" picture and a camera that moves over
it, and encoded to its own file; the files are joined without re-encoding and the sound is added
last. The timeline below is the script: change a number there and render again."""
import json
import math
import shutil
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from scipy.io import wavfile

A = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2]).resolve()
CHECK = [float(x) for x in sys.argv[sys.argv.index('--frames') + 1].split(',')] if '--frames' in sys.argv else None
W, H, FPS = 1920, 1080, 30
SHOTS = json.loads((A / 'shots.json').read_text(encoding='utf-8'))
WARM = (236, 229, 215)
DARK = (31, 35, 38)
ACCENT = (224, 150, 38)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def seg(t, a, b):
    """0 before a, 1 after b, eased between."""
    return ease((t - a) / (b - a)) if b > a else float(t >= a)


def box_of(rel, name):
    return SHOTS[rel]['boxes'][name]


@lru_cache(maxsize=None)
def img(rel):
    return Image.open(A / rel).convert('RGB')


@lru_cache(maxsize=None)
def rgba(rel):
    return Image.open(A / rel).convert('RGBA')


@lru_cache(maxsize=2)          # a phone clip is ~10 MB a frame: keep only two in memory
def clip(rel):
    """All frames of a short clip, as Pillow images."""
    w, h = SHOTS[rel]['size']
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(A / rel), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    n = len(raw) // (w * h * 3)
    return [Image.frombuffer('RGB', (w, h), raw[i * w * h * 3:(i + 1) * w * h * 3], 'raw', 'RGB', 0, 1) for i in range(n)]


def clip_at(rel, t, speed=1.0, start=0.0):
    frames = clip(rel)
    i = int((start + t * speed) * FPS)
    return frames[max(0, min(len(frames) - 1, i))]


# ---------------------------------------------------------------- camera

class Cam:
    """A view of a world picture: center (cx, cy) and height h, in world pixels (16:9)."""

    def __init__(self, cx, cy, h):
        self.cx, self.cy, self.h = cx, cy, h

    def mix(self, other, t):
        return Cam(lerp(self.cx, other.cx, t), lerp(self.cy, other.cy, t), lerp(self.h, other.h, t))

    def box(self, world):
        ww, wh = world.size
        h = min(self.h, wh, ww * 9 / 16)
        w = h * 16 / 9
        x0 = min(max(self.cx - w / 2, 0), ww - w)
        y0 = min(max(self.cy - h / 2, 0), wh - h)
        return (x0, y0, x0 + w, y0 + h)

    def render(self, world):
        b = self.box(world)
        return world.resize((W, H), Image.LANCZOS, box=b), b


def fit(world_size, rect, margin=1.35, min_h=0, cy_shift=0.0):
    """The camera that shows rect (x, y, w, h) with some room around it."""
    x, y, w, h = rect
    ch = max(h * margin, w * margin * 9 / 16, min_h)
    return Cam(x + w / 2, y + h / 2 + cy_shift * ch, min(ch, world_size[1]))


def to_out(b, pt):
    """World point -> output pixel, for a camera box b."""
    x0, y0, x1, y1 = b
    return ((pt[0] - x0) * W / (x1 - x0), (pt[1] - y0) * H / (y1 - y0))


def rect_out(b, r):
    a = to_out(b, (r[0], r[1]))
    c = to_out(b, (r[0] + r[2], r[1] + r[3]))
    return (a[0], a[1], c[0], c[1])


# ---------------------------------------------------------------- drawing over the frame (2× for smooth edges)

def overlay(frame, draw_fn):
    ov = Image.new('RGBA', (W * 2, H * 2), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(ov), 2)
    ov = ov.resize((W, H), Image.LANCZOS)
    out = frame.convert('RGBA')
    out.alpha_composite(ov)
    return out.convert('RGB')


def tap(frame, center, t):
    """A finger tap: a dot and a ring that grows and fades, t from 0 to 1."""
    if not 0 <= t <= 1:
        return frame
    cx, cy = center

    def d(dr, k):
        r = (26 + 70 * ease(t)) * k
        a = int(200 * (1 - t))
        dr.ellipse([(cx * k - r), (cy * k - r), (cx * k + r), (cy * k + r)], outline=(255, 255, 255, a), width=5 * k)
        if t < 0.55:
            r2 = 24 * k
            dr.ellipse([(cx * k - r2), (cy * k - r2), (cx * k + r2), (cy * k + r2)], fill=(30, 30, 30, int(110 * (1 - t / 0.55))))
    return overlay(frame, d)


def circle(frame, r, t, pad=20):
    """A hand-drawn circle around r (output pixels), drawn from 0 to t (0..1)."""
    if t <= 0:
        return frame
    x0, y0, x1, y1 = r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad

    def d(dr, k):
        dr.arc([x0 * k, y0 * k, x1 * k, y1 * k], start=-120, end=-120 + 380 * min(1, t), fill=ACCENT + (255,), width=7 * k)
    return overlay(frame, d)


def outline(frame, r, a, pad=10):
    if a <= 0:
        return frame

    def d(dr, k):
        dr.rounded_rectangle([(r[0] - pad) * k, (r[1] - pad) * k, (r[2] + pad) * k, (r[3] + pad) * k], radius=10 * k,
                             outline=ACCENT + (int(255 * a),), width=5 * k)
    return overlay(frame, d)


# ---------------------------------------------------------------- worlds

WORLD = (3840, 2160)


@lru_cache(maxsize=4)
def backdrop(color, size=WORLD):
    """A flat color with a soft light in the middle."""
    w, h = size
    yy, xx = np.mgrid[0:h // 8, 0:w // 8].astype(float)
    d = np.hypot((xx - w / 16) / (w / 16), (yy - h / 16) / (h / 16))
    k = (1.04 - 0.12 * d ** 2)[..., None]
    a = np.clip(np.array(color, float)[None, None, :] * k, 0, 255).astype('uint8')
    return Image.fromarray(a).resize(size, Image.BICUBIC)


@lru_cache(maxsize=8)
def frame_scaled(s):
    # The PNG carries its own drop shadow, cut at the edges of its canvas: keep only the phone itself.
    f = rgba('frames/phone_frame.png').copy()
    f.putalpha(f.split()[3].point(lambda a: max(0, min(255, int((a - 118) * 255 / 137)))))
    return f.resize((round(f.width * s), round(f.height * s)), Image.LANCZOS)


@lru_cache(maxsize=8)
def shadow_scaled(s):
    """A soft shadow under the phone, 300 px of room on each side so the blur is never cut."""
    f = frame_scaled(s)
    sh = Image.new('RGBA', (f.width + 600, f.height + 600), (0, 0, 0, 0))
    m = Image.new('L', sh.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([300 + 30 * s, 300 + 90 * s, 300 + f.width - 30 * s, 300 + f.height + 40 * s],
                                        radius=int(160 * s), fill=int(255 * 0.30))
    sh.putalpha(m.filter(ImageFilter.GaussianBlur(55)))
    return sh


class Phone:
    """A phone in the world: frame height fh (world px), centered at (cx, cy)."""

    def __init__(self, cx=1920, cy=1080, fh=1900):
        self.s = fh / 3120
        self.x = round(cx - 1584 * self.s / 2)
        self.y = round(cy - fh / 2)

    def screen_rect(self, r):
        x, y, w, h = r
        return (self.x + (174 + x) * self.s, self.y + (174 + y) * self.s, w * self.s, h * self.s)

    def whole(self):
        return (self.x, self.y, 1584 * self.s, 3120 * self.s)

    def draw(self, world, screen, dim=0.0):
        s = self.s
        world.alpha_composite(shadow_scaled(s), (max(0, self.x - 300), max(0, self.y - 300)), (max(0, 300 - self.x), max(0, 300 - self.y)))
        scr = screen.resize((round(1236 * s), round(2772 * s)), Image.LANCZOS)
        if dim:
            scr = Image.blend(scr, Image.new('RGB', scr.size, (24, 24, 24)), dim)
        world.paste(scr, (self.x + round(174 * s), self.y + round(174 * s)))
        world.alpha_composite(frame_scaled(s), (self.x, self.y))
        return world


@lru_cache(maxsize=48)
def phone_world_cached(rel, cx, cy, fh, bg):
    return phone_world(img(rel), cx, cy, fh, bg)


def phone_world(screen, cx=1920, cy=1080, fh=1900, bg=WARM):
    world = backdrop(bg).convert('RGBA')
    Phone(cx, cy, fh).draw(world, screen)
    return world.convert('RGB')


def wipe(base, marked, rect, p):
    """The highlighter: reveals the marked picture inside rect, from right to left (Hebrew)."""
    if p <= 0:
        return base
    x, y, w, h = rect
    out = base.copy()
    cut = int(x + w * (1 - min(1, p)))
    region = marked.crop((cut, y - 8, x + w + 12, y + h + 8))
    out.paste(region, (cut, y - 8))
    return out


# ---------------------------------------------------------------- cards

@lru_cache(maxsize=None)
def card_text(name):
    return rgba(f'cards/{name}')


def card_frame(name, t, dur, fade_in=0.18, fade_out=0.0, z0=1.045, z1=1.0):
    text = card_text(name)
    z = lerp(z0, z1, t / dur)
    bw, bh = text.width / z, text.height / z
    b = ((text.width - bw) / 2, (text.height - bh) / 2, (text.width + bw) / 2, (text.height + bh) / 2)
    t_img = text.resize((W, H), Image.LANCZOS, box=b)
    a = min(1.0, t / fade_in) if fade_in else 1.0
    if fade_out:
        a *= min(1.0, (dur - t) / fade_out)
    bg = Image.new('RGBA', (W, H), (6, 6, 6, 255))
    if a < 1:
        t_img.putalpha(t_img.split()[3].point(lambda v: int(v * a)))
    bg.alpha_composite(t_img)
    return bg.convert('RGB')


# ---------------------------------------------------------------- the scenes (each: duration, frame(t))

BEFORE_PHONE = (1500, 220)          # where the phone sits in the 3840 × 2160 "before" frames


def before_with_clip(still, clip_rel, t, speed=1.0, start=0.0):
    w = img(still).copy()
    w.paste(clip_at(clip_rel, t, speed, start), BEFORE_PHONE)
    return w


def s1(t):          # the owner's question, typing dots
    world = before_with_clip('before/s1_owner_question_typing.png', 'before/s1_owner_question_typing.mp4', t % 2.4)
    q = box_of('before/s1_owner_question_typing.png', 'question')
    cam = Cam(1920, 1080, 2160).mix(fit(WORLD, q, 1.2, min_h=1250), ease(t / 2.5) * 0.85)
    return cam.render(world)[0]


def s2(t):          # the montage: chat, paper pile, downloads, the red sheet (1 s each)
    k, u = int(t), t - int(t)
    if k == 0:
        world = before_with_clip('before/s2_clients_chat.png', 'before/s2_clients_chat_scroll.mp4', u, speed=4.0, start=2.0)
        return Cam(1920, 1080, 2000).mix(Cam(1920, 1000, 1500), u).render(world)[0]
    if k == 1:
        return Cam(1920, 1080, 2160).mix(Cam(2010, 1040, 1800), u).render(img('stock/paper_pile.jpg'))[0]
    if k == 2:
        r = box_of('before/s2_downloads_folder.png', 'img_4471')
        return Cam(1920, 1200, 1500).mix(fit(WORLD, r, 1.05, min_h=1100, cy_shift=0.3), ease(u)).render(img('before/s2_downloads_folder.png'))[0]
    r = box_of('before/s2_tracking_sheet.png', 'david_row')
    return Cam(1920, 1150, 1500).mix(fit(WORLD, r, 1.05, min_h=1100, cy_shift=0.1), ease(u)).render(img('before/s2_tracking_sheet.png'))[0]


def s3(t):          # back to the question: the dots stop
    q = box_of('before/s1_owner_question_typing.png', 'question')
    world = before_with_clip('before/s1_owner_question_typing.png', 'before/s1_owner_question_typing.mp4', t) if t < 0.7 \
        else img('before/s3_owner_question_no_answer.png')
    cam = fit(WORLD, q, 1.2, min_h=1250).mix(fit(WORLD, q, 1.2, min_h=1050), t / 2.0)
    return cam.render(world)[0]


P = Phone()          # the phone, in the middle of the warm world


def phone_cam_full():
    return Cam(1920, 1080, 2160)


def s4(t):          # David's phone: the last-day mail lands
    scr = clip_at('phone/s4_last_day_arrives.mp4', min(t, 1.98))
    world = phone_world(scr)
    banner = P.screen_rect(box_of('phone/s4_last_day_notification.png', 'banner'))
    cam = phone_cam_full().mix(fit(WORLD, (banner[0], banner[1], banner[2], banner[3] * 3.2), 1.25, min_h=1300), ease((t - 0.8) / 2.2))
    return cam.render(world)[0]


def s5(t):          # the mail, and the highlighter on what is missing
    base, marked = img('phone/s4_last_day_open.png'), img('phone/s4_last_day_marked.png')
    r = box_of('phone/s4_last_day_marked.png', 'marked')
    world = phone_world(wipe(base, marked, r, seg(t, 0.7, 1.5)))
    target = fit(WORLD, P.screen_rect(r), 1.25, min_h=700)
    cam = Cam(1920, 1080, 1700).mix(target, seg(t, 0.0, 1.2))
    return cam.render(world)[0]


def s6(t):          # tap "העלאת המסמכים", the folder opens: "חסרים עוד 3"
    if t < 0.7:
        world = phone_world_cached('phone/s4_last_day_open.png', 1920, 1080, 1900, WARM)
        btn = P.screen_rect(box_of('phone/s4_last_day_open.png', 'button'))
        frame, b = fit(WORLD, btn, 2.6, min_h=900).render(world)
        c = to_out(b, (btn[0] + btn[2] / 2, btn[1] + btn[3] / 2))
        return tap(frame, c, (t - 0.15) / 0.5)
    world = phone_world_cached('phone/s6_client_page_open.png', 1920, 1080, 1900, WARM)
    sub = P.screen_rect(box_of('phone/s6_client_page_open.png', 'subtitle'))
    title = P.screen_rect(box_of('phone/s6_client_page_open.png', 'title'))
    both = (title[0], title[1], title[2], sub[1] + sub[3] - title[1])
    cam = Cam(1920, 1080, 2000).mix(fit(WORLD, both, 1.3, min_h=800), seg(t, 0.9, 2.0))
    return cam.render(world)[0]


def camera_seq(t, name, look_until, press_until, flash_until):
    """The camera app: looking, the finger on the button, the flash."""
    if t < look_until:
        return img(f'phone/camera_{name}_look.png')
    if t < press_until:
        return img(f'phone/camera_{name}_press.png')
    return clip_at(f'phone/camera_{name}_flash.mp4', t - press_until)


def s7(t):          # the first photo, then the first ✓
    if t < 0.9:
        world = phone_world(camera_seq(t, 'invoices', 0.45, 0.6, 0.9))
        return Cam(1920, 1080, 2160).mix(Cam(1920, 1080, 2000), t / 0.9).render(world)[0]
    world = phone_world_cached('phone/s7_after_first.png', 1920, 1080, 1900, WARM)
    row = P.screen_rect(box_of('phone/s7_after_first.png', 'first_row'))
    return Cam(1920, 1080, 1800).mix(fit(WORLD, row, 1.6, min_h=760), seg(t, 0.9, 1.5)).render(world)[0]


def s8(t):          # the second, the shaky bank statement, and the stamp
    full = Cam(1920, 1080, 2100)
    if t < 0.6:
        return full.render(phone_world(camera_seq(t, 'receipts', 0.3, 0.4, 0.6)))[0]
    if t < 1.0:
        return full.render(phone_world_cached('phone/s8_after_second.png', 1920, 1080, 1900, WARM))[0]
    if t < 1.6:
        return full.render(phone_world(clip_at('phone/camera_bank_shaky.mp4', t - 1.0)))[0]
    if t < 1.8:
        return full.render(phone_world(clip_at('phone/camera_bank_flash.mp4', t - 1.6)))[0]
    world = phone_world(clip_at('phone/s8_done_stamp.mp4', t - 1.8))
    stamp = P.screen_rect(box_of('phone/s8_done_stamp.png', 'stamp'))
    title = P.screen_rect(box_of('phone/s8_done_stamp.png', 'title'))
    top = (title[0], stamp[1], stamp[0] + stamp[2] - title[0], stamp[3])
    return full.mix(fit(WORLD, top, 1.3, min_h=900), seg(t, 2.1, 3.0)).render(world)[0]


PANEL = (230, 420, 2150, 1320)       # the office board in the split screen (world px)
P_SPLIT = Phone(cx=3060, cy=1080, fh=1820)


def board_panel(rel, row_rel=None):
    """A piece of the board around David's row, as it sits in the split screen."""
    r = box_of(row_rel or rel, 'david_row')
    src = img(rel)
    pw, ph = PANEL[2], PANEL[3]
    cw = r[2] + 260
    ch = cw * ph / pw
    cy = min(max(r[1] + r[3] / 2 - ch * 0.08, ch / 2), src.height - ch / 2)
    box = (r[0] - 130, cy - ch / 2, r[0] - 130 + cw, cy + ch / 2)
    return src.resize((pw, ph), Image.LANCZOS, box=box)


@lru_cache(maxsize=4)
def panel_cached(rel):
    return board_panel(rel, 'office/s9_board_waiting.png')


def s9(t):          # split screen: the phone, and David's row changing on the board
    world = backdrop(WARM).convert('RGBA')
    dim = 0.55 * seg(t, 0.35, 0.9)
    P_SPLIT.draw(world, img('phone/s8_done_stamp.png'), dim=dim)
    a, b, c = panel_cached('office/s9_board_waiting_as_before.png'), panel_cached('office/s9_board_waiting.png'), panel_cached('office/s9_board_waiting_glow.png')
    pnl = Image.blend(a, b, seg(t, 1.0, 1.3))
    pnl = Image.blend(pnl, c, seg(t, 1.6, 2.0))
    sh = Image.new('RGBA', (PANEL[2] + 120, PANEL[3] + 120), (0, 0, 0, 0))
    m = Image.new('L', sh.size, 0)
    m.paste(70, (60, 75, PANEL[2] + 60, PANEL[3] + 75))
    sh.putalpha(m.filter(ImageFilter.GaussianBlur(30)))
    world.alpha_composite(sh, (PANEL[0] - 60, PANEL[1] - 60))
    world.paste(pnl, (PANEL[0], PANEL[1]))
    d = ImageDraw.Draw(world)
    d.rectangle([PANEL[0] - 1, PANEL[1] - 1, PANEL[0] + PANEL[2], PANEL[1] + PANEL[3]], outline=(205, 196, 180), width=2)
    world = world.convert('RGB')
    return Cam(1920, 1080, 2160).mix(Cam(2000, 1150, 1700), seg(t, 0.8, 2.6)).render(world)[0]


OFFICE = (3200, 1800)


def office_full():
    return Cam(1600, 900, 1800)


def s10(t):         # הגדרות: the quiet hours, a circle on Friday
    rel = 'office/s10_settings_quiet_hours.png'
    q, f = box_of(rel, 'quiet_hours'), box_of(rel, 'friday_line')
    frame, b = office_full().mix(fit(OFFICE, q, 1.35, min_h=900), seg(t, 0.0, 0.9)).render(img(rel))
    return circle(frame, rect_out(b, f), seg(t, 0.95, 1.55), pad=14)


def s11(t):         # David's folder: IMG_4471.jpg becomes its clear name
    a, c = img('office/s11_drawer_files_before_rename.png'), img('office/s11_drawer_files.png')
    world = Image.blend(a, c, seg(t, 1.0, 1.35))
    name = box_of('office/s11_drawer_files.png', 'bank_file_name')
    target = Cam(name[0] + name[2] / 2 - 80, name[1] - 220, 760)
    frame, b = office_full().mix(target, seg(t, 0.0, 1.0)).render(world)
    return outline(frame, rect_out(b, name), seg(t, 1.45, 1.8))


def s12(t):         # the bank statement in the preview: blurry
    rel = 'office/s12_preview_blurry_large.png'
    d = box_of(rel, 'document')
    return office_full().mix(fit(OFFICE, d, 1.08), seg(t, 0.0, 2.0)).render(img(rel))[0]


def s13(t):         # "לא קריא…", one click, the dialog
    rel = 'office/s13_unreadable_button.png'
    bt = box_of(rel, 'button')
    if t < 1.0:
        cam = fit(OFFICE, bt, 4.0, min_h=1000).mix(fit(OFFICE, bt, 3.0, min_h=760), t / 1.0)
        frame, b = cam.render(img(rel))
        return tap(frame, to_out(b, (bt[0] + bt[2] / 2, bt[1] + bt[3] / 2)), (t - 0.45) / 0.5)
    rel2 = 'office/s13_unreadable_dialog.png'
    dl = box_of(rel2, 'dialog')
    return fit(OFFICE, dl, 1.15).mix(fit(OFFICE, dl, 1.05), (t - 1.0) / 0.5).render(img(rel2))[0]


def s14(t):         # David photographs again; the office: "הושלם"
    if t < 0.6:
        world = phone_world_cached('phone/s14_again_notification.png', 1920, 1080, 1900, WARM)
        bn = P.screen_rect(box_of('phone/s14_again_notification.png', 'banner'))
        return Cam(1920, 1080, 2000).mix(fit(WORLD, (bn[0], bn[1], bn[2], bn[3] * 2.4), 1.3, min_h=1000), t / 0.6).render(world)[0]
    if t < 1.2:
        world = phone_world_cached('phone/s14_client_page_again.png', 1920, 1080, 1900, WARM)
        row = P.screen_rect(box_of('phone/s14_client_page_again.png', 'bank_row'))
        return Cam(1920, 1080, 1900).mix(fit(WORLD, (row[0], row[1], row[2], row[3] * 0.55), 1.3, min_h=900), (t - 0.6) / 0.6).render(world)[0]
    if t < 1.55:
        return Cam(1920, 1080, 2100).render(phone_world(camera_seq(t - 1.2, 'bank_again', 0.0, 0.12, 0.35)))[0]
    if t < 1.95:
        return Cam(1920, 1080, 2100).render(phone_world_cached('phone/s14_done_again.png', 1920, 1080, 1900, WARM))[0]
    rel = 'office/s14_board_done_glow.png'
    r = box_of(rel, 'david_row')
    return fit(OFFICE, r, 1.25, min_h=1100).mix(fit(OFFICE, r, 1.1, min_h=820), (t - 1.95) / 1.05).render(img(rel))[0]


P_OWNER = Phone()


def s15(t):         # the question again, and the summary lands: the answer
    if t < 0.7:
        q = box_of('before/s1_owner_question_typing.png', 'question')
        return fit(WORLD, q, 1.2, min_h=1050).render(img('before/s3_owner_question_no_answer.png'))[0]
    if t < 1.7:
        world = phone_world(clip_at('owner/s15_summary_arrives.mp4', (t - 0.7) * 2.0))
        return Cam(1920, 1080, 2160).mix(Cam(1920, 900, 1700), (t - 0.7)).render(world)[0]
    base = img('owner/s15_summary_open.png')
    if t < 2.6:
        r1 = box_of('owner/s15_summary_marked1.png', 'marked')
        world = phone_world(wipe(base, img('owner/s15_summary_marked1.png'), r1, seg(t, 1.85, 2.35)))
        return Cam(1920, 900, 1700).mix(fit(WORLD, P.screen_rect(r1), 1.3, min_h=720), seg(t, 1.7, 2.2)).render(world)[0]
    r1 = box_of('owner/s15_summary_marked1.png', 'marked')
    r2 = box_of('owner/s15_summary_marked2.png', 'marked')
    m1 = img('owner/s15_summary_marked1.png')
    final = img('owner/s15_summary_marked2.png').copy()
    cut = (r1[1] + r1[3] + r2[1]) // 2                       # between the two marked passages
    final.paste(m1.crop((0, 0, m1.width, cut)), (0, 0))      # both passages marked
    both = wipe(m1, final, r2, seg(t, 2.6, 3.2))
    world = phone_world(both)
    allr = P.screen_rect((r1[0], r1[1], max(r1[2], r2[2]), r2[1] + r2[3] - r1[1]))
    return fit(WORLD, P.screen_rect(r1), 1.3, min_h=720).mix(fit(WORLD, allr, 1.2, min_h=720), seg(t, 2.6, 3.2)).render(world)[0]


def card(name, fade_out=0.0, fade_in=0.18, z0=1.045):
    return lambda t, dur: card_frame(name, t, dur, fade_in=fade_in, fade_out=fade_out, z0=z0)


# (name, seconds, frame function). Cards take (t, dur); scenes take t.
TIMELINE = [
    ('s01', 2.5, s1), ('c01', 1.5, card('01_text.png')), ('s02', 4.0, s2), ('c02', 1.5, card('02_text.png')),
    ('s03', 2.0, s3), ('c03', 1.5, card('03_text.png')), ('c04', 2.0, card('04_text.png', fade_in=0.4)),
    ('s04', 3.0, s4), ('c05', 2.0, card('05_text.png')), ('s05', 2.5, s5), ('c06', 1.5, card('06_text.png')),
    ('s06', 2.0, s6), ('c07', 1.0, card('07_text.png', fade_in=0.1)), ('s07', 1.5, s7), ('c08', 1.0, card('08_text.png', fade_in=0.1)),
    ('s08', 3.0, s8), ('c09', 1.5, card('09_text.png')),
    ('s09', 3.0, s9), ('c10', 1.5, card('10_text.png')), ('s10', 2.0, s10), ('c11', 1.5, card('11_text.png')),
    ('s11', 2.5, s11), ('c12', 1.5, card('12_text.png')),
    ('s12', 2.0, s12), ('c13', 1.0, card('13_text.png', fade_in=0.05, z0=1.0)), ('s13', 1.5, s13), ('c14', 1.0, card('14_text.png', fade_in=0.08)),
    ('s14', 3.0, s14), ('c15', 1.5, card('15_text.png')),
    ('s15', 3.5, s15), ('c16', 1.5, card('16_text.png', z0=1.08)), ('c17', 1.5, card('17_text.png')), ('c18', 1.5, card('18_text.png')),
    ('c19', 2.0, card('19_nelio_text.png', fade_in=0.6, z0=1.07)), ('c20', 3.5, card('20_text.png', fade_in=0.3)),
    ('c21', 3.0, card('21_text.png', fade_in=0.3, fade_out=0.9)),
]


def frame_at(fn, t, dur):
    return fn(t, dur) if fn.__name__ == '<lambda>' else fn(t)


def starts():
    s, out = 0.0, {}
    for name, dur, _ in TIMELINE:
        out[name] = s
        s += dur
    return out, s


# ---------------------------------------------------------------- sound (effects only; the music is not here yet)

SR = 48000


def sound(total, start):
    sfx = {p.stem: wavfile.read(p)[1].astype(np.float64) / 2 ** 31 for p in (A / 'sfx').glob('*.wav')}
    mix = np.zeros((int((total + 1) * SR), 2))

    def put(name, at, gain=1.0, length=None):
        x = sfx[name]
        if length:
            x = x[:int(length * SR)].copy()
            f = int(0.02 * SR)
            x[-f:] *= np.linspace(1, 0, f)[:, None]
        i = int(at * SR)
        n = min(len(x), len(mix) - i)
        mix[i:i + n] += x[:n] * gain

    c = start
    put('pulse', 0.0, 0.45)
    put('notification', 0.15, 0.5)
    put('boom', c['c01'], 0.9)
    put('ticking_accelerating', c['s02'], 0.55, length=4.0)
    for k, at in enumerate((0.25, 1.15, 2.1, 3.3)):
        put('notification', c['s02'] + at, 0.22 + 0.05 * k)
    put('boom', c['c02'], 0.95)
    put('pulse', c['s03'], 0.35, length=3.5)
    put('riser', c['c04'] - 0.15, 0.7)
    put('whoosh', c['s04'] - 0.1, 0.5)
    put('mail', c['s04'] + 0.35, 0.6)
    put('whoosh', c['c05'], 0.6)
    put('boom', c['c06'], 0.4)
    put('tick', c['s06'] + 0.18, 0.7)
    put('whoosh', c['c07'], 0.45)
    put('shutter', c['s07'] + 0.47, 0.8)
    put('whoosh', c['c08'], 0.45)
    put('shutter', c['s08'] + 0.32, 0.75)
    put('shutter', c['s08'] + 1.58, 0.75)
    put('stamp', c['s08'] + 1.95, 0.9)
    put('boom', c['c09'], 0.95)
    put('whoosh', c['c10'], 0.5)
    put('boom', c['c11'], 0.45)
    put('whoosh', c['c12'], 0.5)
    put('tick', c['s13'] + 0.47, 0.8)
    put('boom', c['c14'], 0.8)
    put('mail', c['s14'] + 0.05, 0.5)
    put('shutter', c['s14'] + 1.32, 0.75)
    put('boom', c['c15'], 0.45)
    put('mail', c['s15'] + 0.85, 0.6)
    put('braam', c['c16'], 1.0)
    put('boom', c['c17'], 0.85)
    put('boom', c['c18'], 0.9)
    put('whoosh', c['c19'], 0.35)
    put('boom', c['c19'] + 0.1, 0.5)
    put('boom', c['c21'], 0.35)
    mix = mix[:int(total * SR)]
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)           # a soft limiter
    mix *= 10 ** (-1 / 20) / max(1e-9, np.max(np.abs(mix)))
    return (mix * (2 ** 31 - 1)).astype(np.int32)


# ---------------------------------------------------------------- encoding

ENC = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-g', '60']


def encode_scene(name, dur, fn, path):
    n = round(dur * FPS)
    tmp = path.with_name(path.stem + '.part.mp4')
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS),
                          '-i', '-', *ENC, str(tmp)], stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(frame_at(fn, i / FPS, dur).convert('RGB').tobytes())
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit(f'ffmpeg failed on {name}')
    tmp.rename(path)


def main():
    start, total = starts()
    print(f'{len(TIMELINE)} parts, {total:.1f} s')
    if CHECK:
        OUT.mkdir(parents=True, exist_ok=True)
        for t in CHECK:
            for name, dur, fn in TIMELINE:
                if start[name] <= t < start[name] + dur:
                    frame_at(fn, t - start[name], dur).save(OUT / f'check_{t:05.2f}_{name}.png')
                    print('  check', t, name)
        return
    work = OUT.parent / (OUT.stem + '_parts')
    work.mkdir(parents=True, exist_ok=True)
    for name, dur, fn in TIMELINE:
        path = work / f'{name}.mp4'
        if not path.exists():
            encode_scene(name, dur, fn, path)
        print('  ', name, dur)
    (work / 'list.txt').write_text(''.join(f"file '{work / n}.mp4'\n" for n, _, _ in TIMELINE))
    silent = work / 'video.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(work / 'list.txt'), '-c', 'copy', str(silent)], check=True)
    wavfile.write(work / 'sound.wav', SR, sound(total, start))
    tmp = OUT.with_name(OUT.stem + '.part.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-i', str(work / 'sound.wav'), '-map', '0:v', '-map', '1:a',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', str(tmp)], check=True)
    tmp.rename(OUT)
    print('done ->', OUT)


if __name__ == '__main__':
    main()
