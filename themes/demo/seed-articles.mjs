#!/usr/bin/env node
// Seeds the demo store's `news` blog with articles so won-grid (source: articles)
// has something to render. Without them the section shows its empty state and the
// author / reading-time behaviour cannot be proven — which is what blocks hiding
// the native `featured-blog-posts` section.
//
// DEV STORE ONLY. Reads the admin token from shpat.md at the repo root and never
// prints it. Idempotent: an article whose handle already exists is skipped, so a
// re-run creates nothing.
//
//   node themes/demo/seed-articles.mjs --dry-run   # prints the plan, writes nothing
//   node themes/demo/seed-articles.mjs             # creates the missing articles
//
// Created ids are appended to themes/demo/.seeded-articles.json so the rollback
// is a plain articleDelete per id.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const STORE = 'b2b-b2c-store-development.myshopify.com';
const API = '2026-07';
const DRY = process.argv.includes('--dry-run');
const LEDGER = join(HERE, '.seeded-articles.json');

const tokenFile = join(REPO, 'shpat.md');
if (!existsSync(tokenFile)) {
  console.error('shpat.md not found at repo root — cannot authenticate.');
  process.exit(1);
}
const TOKEN = (readFileSync(tokenFile, 'utf8').match(/shpat_[A-Za-z0-9]+/) || [])[0];
if (!TOKEN) {
  console.error('No shpat_ token inside shpat.md.');
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

const p = (...paras) => paras.map((t) => `<p>${t}</p>`).join('\n');

// Three articles at deliberately different lengths, so reading time is a real
// computed value and not a constant: ~90 words (rounds up to the 1 min floor),
// ~330 words (~2 min), ~700 words (~4 min).
const ARTICLES = [
  {
    handle: 'jak-cist-etikety-doplnku',
    title: 'Jak číst etikety doplňků stravy',
    author: 'Tereza Marková',
    summary: 'Co na etiketě opravdu rozhoduje a co je jen marketing.',
    body: p(
      'Etiketa doplňku stravy vypadá na první pohled jako výčet čísel. Většina z nich ale nic neříká, dokud nevíte, co hledat. Rozhoduje složení, dávka v jedné porci a forma účinné látky.',
      'Začněte u porce. Údaje na obalu se vždy vztahují k doporučené denní dávce, ne k jedné tabletě. Když je porce tři tablety, dělte všechna čísla třemi, než začnete srovnávat s konkurencí.',
      'Druhá věc je forma. Hořčík jako oxid a hořčík jako bisglycinát nejsou totéž, i když na přední straně obalu stojí stejné číslo.',
    ),
  },
  {
    handle: 'protein-po-treninku-kdy-a-kolik',
    title: 'Protein po tréninku: kdy a kolik',
    author: 'Jan Dvořák',
    summary: 'Anabolické okno není tak úzké, jak se říkalo. Co z toho plyne pro běžný trénink.',
    body: p(
      'Představa, že po tréninku máte třicet minut na to, abyste stihli protein, patří mezi nejodolnější mýty ve fitness. Vznikla z několika studií na sportovcích, kteří trénovali nalačno, a přenesla se na všechny ostatní.',
      'Pro člověka, který během dne normálně jí, je rozhodující celkový denní příjem bílkovin, ne minuty po odložení činky. Doporučení se pohybují mezi 1,6 a 2,2 gramy na kilogram tělesné hmotnosti denně, podle objemu a intenzity tréninku.',
      'To neznamená, že načasování je úplně jedno. Rozložení příjmu do tří až pěti dávek během dne vychází v datech konzistentně lépe než dvě velké porce. Důvod je prostý: syntéza svalových bílkovin reaguje na jednotlivou dávku a po zhruba dvaceti až čtyřiceti gramech se její odpověď dál nezvyšuje.',
      'Praktický závěr je nudný, ale funguje. Dejte si porci bílkovin v rozumné době kolem tréninku, ideálně do dvou hodin, a hlavně hlídejte celkový denní příjem. Jestli to bude shake nebo jídlo, je vedlejší.',
      'Výjimkou zůstávají dvoufázové tréninky a sportovci, kteří trénují dvakrát denně s krátkou pauzou. Tam už na rychlosti doplnění záleží, protože další zátěž přijde dřív, než by běžné jídlo stihlo zafungovat.',
    ),
  },
  {
    handle: 'kreatin-co-o-nem-vime-po-tricet-letech',
    title: 'Kreatin: co o něm víme po třiceti letech výzkumu',
    author: 'MUDr. Petra Nováková',
    summary: 'Nejlépe prozkoumaný doplněk na trhu. Co se potvrdilo, co se nepotvrdilo a co pořád nevíme.',
    body: p(
      'Kreatin monohydrát je pravděpodobně nejlépe prozkoumaná látka v celém odvětví doplňků stravy. Od prvních studií z devadesátých let vzniklo přes tisíc prací a obraz, který z nich vychází, je nezvykle konzistentní.',
      'Začněme tím, co je potvrzené. Kreatin zvyšuje zásoby fosfokreatinu ve svalu, což zlepšuje výkon v krátkých opakovaných maximálních úsecích. Mluvíme o silovém tréninku, sprintech a intervalech do zhruba třiceti sekund. Efekt na vytrvalostní výkon je zanedbatelný.',
      'Dávkování je jednoduché a nudné. Tři až pět gramů denně, kdykoli během dne, dlouhodobě. Nasycovací fáze s dvaceti gramy po dobu pěti dní zásoby naplní rychleji, ale po měsíci jsou obě skupiny na stejné úrovni. Pokud nespěcháte na konkrétní závod, nasycovací fáze nemá smysl a častěji způsobuje trávicí potíže.',
      'Teď k mýtům. Kreatin nepoškozuje ledviny u zdravých lidí. Tvrzení vzniklo z toho, že zvyšuje hladinu kreatininu v krvi, což je marker, kterým se funkce ledvin běžně měří. Kreatinin ale v tomto případě stoupá proto, že ho přijímáte víc, ne proto, že by ledviny selhávaly. Dlouhodobé studie na sportovcích tuto obavu opakovaně nepotvrdily.',
      'Kreatin také nezpůsobuje dehydrataci ani křeče. Data ukazují spíš opak, protože zadržuje vodu uvnitř svalových buněk. Ten zádrž vody je zároveň důvod, proč po nasazení běžně přiberete jeden až dva kilogramy. Není to tuk a po vysazení to odejde.',
      'Forma je vyřešená otázka. Monohydrát vychází ve srovnávacích studiích stejně nebo lépe než dražší varianty typu kre-alkalyn nebo kreatin ethyl ester. Za vyšší cenu nedostanete lepší výsledek, jen jinou etiketu.',
      'Co pořád nevíme, je rozsah účinků mimo sval. Studie na kognitivní funkce vypadají zajímavě, hlavně u lidí se spánkovým deficitem a u vegetariánů, kteří mají nižší výchozí zásoby. Zatím jde ale o menší vzorky a kratší intervence, než by bylo potřeba pro pevný závěr.',
      'Podobně otevřená je otázka nonrespondérů. Zhruba dvacet až třicet procent lidí na kreatin reaguje slabě nebo vůbec, pravděpodobně proto, že už mají zásoby ve svalu blízko maxima. Spolehlivý způsob, jak to předem zjistit bez svalové biopsie, zatím neexistuje.',
      'Zajímavá je i otázka výchozích zásob podle stravy. Lidé, kteří pravidelně jedí maso a ryby, přijímají zhruba jeden až dva gramy kreatinu denně z běžné stravy. Vegetariáni a vegani se pohybují výrazně níž, a právě u nich bývá odpověď na suplementaci nejsilnější. To odpovídá logice celého mechanismu: čím dál jste od maxima, tím větší prostor k naplnění zbývá.',
      'Časté je taky nedorozumění kolem cyklování. Doporučení dělat po osmi týdnech pauzu pochází z analogie s látkami, u kterých tělo snižuje vlastní produkci při dlouhodobém přísunu. U kreatinu se tento efekt nepodařilo prokázat. Endogenní syntéza se po vysazení vrací k původním hodnotám a nic nenasvědčuje tomu, že by ji dlouhodobé užívání trvale tlumilo. Cyklování tedy nemá oporu v datech, jen zbytečně snižuje zásoby v období pauzy.',
      'Stojí za zmínku, jak vypadá kvalita důkazů ve srovnání se zbytkem trhu. U většiny doplňků se opíráme o hrstku menších studií, často financovaných výrobcem, s krátkou dobou trvání a měkkými výstupy. U kreatinu máme metaanalýzy desítek kontrolovaných pokusů, nezávislé financování a dlouhodobá bezpečnostní data na populacích od dospívajících sportovců po starší osoby. To je důvod, proč se objevuje v doporučeních odborných společností, zatímco většina ostatních látek ne.',
      'Praktické shrnutí se vejde do tří vět. Kupte monohydrát, protože dražší formy nepřinášejí lepší výsledek. Berte tři až pět gramů denně bez ohledu na čas i na to, jestli zrovna trénujete. A počítejte s tím, že první týdny přiberete na váze vodu, což je součást mechanismu, ne vedlejší efekt, kterému je potřeba se bránit.',
      'Pokud patříte mezi nonrespondéry, poznáte to zhruba po šesti týdnech podle toho, že se výkon v silových sériích nezmění nad rámec běžného kolísání. V takovém případě nemá smysl zvyšovat dávku ani střídat formy. Zásoby už jsou plné a víc jich do svalu nedostanete.',
    ),
  },
];

const BLOG_Q = `query { blogs(first: 5) { nodes { id handle } } }`;
const EXISTING_Q = `query($q: String!) { articles(first: 50, query: $q) { nodes { id handle } } }`;
const CREATE_M = `
  mutation CreateArticle($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article { id handle title author { name } }
      userErrors { code field message }
    }
  }`;

const blogs = await gql(BLOG_Q);
const blog = blogs.blogs.nodes.find((b) => b.handle === 'news');
if (!blog) {
  console.error('Blog `news` not found on the store.');
  process.exit(1);
}

const existing = await gql(EXISTING_Q, { q: 'blog_title:News' });
const taken = new Set(existing.articles.nodes.map((a) => a.handle));

console.log(`store   : ${STORE}`);
console.log(`blog    : ${blog.handle} (${blog.id})`);
console.log(`existing: ${taken.size} article(s)`);
console.log(DRY ? '\nMode: DRY RUN — nothing will be written.\n' : '\nMode: LIVE — creating articles.\n');

const created = [];
for (const a of ARTICLES) {
  const words = a.body.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
  const mins = Math.max(1, Math.floor(words / 200));
  if (taken.has(a.handle)) {
    console.log(`  skip   ${a.handle} — already exists`);
    continue;
  }
  console.log(`  create ${a.handle}  (${a.author}, ~${words} words -> ${mins} min)`);
  if (DRY) continue;

  const res = await gql(CREATE_M, {
    article: {
      blogId: blog.id,
      title: a.title,
      handle: a.handle,
      author: { name: a.author },
      body: a.body,
      summary: a.summary,
      isPublished: true,
    },
  });
  const errs = res.articleCreate.userErrors;
  if (errs.length) {
    console.error(`  ERROR  ${a.handle}:`, JSON.stringify(errs));
    process.exit(1);
  }
  created.push(res.articleCreate.article);
}

if (!DRY && created.length) {
  const prior = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : [];
  writeFileSync(LEDGER, JSON.stringify([...prior, ...created], null, 2) + '\n');
  console.log(`\nCreated ${created.length}. Ids recorded in ${LEDGER} for rollback.`);
} else if (!DRY) {
  console.log('\nNothing to create — all articles already present.');
}
