import pathlib,json,base64,re,collections
run=pathlib.Path('tmp/theme-audit-runs/2026-09-11-remediation');data=json.loads((run/'cart-strict-repeat.json').read_text());rows=[]
def walk(s):
 for spec in s.get('specs',[]):
  for test in spec['tests']:
   for result in test['results']:
    row={'project':test['projectName'],'title':spec['title'],'status':result['status'],'errors':[re.sub(r'\x1b\[[0-9;]*m','',e.get('message',''))for e in result.get('errors',[])]};net=[];context=''
    for a in result.get('attachments',[]):
     if a.get('body')and a.get('contentType')=='application/json':
      d=json.loads(base64.b64decode(a['body']));net.extend(d if isinstance(d,list)else d.get('network',[]))
     if a['name']=='error-context':row['context_path']=a['path'];context=pathlib.Path(a['path']).read_text()
    row['http_evidence']=[r for r in net if r.get('status',0)>=400]
    if any(r['status']==429 for r in row['http_evidence']):row['category']='confirmed_cart_update_http429'
    elif 'unauthorized'in context:row['category']='storefront_unauthorized_json_http_unknown';row['context_excerpt']='{"error":"unauthorized"}'
    elif 'Failed to render storefront with status 502'in context:row['category']='storefront_render502_error_page';row['context_excerpt']='Failed to render storefront with status 502 (Bad Gateway).'
    elif 'There was a problem loading this website'in context:row['category']='storefront_generic_error_http_unknown';row['context_excerpt']='There was a problem loading this website'
    else:row['category']='unknown'
    row['error_body_read_timeout']=any('response.text: Test timeout'in e for e in row['errors'])
    rows.append(row)
 for c in s.get('suites',[]):walk(c)
for s in data['suites']:walk(s)
out={'stats':data['stats'],'categories':dict(collections.Counter(r['category']for r in rows)),'held_error_body_timeouts':sum(r['error_body_read_timeout']for r in rows),'conclusion':'0 passed / 12 failed. No successful strict decrement verification. Five direct update429 proofs; seven runs blocked at storefront identity because error pages were served. Three held cases received429headers but timed out while reading diagnostic error body.','tests':rows};(run/'cart-strict-failures.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items()if k!='tests'},ensure_ascii=False,indent=2))
