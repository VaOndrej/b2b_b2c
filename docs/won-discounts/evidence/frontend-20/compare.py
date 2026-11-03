# compare.py before_dir after_dir : pixel-compare every PNG present in both; prints differing files with % of pixels changed
import sys,os
from PIL import Image, ImageChops
a,b=sys.argv[1],sys.argv[2]
diffs=[]
for f in sorted(os.listdir(a)):
    if not f.endswith('.png') or not os.path.exists(os.path.join(b,f)): continue
    x=Image.open(os.path.join(a,f)).convert('RGB'); y=Image.open(os.path.join(b,f)).convert('RGB')
    if x.size!=y.size: diffs.append((f,'size %s -> %s'%(x.size,y.size))); continue
    d=ImageChops.difference(x,y); bbox=d.getbbox()
    if bbox:
        n=sum(1 for p in d.getdata() if p!=(0,0,0)); diffs.append((f,'%.3f%% px, bbox %s'%(100*n/(x.size[0]*x.size[1]),bbox)))
print('compared',len([f for f in os.listdir(a) if f.endswith('.png')]),'differing',len(diffs))
for f,m in diffs: print(' ',f,m)
