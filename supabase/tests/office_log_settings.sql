-- Stage 6.3.3: log and settings. Always rolled back.
begin;
insert into public.clients(client_id,business_name,contact_name,email,profile_id,frequency,bookkeeper_id,token_hash,active)
values('QA_L','עסק ליומן','איש קשר','shedmi.cpa+qal@gmail.com','SERVICE','monthly','S2',encode(extensions.digest(repeat('l',43),'sha256'),'hex'),true);
insert into public.requests(request_id,cycle_id,client_id,period,status) values('QA_L_REQ','2026-10','QA_L','2026-10','partial');
insert into public.cycles(cycle_id,due_date,status,opened_at,closed_at) values('2026-09','2026-10-12','closed','2026-10-01 06:00+00','2026-11-01 07:00+00');
update public.cycles set opened_at='2026-11-01 07:00+00' where cycle_id='2026-10';
insert into public.activity_log(at,real_at,actor,event,client_id,request_id,details) values
 (now()-interval '2 minutes',now(),'client:QA_L','upload','QA_L','QA_L_REQ','עסק-ליומן_2026-10_דף-בנק_01.jpg'),
 ('2026-11-01 07:00+00',now(),'system','cycle_open','','','נפתח מחזור אוקטובר'),
 ('2026-10-01 06:00+00',now(),'system','cycle_open','','','נפתח מחזור ספטמבר');
insert into public.messages(message_id,created_at,template_id,cycle_id,request_id,client_id,status,created_by)
values('QA_MSG',now()-interval '1 minute','CONFIRMATION','2026-10','QA_L_REQ','QA_L','simulated','system');
insert into public.settings(key,value) values('due_day','12');
set local role service_role;
do $$
declare a jsonb; r jsonb;
begin
 a:=public.nelio_office_log('{"cycleId":"2026-10"}');
 assert a->>'ok'='true','log';
 assert (a->'rows'->0->>'kind')='message' and (a->'rows'->0->>'details')='אישור' and (a->'rows'->0->>'status')='simulated','newest first, message with template name';
 assert (a->'rows'->1->>'event')='upload' and (a->'rows'->1->>'businessName')='עסק ליומן','client action with business name';
 assert exists(select 1 from jsonb_array_elements(a->'rows') x where x->>'details'='נפתח מחזור אוקטובר'),'system entry of this cycle';
 assert not exists(select 1 from jsonb_array_elements(a->'rows') x where x->>'details'='נפתח מחזור ספטמבר'),'other cycle excluded';
 assert public.nelio_office_log('{"cycleId":"1999-01"}')->>'code'='NOT_FOUND','unknown cycle';
 assert jsonb_array_length(public.nelio_office_log('{}')->'rows')>=4,'all cycles';

 a:=public.nelio_office_settings('{"action":"get"}');
 assert jsonb_array_length(a->'settings')=9,'nine settings';
 assert exists(select 1 from jsonb_array_elements(a->'settings') x where x->>'key'='due_day' and x->>'value'='12' and (x->>'stored')::boolean),'stored value';
 assert exists(select 1 from jsonb_array_elements(a->'settings') x where x->>'key'='quiet_start' and x->>'value'='21:00' and not (x->>'stored')::boolean),'default value';
 assert exists(select 1 from jsonb_array_elements(a->'templates') x where x->>'templateId'='REMINDER_1'),'templates listed';

 a:=public.nelio_office_settings('{"action":"save","actor":"S9","values":{"due_day":"10"}}');
 assert a->>'code'='BAD_ACTOR','actor required';
 a:=public.nelio_office_settings('{"action":"save","actor":"S2","values":{"demo_mode":"FALSE"}}');
 assert a->>'code'='BAD_REQUEST','only listed keys';
 assert (select value from public.settings where key='demo_mode')='TRUE','demo mode untouched';
 a:=public.nelio_office_settings('{"action":"save","actor":"S2","values":{"due_day":"31"}}');
 assert a->>'code'='BAD_VALUE' and a->>'key'='due_day','day range';
 a:=public.nelio_office_settings('{"action":"save","actor":"S2","values":{"send_time":"9:00"}}');
 assert a->>'code'='BAD_VALUE','time format';
 a:=public.nelio_office_settings('{"action":"save","actor":"S2","values":{"reminder2_days_before":"8"}}');
 assert a->>'code'='BAD_ORDER','second reminder after the first';
 a:=public.nelio_office_settings('{"action":"save","actor":"S2","values":{"send_time":"22:00"}}');
 assert a->>'code'='BAD_QUIET','no sending in quiet hours';
 a:=public.nelio_office_settings('{"action":"save","actor":"S2","values":{"due_day":"14","reminder1_days_before":"8"}}');
 assert a->>'ok'='true' and (a->>'changed')::boolean,'saved';
 assert (select value from public.settings where key='due_day')='14' and (select value from public.settings where key='reminder1_days_before')='8','stored';
 assert (select details from public.activity_log where event='office_settings' and actor='office:S2')='due_day: 12 → 14; reminder1_days_before: 7 → 8','logged old and new';
 a:=public.nelio_office_settings('{"action":"save","actor":"S2","values":{"due_day":"14"}}');
 assert not (a->>'changed')::boolean and (select count(*) from public.activity_log where event='office_settings')=1,'no change, no log';

 a:=public.nelio_office_settings('{"action":"saveTemplate","actor":"S2","templateId":"REMINDER_1","subject":"תזכורת","body":"שלום, חסר [מה שחסר]."}');
 assert a->>'code'='LINK_REQUIRED','link kept';
 a:=public.nelio_office_settings('{"action":"saveTemplate","actor":"S2","templateId":"NOPE","subject":"","body":"x"}');
 assert a->>'code'='NOT_FOUND','unknown template';
 a:=public.nelio_office_settings(jsonb_build_object('action','saveTemplate','actor','S2','templateId','REMINDER_1','subject','תזכורת: [חודש]','body','שלום [שם איש הקשר],'||chr(13)||chr(10)||'חסר: [מה שחסר]. [קישור]'));
 assert a->>'ok'='true' and (a->>'changed')::boolean,'template saved';
 assert (select body from public.templates where template_id='REMINDER_1')='שלום [שם איש הקשר],'||chr(10)||'חסר: [מה שחסר]. [קישור]','line endings normalized';
 assert (select details from public.activity_log where event='office_template')='תזכורת ראשונה','template change logged';

 assert not has_function_privilege('anon','public.nelio_office_settings(jsonb)','EXECUTE'),'anon denied settings';
 assert not has_function_privilege('authenticated','public.nelio_office_log(jsonb)','EXECUTE'),'authenticated denied log';
end $$;
rollback;
