"""Opt-in end-to-end test against a dedicated QA client (never a real client).
Usage: NELIO_TEST_TOKEN=... python supabase/tests/live_api.py
Creates clearly labeled demo documents. Keep tokens out of logs and git.
"""
import base64,concurrent.futures,io,json,os,time,urllib.request,uuid
URL=os.environ.get('NELIO_API_URL','https://ryqcyjajdioaxtpbxjzf.supabase.co/functions/v1/nelio-api')
TOKEN=os.environ['NELIO_TEST_TOKEN']; results=[]
def call(action,**kwargs):
    req=urllib.request.Request(URL,data=json.dumps(({'action':action,'token':TOKEN}|kwargs)).encode(),headers={'Content-Type':'text/plain','Origin':'https://shedmi-cpa.github.io'})
    started=time.monotonic()
    with urllib.request.urlopen(req,timeout=60) as response:
        assert response.headers['Access-Control-Allow-Origin']=='https://shedmi-cpa.github.io'
        data=json.load(response)
    results.append({'action':action,'ok':data.get('ok'),'code':data.get('code'),'serverMs':data.get('serverMs'),'elapsedMs':round((time.monotonic()-started)*1000)})
    print(action,data.get('ok'),data.get('code',''),flush=True)
    return data

def main():
    hello=call('hello');assert hello['ok'] and hello['businessName']=='בדיקת מעבר אוטומטית', 'Dedicated QA client required'
    baseline=next(i['fileCount'] for i in hello['items'] if i['docTypeId']=='BANK_STATEMENT')
    assert call('hello',token='x'*32)['code']=='BAD_TOKEN'
    assert call('finishUpload')['code']=='BAD_REQUEST'
    assert call('markNa',docTypeId='OTHER')['code']=='NA_NOT_OPTIONAL'
    assert call('markNa',docTypeId='NOT_MINE')['code']=='BAD_ITEM'
    assert call('note',note='   ')['code']=='EMPTY_NOTE'
    assert call('note',note='בדיקה אוטומטית בלבד: הערה לדוגמה')['ok']
    assert call('markNa',docTypeId='CREDIT_CARD',note='לא היה החודש')['item']['status']=='not_applicable'
    assert call('unmarkNa',docTypeId='CREDIT_CARD')['item']['status']=='missing'
    from PIL import Image,ImageDraw,ImageFont
    image=Image.new('RGB',(500,200),'white');draw=ImageDraw.Draw(image)
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',34)
    draw.text((40,40),'לדוגמה',fill='black',font=font,direction='rtl');draw.text((40,100),'AUTOMATED TEST',fill='black',font=font)
    out=io.BytesIO();image.save(out,format='PNG');encoded=base64.b64encode(out.getvalue()).decode()
    key=str(uuid.uuid4());payload=dict(docTypeId='BANK_STATEMENT',fileName='demo-migration.png',mimeType='image/png',data=encoded,uploadKey=key)
    assert call('upload',**(payload|{'data':base64.b64encode(b'not a png').decode()}))['code']=='BAD_FILE'
    upload=call('upload',**payload);assert upload['ok'],upload
    assert upload['item']['fileCount']==baseline+1 and upload['item']['status']=='received',upload
    retry=call('upload',**payload);assert retry['uploadId']==upload['uploadId'] and retry['item']['fileCount']==baseline+1,retry
    assert call('upload',**(payload|{'docTypeId':'CREDIT_CARD'}))['code']=='UPLOAD_CONFLICT'
    assert call('markNa',docTypeId='BANK_STATEMENT')['code']=='NA_NOT_ALLOWED'
    assert call('unmarkNa',docTypeId='BANK_STATEMENT')['code']=='NA_NOT_ALLOWED'
    payload['uploadKey']=str(uuid.uuid4())
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: parallel_results=list(pool.map(lambda _:call('upload',**payload),range(2)))
    assert all(r['ok'] for r in parallel_results),parallel_results
    assert parallel_results[0]['uploadId']==parallel_results[1]['uploadId']
    assert all(r['item']['fileCount']==baseline+2 for r in parallel_results),parallel_results
    assert parallel_results[0]['duplicateOf']
    for doc in ['ISSUED_INVOICES','EXPENSE_RECEIPTS','CREDIT_CARD']: last=call('markNa',docTypeId=doc)
    assert last['requestStatus']=='submitted',last
    assert call('unmarkNa',docTypeId='CREDIT_CARD')['requestStatus']=='partial'
    assert call('markNa',docTypeId='CREDIT_CARD')['requestStatus']=='submitted'
    final=call('hello');assert final['requestStatus']=='submitted'
    assert [i for i in final['items'] if i['docTypeId']=='BANK_STATEMENT'][0]['fileCount']==baseline+2
    print(json.dumps({'passed':True,'calls':len(results),'results':results},ensure_ascii=False))
if __name__=='__main__':main()
