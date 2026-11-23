# video/edit: עריכת הסרטון

`render.py` עורך את הטריילר (טיוטה 3 ב־`project/video-script.md`) מחומרי הגלם שבענף `video-assets`, ומוציא MP4 מוכן: 1920 × 1080, 30 פריימים לשנייה, עם אפקטי הסאונד.

```
git clone --depth 1 -b video-assets https://github.com/shedmi-cpa/nelio assets
python3 video/edit/render.py assets out.mp4                           # הכול, כ־3 דקות
python3 video/edit/render.py assets checks --frames 10.5,36.4         # תמונות בדיקה בשניות האלה
```

- **`TIMELINE`** היא רשימת החלקים לפי הסדר, עם אורך בשניות. כל סצנה היא פונקציה שמקבלת זמן ומחזירה פריים; כרטיס הוא `card(...)`.
- **`sound()`** מציבה את האפקטים לפי תחילת כל חלק. מוזיקה, כשתגיע: מוסיפים ערוץ נוסף שם, ומרכיבים מחדש רק את הסאונד.
- **חלקים שכבר קודדו נשמרים** ב־`<out>_parts/` ולא מקודדים שוב: אחרי שינוי בסצנה, מוחקים רק את הקובץ שלה.
- צריך: Python 3 עם pillow, numpy ו־scipy, ו־ffmpeg.
