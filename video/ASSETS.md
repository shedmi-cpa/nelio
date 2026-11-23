# Nelio: חומרי הגלם לסרטון (טיוטה 3, טריילר)

**איפה הקבצים:** בענף `video-assets` במאגר (כמו `demo-assets`, הקבצים הגדולים לא נכנסים ל־`main`):
https://github.com/shedmi-cpa/nelio/tree/video-assets . הקובץ הזה נמצא גם שם, בשם `README.md`.
להורדה של הכול כ־ZIP: https://github.com/shedmi-cpa/nelio/archive/refs/heads/video-assets.zip

**איך הם נוצרו:** הכלים ב־`video/rig/` מריצים את הסיפור של הסרטון **על הקוד האמיתי** (שני השרתים בלי שינוי, כל המיגרציות, `demo/seed.json`), על עותק מקומי של המסד, בכרום. איפוס ל־9/11 19:30, קפיצה ל־11/11 09:00 ("מחר היום האחרון" יוצא ל־12), דוד מעלה שלוש תמונות, המשרד מסמן "לא קריא", דוד מצלם שוב, המשרד מאשר, וב־13/11 בעל המשרד מקבל את הסיכום. כל מסך הוא המסך האמיתי של Nelio עם הנתונים האמיתיים של הדמו. הרצה חוזרת: `bash video/rig/run.sh <תיקייה>` (כ־10 דקות, בלי אינטרנט מלבד GitHub ו־npm). שום דבר לא נוגע במערכת החיה.

**גדלים:** טלפון 1236 × 2772 (בדיוק המסך של `frames/phone_frame.png`), משרד 3200 × 1800, מסכי "לפני" 3840 × 2160, כרטיסים 3840 × 2160. ב־`shots.json` יש לכל תמונה את הגודל ואת **התיבות** (x, y, רוחב, גובה בפיקסלים של התמונה) של מה שעושים עליו זום או סימון: השורה של דוד, הכפתור, השורה המסומנת וכו'.

## הסרטון המוכן

`final/nelio-trailer-v1.mp4`: גרסה 1, 72.5 שניות, עם אפקטי סאונד ובלי מוזיקה. נערך ב־`video/edit/render.py` מהקבצים כאן: `python3 video/edit/render.py <התיקייה הזו> out.mp4`.

## מה בכל תיקייה

| תיקייה | מה יש בה |
|---|---|
| `before/` | מסכי "לפני" (`video/before.html`): השאלה של בעל המשרד עם נקודות הקלדה ובלעדיהן, צ'אט הלקוחות (וגם קליפ של הגלילה), תיקיית ההורדות, האקסל האדום. כל אחד גם כ"רק הטלפון/החלון". |
| `phone/` | הטלפון של דוד: תיבת הדואר (קליפ של המייל נוחת, באנר, תיבה), המייל פתוח ומסומן בטוש, דף הלקוח בכל שלב, המצלמה (מבט, לחיצה, הבזק, יד רועדת). |
| `office/` | הלוח: לפני ואחרי ההעלאה באותו פריים, השורה של דוד זוהרת, שעות השקט, התיק של דוד (עם `IMG_4471.jpg` ועם השם המסודר), דף הבנק המטושטש, "לא קריא…", הדיאלוג, "בדקתי, תקין", "הושלם". |
| `owner/` | התיבה של בעל המשרד: "סיכום אוקטובר 2026" נוחת, פתוח, ושתי השורות מסומנות (כל אחת לחוד). |
| `cards/` | 21 הכרטיסים על שחור, וכל אחד גם כטקסט על רקע שקוף (`_text`). 19 הוא השם Nelio. |
| `frames/` | מסגרת טלפון כללית (בלי מותג), שקופה ועם מסך ירוק, ו־`phone_frame.json` עם מיקום המסך. |
| `stock/` | `paper_pile.jpg`: ערימת ניירות על שולחן, מלמעלה, מהמסמכים של הדמו. |
| `docs/` | המסמכים של דוד לאוקטובר: הדף הנקי, התמונה מהטלפון, התמונה המטושטשת והצילום החוזר. |
| `sfx/` | אפקטי סאונד שנוצרו בקוד (שלנו, בלי רישיון): `boom`, `braam`, `whoosh`, `riser`, `tick`, `ticking_accelerating`, `notification`, `mail`, `shutter`, `stamp`, `pulse`. |

## סצנה אחרי סצנה (לפי `project/video-script.md`, טיוטה 3)

| שניות | | מה לשים | סאונד |
|---|---|---|---|
| 0–2.5 | ס1 | `before/s1_owner_question_typing.mp4` (או `_phone.png`) | `sfx/notification` |
| 2.5–4 | ש | `cards/01.png` | `sfx/boom` |
| 4–8 | ס2 | `before/s2_clients_chat_scroll.mp4` (להאיץ), `stock/paper_pile.jpg` (פוש־אין), `before/s2_downloads_folder_window.png` (תיבה `img_4471`), `before/s2_tracking_sheet_window.png` (תיבה `david_row`) | `sfx/ticking_accelerating` + `notification` |
| 8–9.5 | ש | `cards/02.png` | `boom` |
| 9.5–11.5 | ס3 | חיתוך מ־`s1_owner_question_typing` אל `before/s3_owner_question_no_answer_phone.png`: הנקודות נעלמות | שקט |
| 11.5–15 | ש | `cards/03.png`, `cards/04.png` | `riser` לפני 04, נחתך לשקט |
| 15–18 | ס4 | `phone/s4_last_day_arrives.mp4`, `s4_last_day_notification.png` | `sfx/mail` |
| 18–20 | ש | `cards/05.png` | `whoosh` |
| 20–22.5 | ס5 | `phone/s4_last_day_open.png` → `s4_last_day_marked.png` (תיבה `marked`) | |
| 22.5–24 | ש | `cards/06.png` | |
| 24–26 | ס6 | `phone/s6_client_page_open.png` (תיבות `camera_button`, `subtitle`) + שעון עצר בעריכה | `tick` |
| 26–27 | ש | `cards/07.png` | |
| 27–28.5 | ס7 | `phone/camera_invoices_look.png` → `_press.png` → `camera_invoices_flash.mp4` → `s7_after_first.png` | `shutter` |
| 28.5–29.5 | ש | `cards/08.png` | |
| 29.5–32.5 | ס8 | `camera_receipts_*`, `s8_after_second.png`, `camera_bank_shaky.mp4`, `camera_bank_flash.mp4`, `s8_done_stamp.mp4` | `shutter`, `stamp` |
| 32.5–34 | ש | `cards/09.png` | `boom` |
| 34–37 | ס9 | מסך מפוצל: `phone/s8_done_stamp.png` + `office/s9_board_waiting_as_before.png` → `s9_board_waiting.png` → `_glow.png` (אותו פריים) | |
| 37–38.5 | ש | `cards/10.png` | |
| 38.5–40.5 | ס10 | `office/s10_settings_quiet_hours.png`, עיגול על `friday_line` | |
| 40.5–42 | ש | `cards/11.png` | |
| 42–44.5 | ס11 | `office/s11_drawer_files_before_rename.png` → `s11_drawer_files.png` (תיבה `bank_file_name`) | |
| 44.5–46 | ש | `cards/12.png` | |
| 46–48 | ס12 | `office/s12_preview_blurry.png` או `_large.png` | המוזיקה נעצרת |
| 48–49 | ש | `cards/13.png` | שקט |
| 49–50.5 | ס13 | `office/s13_unreadable_button.png` (תיבה `button`) → `s13_unreadable_dialog.png` | |
| 50.5–51.5 | ש | `cards/14.png` | התופים חוזרים |
| 51.5–54.5 | ס14 | `phone/s14_again_notification.png`, `s14_client_page_again.png`, `camera_bank_again_*`, `s14_done_again.png`; `office/s14_approve_button.png` → `s14_done.png` (או `s14_board_done_glow.png`) | `mail`, `shutter` |
| 54.5–56 | ש | `cards/15.png` | |
| 56–59.5 | ס15 | `before/s3_owner_question_no_answer_phone.png` לרגע, ואז `owner/s15_summary_arrives.mp4` → `s15_summary_marked1.png` → `_marked2.png` | `mail` |
| 59.5–61 | ש | `cards/16.png` | `braam` |
| 61–64 | ש | `cards/17.png`, `cards/18.png` | `boom` ×2 |
| 64–66 | ש | `cards/19_nelio.png` | |
| 66–69.5 | ש | `cards/20.png` | |
| 69.5–72.5 | ש | `cards/21.png` | |

## מה עוד חסר, ומי עושה

1. **מוזיקה (המשתמש, דקה):** אי אפשר להוריד מכאן (הסביבה חוסמת את Pixabay). ההמלצה: **"Inspire Cinematic (Short Version)"** של NotProd, 1:12, כמעט בדיוק באורך הסרטון: https://pixabay.com/music/main-title-inspire-cinematic-short-version-389165/ . גיבוי: **"Uplifting Trailer (Short Version)"**, 2:15: https://pixabay.com/music/main-title-uplifting-trailer-short-version-350748/ . רישיון Pixabay: חינם, גם לשימוש מסחרי, בלי קרדיט; אסור רק למכור את המוזיקה עצמה. Claude לא שמע אותן: את ההתאמה בודקים בעריכה.
2. **הזמן האמיתי לשעון העצר (המשתמש, כ־15 דקות, פעם אחת):** "פחות משתי דקות" חייב להיות מדוד (D62: רק טענות אמיתיות). קודם ההגדרה החד־פעמית של השליח (`project/status.md`), ואז: איפוס, "קפיצה לכאן" ליד "מחר היום האחרון", לפתוח את המייל בטלפון, להפעיל שעון עצר, לצלם שלושה ניירות עד "תודה, קיבלנו הכול", ולרשום את הזמן. אחר כך לאפס.
3. **רשות, לא חובה:** הקלטת מסך אמיתית מהטלפון (המייל נוחת, המצלמה) במקום המסכים הבנויים, וקליפ סטוק עם ידיים מעל ניירות במקום `paper_pile.jpg` (למשל מ־Pexels). הסרטון עובד גם בלעדיהם.

## מה בנוי ומה אמיתי

- **אמיתי, בלי שינוי:** דף הלקוח, הלוח, הנתונים, נוסחי המיילים (נכתבו במסד ונצבעו ב־`renderEmail` של השרת), המסמכים (`demo/render_docs.py`).
- **בנוי:** אפליקציית הדואר והמצלמה בטלפון (כלליות, בלי מותג), מסגרת הטלפון, ערימת הניירות, הכרטיסים, הסאונד. בחתימת המייל הושמטה כתובת המייל של המשרד (Fiverr), ובתיבת הדואר אין כתובות.
- **ההתחברות של המשרד** מוחלפת בכלי בסשן מקומי (supabase-js), והשרת בודק אותו באותם כללים כמו תמיד.
- **שינוי אחד ב־DOM, לצורך מעבר:** `s9_board_waiting_as_before.png` (השורה של דוד כמו שהייתה לפני ההעלאה, באותו פריים) ו־`s11_drawer_files_before_rename.png` (השם שהתמונה הגיעה איתו, `IMG_4471.jpg`, שאכן נשמר במסד).
- **"Nelio" בכרטיס 19** כתוב ב־Bellefair, הגופן של הלוגו של המשרד. אין עדיין לוגו ל־Nelio: זו הצעה.
