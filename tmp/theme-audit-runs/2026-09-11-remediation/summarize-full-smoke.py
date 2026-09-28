import json,base64,re,collections,pathlib
root=pathlib.Path.cwd();run=root/'tmp/theme-audit-runs/2026-09-11-remediation';data=json.loads((run/'full-smoke.json').read_text());fail=[];skips=[]
def walk(s):
 for spec in s.get('specs',[]):
  for test in spec['tests']:
   for result in test.get('results',[]):
    status=result['status']
    if status not in ['failed','timedOut','skipped']:continue
    row={'project':test['projectName'],'file':spec['file'],'line':spec['line'],'title':spec['title'],'status':status}
    if status=='skipped':
     row['reasons']=[a.get('description','')for a in test.get('annotations',[])if a['type']=='skip'];locs=[a['location']for a in test.get('annotations',[])if a['type']=='skip'and'location'in a]
     row['skip_locations']=locs
     existed=[]
     for loc in locs:
      p=pathlib.Path(loc['file']);old=pathlib.Path('/private/tmp/won-pre-remediation-20260911')/p.relative_to(root)
      current=p.read_text();baseline=old.read_text() if old.exists()else''
      calls=lambda t:set(re.sub(r'\s+','',x)for x in re.findall(r'test\.skip\([\s\S]*?\);',t))
      existed.append(calls(current).issubset(calls(baseline)))
     row['all_skip_calls_in_file_preexist']=all(existed)and bool(existed)
     desc=' '.join(row['reasons'])
     if 'optional editorial'in desc:row['category']='existing_opt_in_editorial_env_off'
     elif 'source QA catalogue'in desc:row['category']='existing_opt_in_qa_env_off'
     elif any(v in desc for v in ['mobile','desktop','750','990','phones','phone']):row['category']='existing_viewport_condition'
     else:row['category']='existing_setting_or_fixture_condition'
     skips.append(row);continue
    row['error']=re.sub(r'\x1b\[[0-9;]*m','',result.get('error',{}).get('message',''))[:900]
    statuses=[];attachments=[];context=''
    for a in result.get('attachments',[]):
     if a.get('contentType')=='application/json'and a.get('body'):
      content=json.loads(base64.b64decode(a['body']));records=content if isinstance(content,list)else content.get('network',[])
      relevant=[v for v in records if isinstance(v,dict)and v.get('status',0)>=400]
      statuses.extend(relevant);attachments.append({'name':a['name'],'http_failures':relevant})
     if a['name']=='error-context'and a.get('path'):
      context=pathlib.Path(a['path']).read_text();row['context_path']=a['path']
    row['http_evidence']=list({json.dumps(v,sort_keys=True):v for v in statuses}.values());row['evidence_attachments']=attachments
    if any(v['status']==429 for v in statuses):row['category']='confirmed_cart_write_http_429'
    elif any(v['status']==503 for v in statuses)or'HTTP 503'in row['error']:row['category']='confirmed_cart_read_http_503'
    elif 'Your connection needs to be verified'in context:row['category']='storefront_connection_challenge';row['context_excerpt']='Your connection needs to be verified before you can proceed'
    elif 'There was a problem loading this website'in context:row['category']='storefront_error_page_http_unknown';row['context_excerpt']='There was a problem loading this website'
    elif'no CSS selector'in row['title']:row['category']='static_wrapper_guard_false_positive_corrected_after_run'
    else:row['category']='cart_failure_http_not_instrumented_unresolved'
    fail.append(row)
 for child in s.get('suites',[]):walk(child)
for s in data['suites']:walk(s)
summary={'stats':data['stats'],'failure_categories':dict(collections.Counter(r['category']for r in fail)),'skip_categories':dict(collections.Counter(r['category']for r in skips)),'all_39_skip_calls_preexist':all(r['all_skip_calls_in_file_preexist']for r in skips),'decrement_pass_caveat':'The four green decrement entries in this full run predate positive-commit/held-response-success guards. Zero could also be a rollback after HTTP429; they are NOT final evidence that writes/decrements succeeded. Strict rerun is owned by root.','failures':fail,'skips':skips}
(run/'full-smoke-failures.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items()if k not in ['failures','skips']},ensure_ascii=False,indent=2));print('UNVERIFIED SKIP FILES',set(r['file']for r in skips if not r['all_skip_calls_in_file_preexist']))
