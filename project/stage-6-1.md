# Nelio — שלב 6.1: התחברות והרשאות (10/11/2026)

**מצב בסגירת 11/11/2026:** ✅ 6.1 נסגר באישור המשתמש ("הכל תקין"). PR #2 מוזג ל־main ב־`f64270d7d32a822b20a4117e452edc744fd449b0`; Edge Function `nelio-office` פעילה; בדיקות CI עברו. Google OAuth והחזרת המשתמש ל־`/nelio/office/` הוגדרו והמשתמש אישר שהכול תקין. **הערת בדיקה:** לא דווחו בנפרד תוצאות ניסיון עם חשבון Google זר וקריאות 401/403 חיות. שלב 5 עדיין ממתין לבדיקת טלפון. השלב הבא: 6.2 בשיחה חדשה.

## מה נבנה ולמה
- דף משרד חדש ב־docs/office: כניסה דרך Google, הצגת מחזור, מונים וטבלת לקוחות בקריאה בלבד.
- Edge Function חדשה ונפרדת: nelio-office. בכל בקשה היא בודקת JWT מול Supabase Auth, ואז מוודאת שהמשתמש מחובר עם זהות Google וכתובת המשרד המאומתת shedmi.cpa@gmail.com. התחברות ל-Google לבדה אינה מקנה הרשאה.
- נתוני לקוחות נשלפים דרך שרת בעל הרשאות, לעולם לא ישירות מהדפדפן. המפתח המשרדי הסודי לא מופיע בגיטהאב. אין שינוי בשרת הלקוח, בסכמה או ב-RLS.
- בדיקות אבטחה: חשבון לא מורשה, טוקן חסר, Origin לא מורשה, פעולות אסורות, נתונים בקריאה בלבד.

## הגדרת Google OAuth הנדרשת ממך
1. פתח Google Auth Platform (https://console.cloud.google.com/auth/overview) בפרויקט Cloud קיים. אם דרוש פרויקט או חשבון חדש, קבל אישור בהתאם לכללי הפרויקט.
2. הגדר OAuth Client מסוג Web application, עם JavaScript origin: https://shedmi-cpa.github.io
3. הגדר Google redirect URI: https://ryqcyjajdioaxtpbxjzf.supabase.co/auth/v1/callback (בדוק מול כתובת Callback המוצגת בדשבורד Supabase).
4. ב־Supabase → Authentication → Providers → Google: הפעל את Google והזן שם בלבד את Client ID ו־Client Secret. אל תעתיק את הסוד לשיחה או לריפו. אם האפליקציה ב-Testing, הוסף את חשבון המשרד כבודק.
5. ב־Supabase → Authentication → URL Configuration הוסף ל־Redirect URLs: https://shedmi-cpa.github.io/nelio/office/ . אל תשנה את Site URL של דף הלקוח.
6. אחרי מיזוג ה־PR והעלאת Edge Function, פתח https://shedmi-cpa.github.io/nelio/office/

## רשימת בדיקות לסגירת 6.1
1. דפדפן פרטי מציג כניסה בלבד, ללא נתונים.
2. כניסה עם חשבון המשרד מציגה מחזור, מונים ולקוחות מתוך Supabase. מעבר מחזור משנה את הנתונים.
3. התנתקות מסתירה נתונים.
4. חשבון Google אחר מקבל חסימת הרשאה.
5. API ללא JWT מחזיר 401; חשבון אחר מקבל 403.
6. דף הלקוח ממשיך לעבוד. בדיקת הטלפון של שלב 5 עדיין נפרדת.

המשך: 6.2 תיק לקוח, סינון וקבצים פרטיים; 6.3 פעולות משרד. שליחת מיילים ותזמון: שלב 7.
