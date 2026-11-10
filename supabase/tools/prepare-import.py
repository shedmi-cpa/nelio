"""Convert a Sheets values export to ordered SQL batches. Never commit the export/output.
Usage: python supabase/tools/prepare-import.py /private/sheets.json /private/import
Dates in UNFORMATTED_VALUE are local Sheets serials; interpret in Asia/Jerusalem.
"""
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

schema=json.loads(Path(__file__).with_name('legacy-schema.json').read_text())
names={k:{'DocTypes':'doc_types','Log':'activity_log'}.get(k,k.lower()) for k in schema}
order=['Settings','Staff','DocTypes','Profiles','Templates','Holidays','Clients','Cycles','Requests','Items','Uploads','Messages','Log']

def convert(source):
    result={}
    for old in order:
        rows=source[old]; headers=rows[0]; records=[]
        formats={col:fmt for col,_,fmt in schema[old]}
        for row in rows[1:]:
            if not row or row[0] in ('',None): continue
            record={}
            for col,fmt in formats.items():
                value=row[headers.index(col)] if col in headers and headers.index(col)<len(row) else ''
                if col=='token':
                    if not isinstance(value,str) or len(value)<24: raise ValueError('Invalid token')
                    record['token_hash']=hashlib.sha256(value.encode()).hexdigest();continue
                if fmt in ('date','datetime'):
                    if value in ('',None): value=None
                    elif isinstance(value,(int,float)):
                        stamp=dt.datetime(1899,12,30)+dt.timedelta(days=value)
                        value=stamp.date().isoformat() if fmt=='date' else stamp.replace(tzinfo=ZoneInfo('Asia/Jerusalem')).isoformat()
                    else: raise ValueError(f'Expected numeric Sheets date: {old}.{col}')
                elif fmt=='number': value=int(value or 0)
                elif fmt=='checkbox': value=value is True or str(value).lower()=='true'
                else: value='' if value is None else str(value)
                if value=='' and col in {'cycle_id','request_id','client_id','staff_id'} and old=='Messages':value=None
                record[col]=value
            if old=='Settings' and record['key'] in ('test_link','test_link_2'):continue
            records.append(record)
        result[names[old]]=records
    return result

def sql_literal(value):
    if value is None:return 'NULL'
    if value is True:return 'true'
    if value is False:return 'false'
    if isinstance(value,(int,float)):return str(value)
    return "'"+str(value).replace("'","''")+"'"

def batches(tables):
    number=0
    for table,records in tables.items():
        for start in range(0,len(records),60):
            batch=records[start:start+60];columns=list(batch[0]);number+=1
            statement='insert into public.'+table+' ('+','.join('"'+c+'"' for c in columns)+') values\n'
            statement+=',\n'.join('('+','.join(sql_literal(r[c]) for c in columns)+')' for r in batch)+';\n'
            yield f'{number:03}_{table}.sql',statement

if __name__=='__main__':
    source=Path(sys.argv[1]).resolve();output=Path(sys.argv[2]).resolve();repo=Path(__file__).resolve().parents[2]
    if output.is_relative_to(repo) or source.is_relative_to(repo):raise SystemExit('Private data must stay outside the public repository')
    output.mkdir(mode=0o700,parents=True,exist_ok=True)
    tables=convert(json.loads(source.read_text()))
    for name,statement in batches(tables):
        path=output/name;path.write_text(statement);path.chmod(0o600)
    (output/'counts.json').write_text(json.dumps({k:len(v) for k,v in tables.items()},indent=2))
    print(json.dumps({k:len(v) for k,v in tables.items()}))
