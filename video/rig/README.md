# video/rig: צילום המסכים לסרטון

כלים מקומיים שמריצים את הסיפור של הסרטון על הקוד האמיתי של Nelio ומצלמים כל מסך. לא נפרסים לשום מקום ולא נוגעים במערכת החיה. התוצאה נשמרת בענף `video-assets`, והמפה שלה ב־`video/ASSETS.md`.

```
bash video/rig/run.sh /path/to/output      # הכול מאפס, כ־10 דקות
```

| קובץ | מה הוא עושה |
|---|---|
| `load.py` | בונה מסד מקומי: כל המיגרציות, ברירות המחדל של Apps Script (`ref.mjs`) ו־`demo/seed.json`. לדוד (C04) יש קישור מקומי ידוע. |
| `server.mjs` | מריץ את שני השרתים (`supabase/functions/*/index.ts`) בלי שינוי, על המסד המקומי, עם תחליף קטן ל־Auth, ל־REST ול־Storage של Supabase. |
| `browser.py` | כרום שרואה את הדפים בכתובות האמיתיות: `docs/` מקומי, השרת המקומי, הגופנים מ־`demo/fonts`. |
| `story.py` | הסיפור: איפוס, 11/11, ההעלאות, "לא קריא", הצילום החוזר, האישור, 13/11. שומר תמונות, קליפים קצרים ו־`shots.json`. |
| `pages.py`, `render_email.mjs` | אפליקציית דואר ומצלמה כלליות בטלפון; המיילים עצמם נצבעים ב־`renderEmail` של השרת. |
| `make_docs.py`, `pile.py` | המסמכים של דוד לאוקטובר וערימת הניירות, מ־`demo/render_docs.py`. |
| `cards.py`, `sfx.py` | הכרטיסים השחורים, השם Nelio, מסגרת הטלפון, ואפקטי הסאונד (נוצרים בקוד). |

צריך: שרת PostgreSQL 16, Node 22, Python 3 עם playwright, psycopg, pillow, numpy ו־scipy, כרום ב־`/usr/bin/google-chrome`, ו־ffmpeg.
