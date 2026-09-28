from PIL import Image,ImageOps,ImageDraw
from pathlib import Path
import json
root=Path('tmp/theme-audit-runs/2026-09-10-catalog');m=json.load(open('themes/won-base/examples/qa/manifest.json'));cases={c['id']:c for c in m['cases']}
files=sorted(p for p in (root/'screenshots').glob('*-1440*.png') if int(p.name[2:5])>=71)
(root/'desktop-sheets').mkdir(exist_ok=True)
index=[]
for n in range(0,len(files),4):
 group=files[n:n+4];sheet=Image.new('RGB',(1440,1680),'#dddddd');draw=ImageDraw.Draw(sheet)
 for j,p in enumerate(group):
  im=Image.open(p).convert('RGB');im.thumbnail((716,798));x=(j%2)*720;y=(j//2)*840;draw.text((x+4,y+4),p.stem+' '+cases[p.name[:5]]['label'][:68],fill='black');sheet.paste(im,(x,y+30))
 name=f'sheet-{n//4:02}.jpg';sheet.save(root/'desktop-sheets'/name,quality=94);index.append({'sheet':name,'files':[p.name for p in group]})
(root/'desktop-sheets/index.json').write_text(json.dumps(index,indent=2));print(len(files),len(index))
