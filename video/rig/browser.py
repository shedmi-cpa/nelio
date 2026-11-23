"""Nelio video rig: a Chrome that sees the real pages at their real addresses.

Every request for the public site (shedmi-cpa.github.io/nelio) is answered from docs/ in the
repository, every request for the Supabase host goes to the local server (server.mjs), and the
fonts come from demo/fonts. Nothing reaches the internet, and the pages run unchanged."""
import mimetypes
import re
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
REPO = Path(__import__('os').environ.get('NELIO_REPO', HERE.parents[1]))
SITE = 'https://shedmi-cpa.github.io/nelio/'
VIDEO = 'https://shedmi-cpa.github.io/nelio-video/'
SUPA = 'https://ryqcyjajdioaxtpbxjzf.supabase.co'
RIG = 'http://localhost:8787'
FONTS = REPO / 'demo/fonts/node_modules/@fontsource'
DAVID_LINK = SITE + '#t=local-video-token-david-c04-0000000000'
OFFICE = SITE + 'office/'

# The office signs in with Google through supabase-js. Here the library is a stand-in that
# reports a signed-in office session; the server checks it against the same rules as always.
AUTH_STUB = """
window.supabase={createClient(){return {auth:{
 getSession:async()=>({data:{session:{access_token:'local.video.session',user:{id:'00000000-0000-4000-8000-000000000001',email:'shedmi.cpa@gmail.com'}}},error:null}),
 onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
 signOut:async()=>({error:null}),signInWithOAuth:async()=>({error:null})}};}};
"""


def font_css():
    parts = []
    for family, weights in (('assistant', ('400', '600', '700')), ('frank-ruhl-libre', ('400', '700')), ('heebo', ('400', '700', '800', '900'))):
        for w in weights:
            css = (FONTS / family / f'{w}.css').read_text()
            parts.append(css.replace('url(./files/', f'url(https://fonts.gstatic.com/local/{family}/files/'))
    return '\n'.join(parts)


FONT_CSS = font_css()


def _route(route):
    url = route.request.url
    u = urlparse(url)
    if url.startswith(SITE):
        rel = u.path[len('/nelio/'):] or 'index.html'
        if rel.endswith('/'):
            rel += 'index.html'
        f = REPO / 'docs' / rel
        if f.is_file():
            return route.fulfill(path=str(f), content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
        return route.fulfill(status=404, body='not found')
    if url.startswith(VIDEO):
        f = HERE / 'pages' / u.path[len('/nelio-video/'):]
        if not f.is_file():
            f = REPO / 'video' / u.path[len('/nelio-video/'):]
        if f.is_file():
            return route.fulfill(path=str(f), content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
        return route.fulfill(status=404, body='not found')
    if url.startswith(SUPA):
        r = route.fetch(url=RIG + url[len(SUPA):])
        return route.fulfill(response=r)
    if u.netloc == 'fonts.googleapis.com':
        return route.fulfill(body=FONT_CSS, content_type='text/css', headers={'Access-Control-Allow-Origin': '*'})
    if u.netloc == 'fonts.gstatic.com' and u.path.startswith('/local/'):
        f = FONTS / u.path[len('/local/'):]
        return route.fulfill(path=str(f), content_type='font/woff2', headers={'Access-Control-Allow-Origin': '*'})
    if u.netloc == 'cdn.jsdelivr.net' and 'supabase-js' in u.path:
        return route.fulfill(body=AUTH_STUB, content_type='application/javascript')
    print('blocked:', url)
    return route.abort()


class Rig:
    """with Rig() as rig: page = rig.phone(); page.goto(DAVID_LINK)"""

    def __enter__(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--font-render-hinting=none', '--disable-lcd-text'])
        return self

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()

    def context(self, **kw):
        ctx = self.browser.new_context(locale='he-IL', timezone_id='Asia/Jerusalem', **kw)
        ctx.route(re.compile('.*'), _route)
        return ctx

    def phone(self, **kw):
        # A common Android size (412 × 924 CSS pixels, the screen of frames/phone_frame.png) drawn at 3×: 1236 × 2772 pixels.
        ctx = self.context(viewport={'width': 412, 'height': 924}, device_scale_factor=3, is_mobile=True, has_touch=True, **kw)
        return ctx.new_page()

    def desktop(self, width=1600, height=900, scale=2, **kw):
        ctx = self.context(viewport={'width': width, 'height': height}, device_scale_factor=scale, **kw)
        return ctx.new_page()
