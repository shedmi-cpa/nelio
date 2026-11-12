-- Minimal fictional reference data for the local SQL tests (run_sql_tests.sh). No real people or numbers.
insert into public.settings(key,value) values
 ('office_name','שדמי ושות'', רואי חשבון'),('office_email','shedmi.cpa@gmail.com'),
 ('client_page_url','https://shedmi-cpa.github.io/nelio/'),('max_file_mb','10'),('demo_mode','TRUE');
insert into public.staff(staff_id,name,role,email,active) values
 ('S1','עמית שדמי','owner','shedmi.cpa+s1@gmail.com',true),('S2','מירב סלעי','bookkeeper','shedmi.cpa+s2@gmail.com',true),
 ('S9','עובד לשעבר','bookkeeper','shedmi.cpa+s9@gmail.com',false);
insert into public.doc_types(doc_type_id,name_he,required,file_label,sort_order) values
 ('Z_REPORTS','דוחות Z',true,'דוחות-זד',1),('BANK_STATEMENT','דף בנק',true,'דף-בנק',3),
 ('CREDIT_CARD','פירוט אשראי',true,'פירוט-אשראי',4),('OTHER','מסמך אחר',false,'מסמך-אחר',9);
insert into public.profiles(profile_id,name_he,applies_when,doc_types) values ('SERVICE','נותן שירות','business_type','BANK_STATEMENT,CREDIT_CARD');
insert into public.templates(template_id,name_he,recipient,subject,body) values
 ('CONFIRMATION','אישור','client','קיבלנו את כל המסמכים ל[חודש]','שלום [שם איש הקשר],
תודה! קיבלנו את כל המסמכים ל[חודש].

[שם המשרד]'),
 ('REJECTED','מסמך לא קריא','client','צריך להעלות שוב: [סוג המסמך]','שלום [שם איש הקשר],
הקובץ שהעליתם ב"[סוג המסמך]" לא קריא: [סיבה].
אפשר לצלם שוב ולהעלות כאן? [קישור]'),
 ('WHATSAPP','תזכורת בוואטסאפ','client','','שלום [שם איש הקשר], כאן [שם המשרד]. עוד חסר לנו ל[חודש]: [מה שחסר]. אפשר להעלות כאן: [קישור]'),
 ('NEW_LINK','קישור חדש','client','קישור חדש להעלאת מסמכים','שלום [שם איש הקשר],
יצרנו לכם קישור חדש להעלאת המסמכים: [קישור]
הקישור הקודם כבר לא פעיל.');
insert into public.cycles(cycle_id,due_date,status) values ('2026-10','2026-11-12','open');
