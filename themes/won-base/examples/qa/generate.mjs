// Source-owned, deterministic alternative templates. Never assigns or publishes templates.
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../../..');
const base=path.join(root,'themes/won-base');
const out=path.join(root,'themes/demo/horizon/templates');
const locale=JSON.parse(readFileSync(path.join(base,'locales/en.default.schema.json')));
const schemas={};const kinds={};
for(const kind of ['sections','blocks'])for(const f of readdirSync(path.join(base,kind)).filter(f=>f.startsWith('won-')&&f.endsWith('.liquid'))){const s=JSON.parse(readFileSync(path.join(base,kind,f),'utf8').match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);schemas[f.slice(0,-7)]=s;kinds[f.slice(0,-7)]=kind;}
const tr=v=>typeof v==='string'&&v.startsWith('t:')?v.slice(2).split('.').reduce((o,k)=>o?.[k],locale)||v:v;
const img='shopify://shop_images/won-pack-preworkout.png';const photo='shopify://shop_images/photo-1526170375885-4d8ecf77b99f.jpg';
const product='the-videographer-snowboard',collection='automated-collection';
const clone=o=>structuredClone(o);
function settings(type,over={}){const s={};for(const x of schemas[type]?.settings||[])if(x.id&&x.default!==undefined)s[x.id]=tr(x.default);
 if('heading'in s)s.heading='<p>QA sample — clear information for a considered choice</p>';
 if(type==='won-feature')s.heading='QA sample benefit';
 if(type==='won-slide')Object.assign(s,{heading:'<p>QA sample — practical information</p>',text:'<p>Demonstration content only. This longer description checks wrapping, reading rhythm and the space around the call to action.</p>',media_type:'image',image:photo,image_asset:'',button_label:'View demo product',button_link:'/products/'+product,reviewer:'QA fictional example',review_rating:0,expert_role:'QA example role',media_caption:'Demonstration portrait'});
 for(const x of schemas[type]?.settings||[]){if(x.type==='image_picker')s[x.id]=img;if(x.type==='product')s[x.id]=product;if(x.type==='collection')s[x.id]=collection;if(x.type==='blog')s[x.id]='news';}
 if(type==='won-tile')Object.assign(s,{heading:'QA sample category',link_url:'/collections/'+collection,badge_text:'QA sample'});
 if(type==='won-band')Object.assign(s,{body:'<p>Demonstration content with a longer paragraph to check balanced image and text proportions on smaller screens.</p>',button_label:'Explore demo',button_link:'/collections/'+collection});
 if(type==='won-panel'||type==='won-tab'||type==='won-accordion-row')Object.assign(s,{title:'QA question — how does this example work?',summary:'QA question — how does this example work?',content:'<p>Demonstration answer with enough content to check expansion, keyboard focus, spacing and line length. This is illustrative information.</p>'});
 if(type==='won-app-slot')Object.assign(s,{text:'<p>QA app integration shell. No app block is installed in this fixture.</p>',cta_label:'Explore demo collection',cta_url:'/collections/'+collection});
 if(type==='won-product-meta')s.badge_text='QA sample';
 if(type==='won-product-offer')s.badge_text='QA example offer — no discount applied';
 if(type==='won-price-per-unit')s.rules='';
 if('emit_schema'in s)s.emit_schema=false;if('emit_faq_schema'in s)s.emit_faq_schema=false;
 // Presets currently contain card_style:plain, while schema accepts minimal. Keep valid fixture configuration.
 const combined={...s,...Object.fromEntries(Object.entries(over).map(([k,v])=>[k,tr(v)]))};if(combined.card_style==='plain')combined.card_style='minimal';
 for(const field of schemas[type]?.settings||[])if(['inline_richtext','text'].includes(field.type)&&typeof combined[field.id]==='string')combined[field.id]=combined[field.id].replace(/<\/?p[^>]*>/g,'');
 const valid=new Set((schemas[type]?.settings||[]).map(s=>s.id));return Object.fromEntries(Object.entries(combined).filter(([k])=>valid.has(k)));
}
function node(type,over={},children){const n={type,settings:settings(type,over)};if(children){n.blocks={};n.block_order=[];children.forEach((v,i)=>{const id='b'+(i+1);n.blocks[id]=v;n.block_order.push(id);});}return n;}
function fromPreset(p){return node(p.type,p.settings,p.blocks?.map(fromPreset));}
const slides=(n=6)=>Array.from({length:n},(_,i)=>node('won-slide',{heading:`<p>QA card ${i+1} — ${i%2?'a longer title demonstrating multiline wrapping':'short title'}</p>`}));
function fixture(type,over={},preset){let children=preset?.blocks?.map(fromPreset);if(!children){if(['won-hero','won-hero-carousel','won-hero-grid','won-carousel'].includes(type))children=slides(type==='won-hero'?1:6);if(type==='won-grid')children=Array.from({length:4},()=>node('won-feature',{icon:'check'}));if(type==='won-panels')children=Array.from({length:4},()=>node('won-panel'));if(type==='won-group')children=[node('won-feature',{icon:'check'}),node('won-panel',{row_style:'editorial'})];if(type==='won-product-offer')children=[{type:'variant-picker',settings:{}}];if(type==='won-panel')children=[node('won-feature',{icon:'leaf'})];}
 const n=node(type,{...preset?.settings,...over},children);
 if(type==='won-announcement-bar') {n.blocks={m:{type:'message',settings:{text:'QA sample announcement',link:'/collections/'+collection}},s:{type:'free_shipping',settings:{threshold:1500}}};n.block_order=['m','s'];}
 if(type==='won-marquee'){n.blocks={};n.block_order=[];for(let i=0;i<6;i++){const id='t'+i;n.blocks[id]={type:'token',settings:{kind:i===1?'image':'text',text:'QA demonstration '+(i+1),image:img,link:'/collections/'+collection}};n.block_order.push(id);}}
 if(type==='won-footer'){n.blocks={m:{type:'menu',settings:{heading:'QA navigation',links:'Demo products | /collections/all\nSample information | /pages/about'}}};n.block_order=['m'];}
 if(type==='won-tabbed-rail'){n.blocks={a:{type:'tab',settings:{title:'QA collection A',collection,products_limit:8}},b:{type:'tab',settings:{title:'QA collection B',collection:'all',products_limit:8}}};n.block_order=['a','b'];}
 if(type==='won-shoppable-image'){n.blocks={a:{type:'hotspot',settings:{product,x:30,y:50,custom_mobile_pos:true,x_mobile:35,y_mobile:65}},b:{type:'hotspot',settings:{product:'the-collection-snowboard-hydrogen',x:78,y:45}}};n.block_order=['a','b'];}
 return n;
}
const cases=[];let seq=0;function add(type,variant,over={},preset,extra={}){cases.push({id:'qa'+String(++seq).padStart(3,'0'),type,variant,label:`${type} · ${variant}`,context:['won-sticky-atc','won-variant-picker','won-breadcrumbs','won-stock-signal','won-product-meta','won-product-trust','won-product-offer','won-price-per-unit'].includes(type)||(['won-nutrition-table','won-param-table'].includes(type)&&over.source==='metafield')?'product':type==='won-collection'?'collection':'page',fixture:fixture(type,over,preset),limitations:[],...extra});}
for(const [type,s]of Object.entries(schemas)){if(kinds[type]==='sections'&&!s.presets)continue;if(kinds[type]==='sections')s.presets.forEach(p=>add(type,`preset: ${tr(p.name)}`,{},p));else add(type,'default');}
const variants={
 'won-band':{media_position:['left','right','center_gutter','background'],media_type:['none','video']},
 'won-carousel':{layout:['grid'],columns_mobile:['1','1.2','2'],arrow_style:['pill','soft','square','minimal']},
 'won-grid':{item_style:['plain','card','bordered'],article_layout:['featured']},
 'won-panels':{row_style:['plain','editorial','boxed'],icon_style:['plus','chevron'],split_position:['end']},
 'won-slide':{visualization:['standard','testimonial','expert'],media_position:['top','left','right','background'],card_style:['minimal','bordered','elevated'],headline_annotation:['underline','circle'],media_type:['none','video']},
 'won-feature':{presentation:['standard','numbered','statistic'],image_position:['top','left','below'],icon_style:['disc','bare']},
 'won-panel':{row_style:['plain','editorial','boxed']},
 'won-tile':{label_position:['overlay','below'],badge_position:['top_left','top_right','bottom_left','bottom_right'],badge_style:['accent','dark','light']},
 'won-delivery-note':{appearance:['card','plain']},
 'won-video':{video_type:['hosted','external'],aspect_ratio:['16/9','4/3','1/1']},
 'won-sticky-atc':{bar_style:['compact','minimal','center','corner']},
 'won-variant-picker':{layout:['axes','packs'],option1_style:['buttons','swatches','dropdown']},
 'won-announcement-bar':{display:['single']},
 'won-media-compare':{aspect_ratio:['16/9','1/1','4/5']},
 'won-shoppable-image':{card_aspect:['square','portrait']},
 'won-product-card':{aspect:['square','landscape']},
 'won-nutrition-table':{source:['metafield']},'won-param-table':{source:['metafield']}
};
for(const[type,fields]of Object.entries(variants))for(const[key,values]of Object.entries(fields))for(const value of values){const over={[key]:value};if(type==='won-band'&&key==='media_position')over.media_type='image';if(type==='won-feature')Object.assign(over,{number_label:'01',statistic_value:'75%',icon:'check',...(key==='icon_style'?{image:''}:{})});if(type==='won-panels'&&key==='split_position')Object.assign(over,{layout:'split',show_side_media:true});if(type==='won-grid'&&key==='article_layout')over.source='articles';if(type==='won-tile'&&key==='badge_position'&&value==='bottom_left')over.heading='A longer category label that needs several lines while keeping the bottom badge readable';if(type==='won-video'&&value==='external')over.video_url='https://www.youtube.com/watch?v=_9VUPq3SxOc';add(type,`${key}=${value}`,over);}
add('won-slide','missing image',{visualization:'testimonial',image:'',image_asset:''},null,{limitations:['Explicit missing-image state']});
add('won-tile','missing image/content',{image:'',image_asset:'',collection:'',heading:''},null,{limitations:['Explicit missing-content state']});
add('won-group','nested independent scheme',{inherit_color_scheme:false,color_scheme:'scheme-2',columns_desktop:2});
add('won-carousel','collection grid mobile snap',{source:'collection',layout:'grid',mobile_carousel:true,columns_mobile:'1.2',show_dots:true});
add('won-panels','multiple open editorial',{allow_multiple:true,row_style:'editorial'});
add('won-variant-picker','table quantity PPU',{show_table:true,show_quantity:true,show_price_per_unit:true,ppu_rules:''});
add('won-slide','standard light child in dark parent',{visualization:'standard',inherit_color_scheme:false,color_scheme:'scheme-1'},null,{parentSettings:{color_scheme:'scheme-5',bg_color:'#18243b',text_color:'#ffffff'}});
add('won-media-compare','identical images alignment',{before_image:photo,after_image:photo});
const inactiveSections=Object.entries(schemas).filter(([t,s])=>kinds[t]==='sections'&&!s.presets).map(([t])=>t);
const pdp=JSON.parse(readFileSync(path.join(root,'themes/demo/horizon/templates/product.json'))).sections.main;
const manifest=[];const templates=[];mkdirSync(out,{recursive:true});
function emit(group,context,index){const view=`won-qa-${context}-${index}`;const sections={};const order=[];if(context==='product'){sections.main=clone(pdp);order.push('main');}
 for(const c of group){const labelId=c.id+'label';sections[labelId]=node('won-page-header',{heading:`<p>QA ${c.id}: ${c.label}</p>`,subheading:'<p>Demonstration content — visual audit fixture, not customer claims.</p>',heading_size_desktop:24,heading_size_mobile:20,min_height:0,padding_top:24,padding_bottom:8,image:''});order.push(labelId);
 const sectionId=c.id;let f=c.fixture;if(kinds[c.type]==='blocks'){f=node('won-grid',{heading:'',columns_desktop:1,...c.parentSettings},[f]);}
 sections[sectionId]=f;order.push(sectionId);const url=(context==='product'?'/products/'+product:context==='collection'?'/collections/'+collection:'/pages/contact')+'?view='+view;
 const {fixture,...meta}=c;manifest.push({...meta,url,sectionId,selector:`[id^="shopify-section-"][id$="__${sectionId}"]`,template:`${context}.${view}.json`});}
 const filename=`${context}.${view}.json`;writeFileSync(path.join(out,filename),JSON.stringify({sections,order},null,2)+'\n');templates.push(filename);
}
let n=0;for(const context of ['page','collection']){const list=cases.filter(c=>c.context===context);for(let i=0;i<list.length;i+=12)emit(list.slice(i,i+12),context,++n);}
// One sticky/picker per PDP avoids duplicate floating bars and independently selectable forms.
const productCases=cases.filter(c=>c.context==='product');const standalone=productCases.filter(c=>['won-sticky-atc','won-variant-picker'].includes(c.type));const blocks=productCases.filter(c=>!standalone.includes(c));for(const c of standalone)emit([c], 'product',++n);if(blocks.length)emit(blocks,'product',++n);
// Preserve the optional editorial composition while adding real media and clear QA labels.
const editorial=JSON.parse(readFileSync(path.join(base,'examples/product.editorial.json')));
function hydrate(n){if(!n||typeof n!=='object')return; if(n.type?.startsWith('won-')){n.settings||={};for(const field of schemas[n.type]?.settings||[])if(field.type==='image_picker')n.settings[field.id]=n.type==='won-feature'?'':n.type==='won-slide'?photo:img;if('review_rating'in n.settings)n.settings.review_rating=0;if('emit_schema'in n.settings)n.settings.emit_schema=false;if('emit_faq_schema'in n.settings)n.settings.emit_faq_schema=false;if(n.settings.card_style==='plain')n.settings.card_style='minimal';if(n.type==='won-slide'){n.settings.reviewer='QA fictional example';n.settings.media_caption='QA demonstration image';}if(n.type==='won-feature')n.settings.text='<p>QA demonstration only. A longer explanation tests line wrapping, readable spacing and the balance beside the adjacent portrait.</p>'; } for(const b of Object.values(n.blocks||{}))hydrate(b);}
const editorialOrder=[];for(const [sectionId,section]of Object.entries(editorial.sections)){hydrate(section);const labelId=sectionId+'_label';editorial.sections[labelId]=node('won-page-header',{heading:`<p>QA editorial · ${sectionId}</p>`,subheading:'<p>Demonstration composition and fictional example copy — not product claims.</p>',image:'',min_height:0,padding_top:24,padding_bottom:8});editorialOrder.push(labelId,sectionId);manifest.push({id:'qa'+String(++seq).padStart(3,'0'),type:section.type,label:`Editorial composition · ${sectionId}`,variant:'editorial real media',context:'product',url:'/products/'+product+'?view=won-qa-editorial',sectionId,selector:`[id^="shopify-section-"][id$="__${sectionId}"]`,template:'product.won-qa-editorial.json',limitations:[]});}editorial.order=editorialOrder;writeFileSync(path.join(out,'product.won-qa-editorial.json'),JSON.stringify(editorial,null,2)+'\n');templates.push('product.won-qa-editorial.json');
// Append follow-up cases after editorial ids so earlier evidence ids stay stable.
const beforeFollowups=cases.length;
add('won-hero-carousel','mobile peek 1.15',{layout:'peek',columns_mobile:'1.15',autoplay:false});
add('won-carousel','loop always',{loop:'always',autoplay:false});
add('won-carousel','loop mobile',{loop:'mobile',autoplay:false});
add('won-carousel','autoplay on',{autoplay:true,autoplay_interval:2,loop:'always'});
add('won-carousel','autoplay off',{autoplay:false,loop:''});
add('won-sticky-atc','mobile device scope',{device_scope:'mobile',bar_style:'compact'});
add('won-sticky-atc','desktop device scope',{device_scope:'desktop',bar_style:'compact'});
add('won-video','external Vimeo sample',{video_type:'external',video_url:'https://vimeo.com/76979871'});
add('won-slide','elevated light child in dark parent',{visualization:'standard',card_style:'elevated',inherit_color_scheme:false,color_scheme:'scheme-1'},null,{parentSettings:{color_scheme:'scheme-5',bg_color:'#18243b',text_color:'#ffffff'}});
const followups=cases.slice(beforeFollowups);emit(followups.filter(c=>c.context==='page'),'page',28);let followupProductPage=29;for(const c of followups.filter(c=>c.context==='product'))emit([c],'product',followupProductPage++);
// Remediation capabilities appended without renumbering established audit evidence.
const remediationStart=cases.length;
for(const ratio of ['1:1','2:3','3:2'])add('won-group','column ratio '+ratio,{columns_desktop:2,column_ratio:ratio});
add('won-product-card','row single variant',{layout:'row',product:'the-inventory-not-tracked-snowboard'});
add('won-product-card','row multi variant',{layout:'row',product});
add('won-product-card','row soldout',{layout:'row',product:'the-out-of-stock-snowboard'});
add('won-video','portrait contain external',{video_type:'external',video_url:'https://www.youtube.com/watch?v=_9VUPq3SxOc',aspect_ratio:'9/16',fit:'contain'});
add('won-video','portrait cover external',{video_type:'external',video_url:'https://vimeo.com/76979871',aspect_ratio:'9/16',fit:'cover'});
add('won-video','adaptive external',{video_type:'external',video_url:'https://www.youtube.com/watch?v=_9VUPq3SxOc',aspect_ratio:'adaptive'});
emit(cases.slice(remediationStart),'page',31);
for(const c of manifest){if(c.type==='won-app-slot')c.limitations.push('No installed app block supplied: CTA shell only');if(c.type==='won-video'||c.variant.includes('media_type=video'))c.limitations.push('Hosted video resource unavailable; external embed availability requires network verification');if(c.variant.includes('metafield'))c.limitations.push('Existing product metafield availability not established');if(c.type==='won-grid'&&c.variant.toLowerCase().includes('article'))c.limitations.push('Requires existing news blog articles');}
const inventory=Object.entries(schemas).filter(([t,s])=>kinds[t]==='blocks'||s.presets).map(([type,s])=>({type,kind:kinds[type],presets:s.presets?.map(p=>tr(p.name)),visualSettings:s.settings.filter(x=>['select','radio','checkbox'].includes(x.type)).map(x=>({id:x.id,default:x.default,options:x.options?.map(o=>o.value)}))}));
writeFileSync(path.join(here,'manifest.json'),JSON.stringify({generatedBy:'generate.mjs',store:'b2b-b2c-store-development.myshopify.com',inactiveSections,counts:{cases:manifest.length,templates:templates.length,activeSections:21,activeBlocks:20},templates,inventory,cases:manifest},null,2)+'\n');
console.log(JSON.stringify({cases:manifest.length,templates:templates.length}));
