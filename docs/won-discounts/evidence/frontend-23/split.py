# split.py src.tsx main_out.tsx parts_out.tsx "export function Main" header_comment_for_parts
# Splits a screen: everything above the main export becomes parts (exported), the rest the screen; imports pruned.
import re,sys,os
src,main_out,parts_out,marker,parts_head=sys.argv[1:6]
s=open(src).read()
# leading comment + imports block
lines=s.split('\n')
imp_end=0; i=0
while i<len(lines):
    l=lines[i]
    if l.startswith('import '):
        j=i
        while not re.search(r'from "[^"]+";\s*$|^import "[^"]+";\s*$',lines[j]): j+=1
        imp_end=j+1; i=j+1; continue
    i+=1
    if i>imp_end+40 and imp_end>0: break
head_comment='\n'.join(l for l in lines[:imp_end] if not l.startswith('import ') and not l.startswith('  ') and not l.startswith('} from') )
imports_text='\n'.join(lines[:imp_end])
imports=re.findall(r'^import (type )?(?:\{([^}]*)\}|(\w+))(?:, \{([^}]*)\})? from "([^"]+)";',imports_text,re.M|re.S)
body='\n'.join(lines[imp_end:])
cut=body.index(marker)
parts_body=body[:cut]; main_body=body[cut:]
# export every top-level declaration of parts
decl_re=re.compile(r'^(?:export )?(const|function|interface|type) (\w+)',re.M)
names=[m.group(2) for m in decl_re.finditer(parts_body)]
parts_body=re.sub(r'^(const|function|interface|type) ',r'export \1 ',parts_body,flags=re.M)
def used(text,name): return re.search(r'(?<![\w.])'+re.escape(name)+r'\b',text.replace('...',' ')) is not None
def rel(path, frm_dir_depth_delta):
    if path.startswith('.'): return '../'+path if path.startswith('./') else '../'+path
    return path
def build_imports(text):
    out=[]
    for tkw,named,default,named2,path in imports:
        p=('.'+path[1:] if False else path)
        p=('../'+path[2:]) if path.startswith('./') else (('../'+path) if path.startswith('../') else path)
        items=[x.strip() for x in (named+','+named2).split(',') if x.strip()]
        keep=[]
        for it in items:
            nm=it.replace('type ','').split(' as ')[-1].strip()
            if used(text,nm): keep.append(it)
        dflt=default if default and used(text,default) else ''
        if not keep and not dflt: continue
        if dflt and keep: out.append(f'import {tkw or ""}{dflt}, {{ {", ".join(keep)} }} from "{p}";')
        elif dflt: out.append(f'import {tkw or ""}{dflt} from "{p}";')
        else: out.append(f'import {tkw or ""}{{ {", ".join(keep)} }} from "{p}";')
    return out
side=[l for l in lines[:imp_end] if re.match(r'^import "[^"]+";',l)]
main_imps=build_imports(main_body)
used_parts=[n for n in names if used(main_body,n)]
screen_props=[n for n in used_parts if n.endswith('ScreenProps')]
if used_parts: main_imps.append('import { '+', '.join(sorted(used_parts))+' } from "./'+os.path.basename(parts_out)[:-4]+'";')
parts_imps=build_imports(parts_body)
open(main_out,'w').write(head_comment.strip()+'\n\n'+'\n'.join(side+main_imps)+'\n'+''.join('export type { %s } from "./%s";\n' % (n, os.path.basename(parts_out)[:-4]) for n in screen_props)+'\n'+main_body.lstrip('\n'))
open(parts_out,'w').write(parts_head.strip()+'\n\n'+'\n'.join(parts_imps)+'\n'+parts_body.rstrip()+'\n')
print(main_out, len(open(main_out).read().split('\n')), parts_out, len(open(parts_out).read().split('\n')), 'exported to main:', used_parts)
