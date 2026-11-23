"""Trailer sound effects for the Nelio video, synthesized from scratch (numpy + scipy), so they are
ours and free of any license. 48 kHz, 24-bit WAV, stereo, peaks at -1 dBFS.

    python3 sfx.py OUT_FOLDER

boom: the low hit under each black card. braam: the big hit (the last cards). whoosh: a short
air sweep for fast cards. riser: two seconds of rising tension before "עד עכשיו". tick and
ticking_accelerating: the clock of Act 1. notification and mail: the phone. shutter: the camera.
stamp: the "received" stamp. pulse: a low heartbeat bed for Act 1. Deterministic (fixed seeds)."""
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'sfx')
OUT.mkdir(parents=True, exist_ok=True)


def t(sec):
    return np.arange(int(sec * SR)) / SR


def lp(x, f, order=4):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def env(n, attack, decay_tau):
    a = int(attack * SR)
    e = np.exp(-np.arange(n) / (decay_tau * SR))
    if a:
        e[:a] *= np.linspace(0, 1, a)
    return e


def reverb(x, seconds=2.2, mix=0.35, seed=1):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    ir = rng.standard_normal((2, n)) * np.exp(-np.arange(n) / (seconds / 6.9 * SR))
    ir = np.stack([lp(ir[0], 6000), lp(ir[1], 6000)])
    wet = np.stack([fftconvolve(x, ir[0])[:len(x) + n], fftconvolve(x, ir[1])[:len(x) + n]])
    dry = np.zeros_like(wet)
    dry[:, :len(x)] = x
    wet /= np.max(np.abs(wet)) + 1e-9
    return dry * (1 - mix) + wet * mix * np.max(np.abs(x))


def save(name, x, tail_db=-60):
    x = np.atleast_2d(x)
    if x.shape[0] == 1:
        x = np.vstack([x, x])
    # trim the silent tail, fade the last 30 ms
    thr = 10 ** (tail_db / 20) * np.max(np.abs(x))
    last = np.max(np.nonzero(np.max(np.abs(x), axis=0) > thr)) + int(0.05 * SR)
    x = x[:, :last]
    f = int(0.03 * SR)
    x[:, -f:] *= np.linspace(1, 0, f)
    x = x / np.max(np.abs(x)) * 10 ** (-1 / 20)
    pcm = (x.T * (2 ** 31 - 1)).astype(np.int32)
    wavfile.write(OUT / f'{name}.wav', SR, pcm)
    print(f'{name}.wav  {x.shape[1] / SR:.2f} s')


rng = np.random.default_rng(7)

# boom: a sub drop (70 → 38 Hz) with a soft noise thump, in a big room
tt = t(3.0)
freq = 38 + 32 * np.exp(-tt / 0.18)
sub = np.sin(2 * np.pi * np.cumsum(freq) / SR) * env(len(tt), 0.004, 0.9)
thump = lp(rng.standard_normal(len(tt)), 900) * env(len(tt), 0.001, 0.05) * 0.8
save('boom', reverb(sub + thump, 2.5, 0.3))

# braam: detuned low saws (A1 + E2 + A2) through a closing filter, the "big hit"
tt = t(3.6)
x = np.zeros(len(tt))
for f0 in (55, 55.4, 82.4, 82.9, 110, 109.6):
    ph = (f0 * tt) % 1.0
    x += 2 * ph - 1
cut = 400 + 2600 * np.exp(-tt / 0.35)
y = np.zeros_like(x)
for i in range(0, len(x), 2400):           # a filter that closes over time, in short blocks
    seg = x[max(0, i - 4800):i + 2400]
    y[i:i + 2400] = lp(seg, float(cut[i]), 2)[-len(x[i:i + 2400]):]
low = np.sin(2 * np.pi * np.cumsum(41 + 30 * np.exp(-tt / 0.2)) / SR) * env(len(tt), 0.004, 1.1)
y = y / np.max(np.abs(y)) * env(len(tt), 0.02, 1.2) + low * 0.9
save('braam', reverb(y, 3.0, 0.35, seed=2))

# whoosh: band noise sweeping up and away, 0.9 s
tt = t(0.9)
n = rng.standard_normal(len(tt))
y = np.zeros_like(n)
centers = 300 + 3500 * (tt / tt[-1]) ** 1.6
for i in range(0, len(n), 960):
    c = float(centers[i])
    seg = n[max(0, i - 1920):i + 960]
    y[i:i + 960] = bp(seg, c * 0.6, min(c * 1.6, 20000))[-len(n[i:i + 960]):]
shape = np.sin(np.pi * np.clip(tt / tt[-1], 0, 1)) ** 2
left, right = y * shape * np.linspace(1, 0.4, len(tt)), y * shape * np.linspace(0.4, 1, len(tt))
save('whoosh', np.stack([left, right]))

# riser: 2.2 s of rising noise and pitch, cut dead at the end (the card lands on silence)
tt = t(2.2)
n = rng.standard_normal(len(tt))
y = np.zeros_like(n)
for i in range(0, len(n), 960):
    c = 200 + 5000 * (tt[i] / tt[-1]) ** 2
    seg = n[max(0, i - 1920):i + 960]
    y[i:i + 960] = bp(seg, c * 0.7, min(c * 1.4, 20000))[-len(n[i:i + 960]):]
tone = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (3 * tt / tt[-1])) / SR) * 0.35
x = (y * 0.8 + tone) * (tt / tt[-1]) ** 2.2
x[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))
save('riser', x, tail_db=-90)

# tick: one clock tick; ticking_accelerating: 4 s from slow to fast (Act 1 montage)
def tick_sound(pitch=3200, seed=3):
    r = np.random.default_rng(seed)
    tt = t(0.06)
    click = bp(r.standard_normal(len(tt)), pitch * 0.7, pitch * 1.4) * env(len(tt), 0.0005, 0.006)
    body = np.sin(2 * np.pi * 1100 * tt) * env(len(tt), 0.0005, 0.01) * 0.4
    return click + body
save('tick', tick_sound(), tail_db=-70)
total = t(4.2)
x = np.zeros(len(total))
pos, gap, k = 0.0, 0.5, 0
while pos < 4.0:
    s = tick_sound(3200 if k % 2 == 0 else 2700, seed=10 + k)
    i = int(pos * SR)
    x[i:i + len(s)] += s[:len(x) - i]
    pos += gap
    gap = max(0.09, gap * 0.86)
    k += 1
save('ticking_accelerating', x, tail_db=-70)

# notification: two soft bell tones; mail: one rounder tone, for a mail landing
def bell(f, dur=0.8, a=1.0):
    tt = t(dur)
    return (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2.01 * f * tt) + 0.12 * np.sin(2 * np.pi * 3.02 * f * tt)) * env(len(tt), 0.003, 0.18) * a
x = np.zeros(int(1.1 * SR))
b1, b2 = bell(1046.5), bell(1568.0)
x[:len(b1)] += b1
x[int(0.12 * SR):int(0.12 * SR) + len(b2)] += b2 * 0.9
save('notification', reverb(x, 0.8, 0.15, seed=4), tail_db=-55)
save('mail', reverb(bell(784.0, 0.9) + bell(1174.7, 0.9, 0.5), 0.8, 0.15, seed=5), tail_db=-55)

# shutter: two mechanical clicks 70 ms apart
x = np.zeros(int(0.35 * SR))
for i, (d, p) in enumerate(((0.0, 1.0), (0.07, 0.8))):
    tt = t(0.05)
    s = hp(rng.standard_normal(len(tt)), 1500) * env(len(tt), 0.0003, 0.008) * p
    s += lp(rng.standard_normal(len(tt)), 600) * env(len(tt), 0.0003, 0.015) * 0.6 * p
    j = int(d * SR)
    x[j:j + len(s)] += s
save('shutter', reverb(x, 0.3, 0.1, seed=6), tail_db=-60)

# stamp: a rubber stamp on paper on a desk
tt = t(0.6)
thud = np.sin(2 * np.pi * np.cumsum(90 + 80 * np.exp(-tt / 0.02)) / SR) * env(len(tt), 0.001, 0.07)
slap = bp(rng.standard_normal(len(tt)), 300, 3000) * env(len(tt), 0.0005, 0.02) * 0.7
save('stamp', reverb(thud + slap, 0.5, 0.12, seed=8), tail_db=-60)

# pulse: a low heartbeat at 72 per minute, 6 s, for the tension under Act 1
total = t(6.0)
x = np.zeros(len(total))
for beat in np.arange(0, 6.0, 60 / 72):
    for off, amp in ((0.0, 1.0), (0.22, 0.6)):
        tt = t(0.35)
        s = np.sin(2 * np.pi * np.cumsum(55 + 25 * np.exp(-tt / 0.03)) / SR) * env(len(tt), 0.002, 0.09) * amp
        i = int((beat + off) * SR)
        if i < len(x):
            x[i:i + len(s)] += s[:len(x) - i]
save('pulse', lp(x, 300), tail_db=-70)
