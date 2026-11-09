"""Builds the Nelio brand SVG files (docs/brand/): text converted to outlines, so no font is needed at runtime.

Usage:  python3 -I tools/make_brand.py <fonts-dir> docs/brand
<fonts-dir> holds Bellefair.ttf (google/fonts, ofl/bellefair/Bellefair-Regular.ttf) and the variable
Assistant.ttf (ofl/assistant/Assistant[wght].ttf). Needs: pip install fonttools uharfbuzz.
The PNG and ICO files are made from the SVG with rsvg-convert and ImageMagick (see docs/brand/README.md).
The two files that start with _ are temporary and are deleted by hand after the PNG and ICO are made."""
import sys, os
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.varLib import instancer

FONTS, OUT = sys.argv[1], sys.argv[2]
SEA, INK2, PAPER = '#1B4558', '#5E584D', '#F6F1E7'

bel_path = os.path.join(FONTS, 'Bellefair.ttf')
ass = instancer.instantiateVariableFont(TTFont(os.path.join(FONTS, 'Assistant.ttf')), {'wght': 400})
ass_path = os.path.join(OUT, '_assistant400.ttf')  # temp, removed below
ass.save(ass_path)

def shape(path, text, size, tracking=0):
    """Returns (path_d_list, width, ttfont) with glyphs placed right-to-left, y down."""
    blob = hb.Blob.from_file_path(path); face = hb.Face(blob); font = hb.Font(face)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    buf.direction = 'rtl'; buf.script = 'Hebr'; buf.language = 'he'
    hb.shape(font, buf, {'kern': True, 'liga': False})
    tt = TTFont(path); gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    scale = size / tt['head'].unitsPerEm
    # RTL buffer: glyphs come in visual left-to-right order after shaping for rtl? harfbuzz returns visual order.
    x = 0.0; items = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        items.append((order[info.codepoint], x + pos.x_offset * scale, -pos.y_offset * scale))
        x += pos.x_advance * scale + tracking
    width = x - tracking
    return items, width, gs, scale

def outline(items, gs, scale, ox, oy):
    ds = []
    for name, gx, gy in items:
        pen = SVGPathPen(gs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
        tp = TransformPen(pen, (scale, 0, 0, -scale, ox + gx, oy + gy))
        gs[name].draw(tp)
        d = pen.getCommands()
        if d: ds.append(d)
    return ' '.join(ds)

def write(name, body, w, h, extra=''):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" height="%s"%s>\n%s\n</svg>\n' % (w, h, w, h, extra, body))

# ---- main logo: "שדמי" over a letter-spaced subline, centered ----
main_items, main_w, bgs, bsc = shape(bel_path, 'שדמי', 120, tracking=2)
sub_items, sub_w, ags, asc = shape(ass_path, "ושות', רואי חשבון", 15, tracking=3.2)
W = max(main_w, sub_w) + 20; pad = 10
main_d = outline(main_items, bgs, bsc, (W - main_w) / 2, 100)
sub_d = outline(sub_items, ags, asc, (W - sub_w) / 2, 134)
# trim the empty space above the letters: baseline of the wordmark is y=100
from fontTools.pens.boundsPen import BoundsPen
top = 1e9
for name, gx, gy in main_items:
    bp = BoundsPen(bgs); bgs[name].draw(bp)
    top = min(top, 100 - bp.bounds[3] * bsc)
shift = top - 8
main_d = outline(main_items, bgs, bsc, (W - main_w) / 2, 100 - shift)
sub_d = outline(sub_items, ags, asc, (W - sub_w) / 2, 134 - shift)
H = 134 - shift + 8
write('logo.svg',
      '<title>שדמי ושות\', רואי חשבון</title>\n<path fill="%s" d="%s"/>\n<path fill="%s" d="%s"/>' % (SEA, main_d, INK2, sub_d),
      '%.0f' % W, '%.0f' % H, ' role="img" aria-label="שדמי ושות\', רואי חשבון"')

# ---- mark: shin in a thin circle ----
sh_items, sh_w, _, _ = shape(bel_path, 'ש', 100)
def shin(size, cx, cy):
    items, w, gs, sc = shape(bel_path, 'ש', size)
    # vertically center the glyph by its real outline bounds
    from fontTools.pens.boundsPen import BoundsPen
    bp = BoundsPen(gs); gs[items[0][0]].draw(bp); x0, y0, x1, y1 = bp.bounds
    gw, gh = (x1 - x0) * sc, (y1 - y0) * sc
    ox = cx - gw / 2 - x0 * sc
    oy = cy + gh / 2 + y0 * sc   # baseline so that the bounds are centered on cy
    return outline(items, gs, sc, ox, oy)

S = 200
write('mark-circle.svg',
      '<title>שדמי</title>\n<circle cx="100" cy="100" r="96" fill="none" stroke="%s" stroke-width="3"/>\n<path fill="%s" d="%s"/>' % (SEA, SEA, shin(150, 100, 100)),
      S, S, ' role="img" aria-label="שדמי"')
# same on paper background (for the PNG: email clients ignore transparency over dark mode poorly)
write('_mark-circle-paper.svg',
      '<rect width="200" height="200" fill="#FFFFFF"/>\n<circle cx="100" cy="100" r="96" fill="none" stroke="%s" stroke-width="3"/>\n<path fill="%s" d="%s"/>' % (SEA, SEA, shin(150, 100, 100)), S, S)

# ---- favicon: light shin on a deep-sea square ----
write('favicon.svg',
      '<rect width="64" height="64" fill="%s"/>\n<path fill="%s" d="%s"/>' % (SEA, PAPER, shin(44, 32, 32)),
      64, 64)
write('_favicon-big.svg',
      '<rect width="64" height="64" fill="%s"/>\n<path fill="%s" d="%s"/>' % (SEA, PAPER, shin(50, 32, 32)), 64, 64)
os.remove(ass_path)
print('ok', round(W), H)
