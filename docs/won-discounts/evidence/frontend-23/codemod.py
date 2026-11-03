# codemod.py file... : replace colour literals by tokens of the same value (shell/tokens.ts); prints leftovers
import re,sys,os
TOK={'#f2f7ff':'WON_SELECT_TINT','#c7dcfb':'WON_SELECT_EDGE','rgba(26,115,232,.12)':'WON_SELECT_RING','rgba(26,115,232,.15)':'WON_SELECT_FOCUS',
 '#d6dbe1':'WON_CONTROL_EDGE','#c9d0d8':'WON_CONTROL_EDGE_STRONG','#b9c2cc':'WON_DASH','#48525f':'WON_FILL_NEUTRAL','#e9edf1':'WON_TRACK',
 '#eef1f4':'WON_CHIP','#f1f1f1':'WON_PANEL','#fafbfc':'WON_ROW_OPEN','#fbfcfd':'WON_LIST_BG','#e3e3e3':'WON_DIVIDER','#eab5b5':'WON_ATTENTION_EDGE',
 '#0f6b3f':'WON_LIVE_TEXT','#0f6b36':'WON_LIVE_TEXT_DEEP','#e6f6ed':'WON_LIVE_TINT','#bfe3cd':'WON_LIVE_EDGE','#1a8f4b':'WON_LIVE','#8892a0':'WON_FAINT',
 '#121212':'WON_SAMPLE_INK','#2f6fed':'WON_CHART','#0a7d4f':'WON_SAMPLE_ACCENT','#111418':'WON_INK','#8a4b00':'WON_WARNING_TEXT',
 'rgba(17,20,24,.18)':'WON_INK_SHADOW','#e9ebee':'WON_TAB_ON','#1a73e8':'WON_SELECT','#5f6b78':'WON_MUTED_ALT','#e3e7ec':'WON_LINE','#5b6472':'WON_MUTED','#f5f7f9':'WON_WASH','#cfd5dc':'WON_EDGE','#b42318':'WON_ATTENTION'}
WHITE=('#ffffff','#fff')
pat=re.compile(r'#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba\([^)]*\)')
def token(lit,before):
    l=lit.lower().replace(' ','')
    if l in WHITE: return 'WON_ON_FILL' if re.search(r'color\s*:\s*["`]?\s*$',before) and not re.search(r'background',before[-30:]) else 'WON_SURFACE'
    return TOK.get(l)
for f in sys.argv[1:]:
    s=open(f).read(); used=set(); left=[]
    # 1) quoted strings "..." containing a colour -> template literal
    def qs(m):
        body=m.group(1)
        if not pat.search(body): return m.group(0)
        out=''; last=0; ok=True
        for c in pat.finditer(body):
            t=token(c.group(0), s[max(0,m.start()-40):m.start()]+body[:c.start()])
            if not t: ok=False; break
            used.add(t); out+=body[last:c.start()]+'${'+t+'}'; last=c.end()
        if not ok: left.append(body); return m.group(0)
        out+=body[last:]
        if out=='${%s}'%t and body.strip()==c.group(0): return t  # whole string is the colour
        return '`'+out+'`'
    s=re.sub(r'"((?:[^"\\\n]|\\.)*)"',qs,s)
    # 2) inside template literals (not ${} parts): replace raw colours
    def tl(m):
        body=m.group(0)
        def rep(c):
            pre=body[:c.start()]
            if pre.count('${')>pre.count('}'): return c.group(0)
            t=token(c.group(0),pre)
            if not t: left.append(c.group(0)); return c.group(0)
            used.add(t); return '${'+t+'}'
        return pat.sub(rep,body)
    s=re.sub(r'`[^`]*`',tl,s)
    if used:
        rel=os.path.relpath(os.path.join(os.path.dirname(os.path.abspath(sys.argv[0]))),'.')
        m=re.search(r'import \{([^}]*)\} from "([./]*shell/tokens|\./tokens)";',s)
        if m:
            names=sorted(set([n.strip() for n in m.group(1).split(',') if n.strip()])|used)
            s=s.replace(m.group(0),'import { '+', '.join(names)+' } from "'+m.group(2)+'";')
        else:
            depth=f.split('app/components/')[1].count('/')
            path=('./shell/tokens' if depth==0 else '../'*(depth-1)+'../shell/tokens') if '/shell/' not in f else './tokens'
            lines=s.split('\n'); idx=max(i for i,l in enumerate(lines) if l.startswith('import ') or l.startswith('} from '))
            lines.insert(idx+1,'import { '+', '.join(sorted(used))+' } from "'+path+'";'); s='\n'.join(lines)
    open(f,'w').write(s)
    print(f, 'tokens:',len(used), 'left:',left)
