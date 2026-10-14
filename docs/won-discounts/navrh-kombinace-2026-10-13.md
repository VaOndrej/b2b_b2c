# Návrh: kombinování slev podle typů a výjimek (13. 10. 2026)

Stav: návrh schválený Ondřejem 13. 10. 2026, nic z toho není postavené.

## Rozhodnuto s Ondřejem

1. U každé slevy je seznam typů slev, se kterými se sčítá (všechny tarify).
2. Výjimka na konkrétní slevu je Pro a umí jen povolit.
3. Sečtou se jen slevy, které to dovolují obě. Když se neshodnou, appka to hned ukáže jako věc k vyřešení.
4. Seznam má šest typů, jak je zná obchodník.
5. Množstevní slevy, Milníky a Výprodej mají stejný seznam na své stránce. Čtyři přepínače v Nastavení zmizí, místo nich je výchozí seznam pro nové slevy.

## Typy

| Typ | Co do něj patří |
|---|---|
| Automatické slevy | sleva z editoru bez kódu, na produkty i na objednávku |
| Slevové kódy | sleva z editoru s kódem, na produkty i na objednávku |
| Doprava zdarma | sleva z editoru s hodnotou „doprava zdarma“ (s kódem i bez) a doprava zdarma z Milníků |
| Množstevní slevy | všechny sady hladin |
| Milníky | dárek a sleva za milník |
| Výprodej | běžící výprodeje |

Sleva z editoru má vždy právě jeden typ. Doprava zdarma má přednost před tím, jestli je s kódem.

## Pravidlo na pokladně

Pro dvě slevy A a B:

- „A dovoluje B“ platí, když má A zaškrtnutý typ slevy B, nebo má A na slevu B výjimku (Pro).
- A a B se sečtou, jen když A dovoluje B a zároveň B dovoluje A.
- Jinak zákazník dostane tu výhodnější z nich. To je dnešní chování „lepší vyhrává“.

Stejné pravidlo platí pro dvě slevy na stejné položce i pro slevu na produkt, na objednávku a na dopravu mezi sebou. Dnešní dělení na „stejný druh“ a „různé druhy“ tím končí.

Co zůstává: nejvýš 6 nejvýhodnějších slev v jednom součtu, ochrana marže nad výsledkem, pořadí při shodě (částka, priorita, id).

Co se mění v engine: množstevní sleva se dnes nikdy nesčítá se slevou na stejné položce. Nově se sečte, když to obě strany dovolí.

## Neshoda

Neshoda je dvojice, kde jedna strana druhou dovoluje a druhá ne. Na pokladně se nesčítají (bezpečná strana), v adminu je to nález:

- nový druh nálezu v Kontrole kombinací (vedle `not_combinable`), jeden nález na slevu, ne na dvojici: „Sleva X dovoluje sčítání s kódy, ale kódy A, B, C s ní sčítání nedovolují.“;
- červená tečka u sekce „Kombinace a trhy“ v editoru a u slevy v seznamu;
- tlačítka „Povolit i u druhé strany“ a „Zakázat i tady“, která neshodu srovnají jedním uložením.

Neshoda se počítá z konfigurace, ne z košíků, takže je vidět hned po uložení.

## Obrazovky

**Editor slevy → Kombinace a trhy**

- „Sčítá se s“: šest zaškrtávátek typů. Nová sleva je má předvyplněná z Nastavení.
- „Výjimky“ (Pro, zlatý rámeček jako trhy): seznam konkrétních slev a kódů typů, které jsou odškrtnuté. Zaškrtnutá = sčítá se i přes zákaz typu. V nižším tarifu je vidět zamčeně.
- Stavová věta sekce říká typy slovy: „sčítá se s automatickými slevami a dopravou zdarma · výjimka: NEWSLETTER“.

**Množstevní slevy, Milníky, Výprodej**: stejná sekce „Sčítá se s“, jedna za modul. Bez výjimek (výjimku na modul nastaví sleva u sebe).

**Nastavení → Kombinování slev**: výchozí seznam pro nové slevy místo čtyř přepínačů. Stávající slevy nemění.

## Data

- `rule.combine = { types: CombineType[], rules?: string[] }` nahrazuje `rule.combinesWith`. `rules` jsou výjimky.
- `modules.tiers.combine`, `modules.rewards.combine`, `modules.outlet.combine`: jen `types`.
- `engine.combination` (čtyři přepínače) nahrazuje `engine.combineDefault: CombineType[]`.
- Verze schématu se zvedne, sanitizer starý tvar převede.

## Převod stávajících obchodů

Cíl: po převodu žádný zákazník nedostane víc než před ním.

- Dnešní přepínače jsou po třídách (produkt, objednávka, doprava), nové typy po druhu slevy. Přesně se převést nedají vždy. Kde to nejde, převod zvolí přísnější variantu (nesčítat).
- Dnešní „Sčítá se s“ (konkrétní slevy) se stane výjimkami. V nižším tarifu je brána odebere, takže se tam ty dvojice přestanou sčítat.
- Po převodu appka jednou ukáže, co se změnilo: „Tyto dvojice se dřív sčítaly a teď ne“, s odkazem na slevu.

Před nasazením: test, který na fixturách a na konfiguraci dev obchodu porovná plán před a po převodu a vypíše každý rozdíl.

## Tarify

V kódu jsou dnes dva tarify: Free (zdarma) a Pro za 29 USD měsíčně (`app/lib/billing.server.ts`). Ondřej 13. 10. počítá s placeným nižším tarifem za 9 USD; to je samostatné rozhodnutí o ceníku a tenhle návrh na něm nezávisí. „Nižší tarif“ níže znamená ten pod Pro, ať se jmenuje jakkoli.

- Typy jsou ve všech tarifech.
- Výjimky jsou Pro. Brána je v nižším tarifu odebere, zákazník dostane nejvýš méně.

## Co do toho nepatří

- Nativní slevy Shopify mimo Won Discounts. Ty pokladna kombinuje sama podle svých tříd.
- Výjimka, která zakazuje.
- Jemnější typy (zvlášť na produkty a na objednávku).

## Otevřené

1. Výchozí seznam pro obchod, který Nastavení nikdy neotevřel: navrhuji to, co odpovídá dnešním výchozím přepínačům.
2. Ceník: zůstává nižší tarif zdarma, nebo bude za 9 USD (viz Tarify).

Uzavřeno 13. 10.: dnešní „Sčítá se s“ konkrétními slevami se stane výjimkami jen v Pro; v nižším tarifu se ty dvojice přestanou sčítat (Ondřej: ano).

## Upřesnění při stavbě (13. 10., schváleno 14. 10.)

Rozhodnuto 14. 10. (Ondřej):
- Body 1–10 a 14–16 schválené, jak jsou.
- Milníky (doprava zdarma, dárek, sleva na objednávku) se ve výchozím stavu sčítají se všemi slevami a nastavuje se to přímo na stránce Milníků. Výchozí seznam Milníků to splňuje už teď; výprodej ve výchozím stavu nebere nic, to je jeho strana.
- Body 11 a 13 se netýkají nikoho: appku zatím nepoužívá žádný obchod, jen vývojový obchod. Převod zůstává, jednorázové hlášení ztracených dvojic se nestaví.
- Ceník: rozhodne později.
- Brána instrukcí 9,9 M zůstává, hledat úsporu.

Návrh říká pravidlo jednou větou. Tohle jsem musel při stavbě doplnit, aby šlo spočítat každý košík. Každý bod jde změnit.

1. **Sleva na dopravu je typ „Doprava zdarma“ vždy**, i když je to třeba 50 % z dopravy, ne jen hodnota „doprava zdarma“.
2. **Sleva za milník je typ Milníky a řídí se seznamem Milníků**, vlastní seznam nemá. Doprava zdarma z Milníků je typ Doprava zdarma, ale taky se řídí seznamem Milníků.
3. **Odměny Milníků mezi sebou** (dárek, doprava, sleva) se sčítají, když má seznam Milníků zaškrtnuté „Milníky“. Dvě slevy za milník se nesčítají nikdy (vyšší krok nahrazuje nižší).
4. **Dvě slevy na dopravu se nesčítají nikdy**, vyhrává jedna.
5. **Sleva na objednávku vedle slev na položkách.** Vedle nich jde jen sleva na objednávku, která se sčítá se všemi slevami, co košík na položkách dostal. Když taková není, porovná se „slevy na položkách“ proti „jen sleva na objednávku“ a zákazník dostane to výhodnější. Je to dnešní chování přepínače, jen po dvojicích.
6. **Doprava a dárek se neporovnávají, jen přidávají.** Hodnotu dopravy funkce nezná. Doprava (i dárek) platí, jen když se sčítá se vším, co košík už dostal. Jinak neplatí a v adminu je vidět proč.
7. **Výprodej.** Seznam Výprodeje se týká slev z ceny položky: automatické, kódy, množstevní, sleva za milník. Doprava zdarma a dárek platí u zboží ve výprodeji vždy, jako dnes. Výprodej s vlastním seznamem (ten u jednoho výprodeje) se řídí dál jen tím svým.
8. **Zaškrtávátka, která nic neznamenají, se neukazují:** vlastní typ u dopravy, množstevních slev a výprodeje; výprodej u slevy na dopravu.
9. **Výchozí stav nového obchodu:** slevy z ceny (automatické, kódy, množstevní) se mezi sebou nesčítají, doprava zdarma a Milníky se přičítají ke všemu, výprodej nebere nic. Nová sleva na dopravu dostane zrcadlový seznam, aby hned nevznikla neshoda.
10. **Převod.** Každý typ slev dostane jeden seznam. Typ je zaškrtnutý, jen když se dnes sčítají všechny dvojice slev, kterých se to týká. Dvojice, které se tím přestanou sčítat, appka vypíše. Dnešní „Sčítá se s“ se stane výjimkou na obou slevách.
11. **Co převod stojí:** když má obchod slevu za milník a zároveň automatickou slevu na objednávku, vypadne ze seznamu Milníků „Automatické slevy“ a s nimi i dárek. Jinak by se sleva za milník začala sčítat s jinou slevou na objednávku, což dnes nedělá.
12. **Sleva za milník ve výchozím stavu.** Seznam Milníků má ve výchozím stavu zaškrtnuté automatické slevy i kódy (kvůli dárku a dopravě zdarma). Sleva za milník má tentýž seznam, takže se v novém obchodě sčítá s jinou slevou na objednávku. Dnes vyhrává lepší z nich. Kdo to nechce, odškrtne typ u Milníků, ale pak se s ním nesčítá ani dárek.
13. **Množstevní sleva a sleva na objednávku po převodu.** Když má obchod množstevní slevy, automatickou slevu na produkt a automatickou slevu na objednávku, převod u množstevních slev „Automatické slevy“ nezaškrtne (se slevou na produkt se nesčítaly). Množstevní sleva se pak přestane sčítat i se slevou na objednávku. Appka tu dvojici vypíše.
14. **Výjimky v řádku slevy.** Řádek slevy v seznamu ukazuje jen výjimky („výjimka: NEWSLETTER“). Seznam typů je vidět v editoru, jinak by byl řádek u každé slevy dvakrát delší.
15. **Funkce v pokladně čte seznamy z jednoho textu** (`engine.cx`). Je to kvůli limitu instrukcí: každé čtení klíče z konfigurace stojí asi 1 000 instrukcí.
16. **Ochrana marže:** v jednom z 1 200 zkušebních košíků dostane zákazník o pár korun víc než dřív. Samotná sleva na objednávku tam využije prostor nad podlahou líp než dřívější součet. Pod podlahu se nedostane.

## Pořadí stavby

1. Jádro: typy, pravidlo, převod, brána, payload funkce (`packages/core`), s testem „před a po“.
2. Funkce v pokladně a velikost payloadu.
3. Editor slevy a Nastavení.
4. Stránky modulů.
5. Neshody v Kontrole kombinací, tečky, tlačítka na srovnání.
6. Živé E2E na Horizonu a Dawnu, v obou tarifech.
