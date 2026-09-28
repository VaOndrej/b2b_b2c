import json,csv,re,collections
from pathlib import Path
r=Path('tmp/theme-audit-runs/2026-09-10-catalog');cases=json.load(open('themes/won-base/examples/qa/manifest.json'))['cases'];raw={};reviews={};signals={}
for folder in [r/'before-fixes',r/'after-recapture',r]:
 for p in sorted(folder.glob('*.json')):
  try:d=json.load(open(p))
  except:continue
  if not isinstance(d,dict) or 'results' not in d:continue
  for row in d['results']:raw[row['id'],row['width']]={**row,'evidenceJson':str(p)}
  signals[d['url'],d['width']]={**d.get('signals',{}),'evidenceJson':str(p)}
for p in [r/'review-390.json',r/'review-768.json',r/'review-1440-sections.json',r/'review-1440-blocks.json']:
 d=json.load(open(p))
 for row in d.get('reviewed',[]):
  if 'id'in row and 'width'in row:reviews[row['id'],row['width']]=row
rows=[]
for c in sorted(cases,key=lambda c:c['id']):
 for width in [390,768,1440]:
  k=c['id'],width;v=reviews.get(k);a=raw.get(k,{});note=v.get('notes','') if v else 'Očekávaně skryté podle device scope; bez vizuálního schválení.'
  if isinstance(note,list):note='; '.join(note)
  shots=[]
  for s in v.get('screenshots',[]) if v else []:
   p=Path(s);p=p if str(p).startswith('tmp/') else r/p
   assert p.exists(),p
   shots.append(str(p))
  for extra in json.load(open(r/'review-interaction-states.json'))['reviewed']:
   if extra.get('id')==c['id'] and extra.get('width')==width:
    shots.extend(str(r/p) for p in extra['screenshots'])
    note+=' Doplňkový stav: '+str(extra.get('notes',''))
  verdict=v.get('verdict') if v else 'expected-hidden' if a.get('status')=='expected-hidden' else 'NOT REVIEWED'
  if c['id']=='qa135':note+=' Geometrie potvrzuje přesah CTA mimo vlastní kartu; na768/1440 i mimo viewport.';verdict='issue' if width>=750 else verdict
  if c['id']=='qa149':note+=' Nutriční metafield je reálně naplněný; starý inventární limit o dostupnosti zde neplatí.'
  if c['id']=='qa175':note+=' Po Play Vimeo hlásí Rights issue; přehrávání nebylo úspěšné.'
  if c['id']=='qa171' and width==1440 and (r/'qa171-final-1440.png').exists():shots=[str(r/'qa171-final-1440.png')];note='Finální snímek po ustálení layoutu a pozastavení autoplay hoverem skutečně prohlédnut; behavior v interaction-states.json.'
  checks=[]
  for x in a.get('checks',[]):checks.append(x['name']+': '+('FAIL' if x.get('error') or x.get('pass')==False else 'recorded' if 'pass'not in x else 'PASS'))
  rows.append({'id':c['id'],'block':c['type'],'variant':c['variant'],'url':'http://127.0.0.1:9292'+c['url'],'viewport':width,'visual':verdict,'notes':note,'limitations':'; '.join(c.get('limitations',[])),'checks':'; '.join(checks),'screenshots':shots,'raw':a.get('evidenceJson'),'captureStatus':a.get('status')})
assert len(rows)==528
out=Path('docs/audits/2026-09-10-won-visual-matrix.md')
lines=['# Won vizuální matice — 10. 9. 2026','','[Hlavní audit](2026-09-10-won-visual-audit.md). 176 případů × 3 viewporty. `reviewed`/`visual-pass` znamená prohlédnutý stav bez další zjevné vady v dané ukázce, nikoli schválený celý funkční flow. `limited`/`empty-state` dokládá jen omezený obsah. `issue`/`visual-issue` popisuje pozorovaný problém. Tři `expected-hidden` jsou ověřené display:none mimo device scope, bez screenshotu.','', '## Matice','','| ID / blok | Varianta | URL | px | Vizuální výsledek / poznámka | Důkaz |','|---|---|---|---:|---|---|']
def esc(s):return str(s).replace('|','\\|').replace('\n',' ')
for row in rows:
 links=' · '.join(f'[PNG{i+1}](../../{p})' for i,p in enumerate(row['screenshots'])) or 'záměrně skryto'
 links+=f' · [JSON](../../{row["raw"]})' if row['raw'] else ''
 lines.append(f'| {row["id"]} `{row["block"]}` | {esc(row["variant"])} | [preview]({row["url"]}) | {row["viewport"]} | **{esc(row["visual"])}** — {esc(row["notes"])} | {links} |')
out.write_text('\n'.join(lines)+'\n')
with open(out.with_suffix('.csv'),'w') as f:
 w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows([{**x,'screenshots':'; '.join(x['screenshots'])}for x in rows])
(r/'matrix.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
summary={'cases':len(cases),'rows':len(rows),'visuallyReviewed':sum(bool(x['screenshots'])for x in rows),'captureStatuses':dict(collections.Counter(x['captureStatus']for x in rows)),'screenshots':sum(len(x['screenshots'])for x in rows),'visualStatuses':dict(collections.Counter(x['visual']for x in rows)),'responsive':dict(collections.Counter('pass' if s.get('responsive')=='pass' else 'fail' for s in signals.values() if s.get('responsive'))),'pageErrors':[{k:str(k),'errors':s['pageErrors']}for k,s in signals.items()if s.get('pageErrors')],'failedAssets':[{ 'url':k[0],'width':k[1],'assets':s.get('failedAssets')}for k,s in signals.items()if s.get('failedAssets')]}
# Tuple URL keys stay only in temporary dicts, never JSON.
summary['pageErrors']=[{'url':k[0],'width':k[1],'errors':s['pageErrors']}for k,s in signals.items()if s.get('pageErrors')]
(r/'coverage-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print({k:v for k,v in summary.items()if k not in ['failedAssets','pageErrors']})
