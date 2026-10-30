// Umístění na webu (balík E): every Won element and every place it can show, module by module, on one page. One
// row a place, ONE main button: "Přidat na web" where the theme takes an app block, "Připravit zadání pro AI" where
// it does not (the cart drawer, a card that takes no block). Where a block goes, the code way is a quiet "Chci to
// jinde". The guide under a row: copy the brief (with the theme's own file), open the file, check — and the line
// for a developer ("Udělám to sám"). Reached from the sidebar: Slevy → the strip's last item. The words "blok", "značka", "embed", "Liquid" stay out of the page (zadání §11).

import { useState } from "react";
import { useFetcher } from "react-router";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { PIECES, PLACEMENTS_FIELD, PLACEMENTS_INTENT, pieceTone, type PieceKey, type PieceRow, type PlacementModule, type PlacementsResult, type PlacementsScreenData } from "../model/placements";
import { tagDef, tagLine } from "../model/theme-brief";
import { codeEditorUrl, type KnownShow, type ScannedTag } from "../model/theme-scan";
import { PageGuide } from "../shell/PageGuide";
import { NotePill, PlacementPill, RowNote, WonRow, WonSection, type SectionGlyphName } from "../shell/WonSection";
import { DiscountsSubNav } from "../shell/SubNav";
import { WON_FONT, WON_INK, WON_LINE, WON_WASH } from "../shell/tokens";

export type PlacementsScreenProps = PlacementsScreenData;

const MODULES: readonly { module: PlacementModule; title: MessageKey; glyph: SectionGlyphName }[] = [
  { module: "tiers", title: "nav.tiers", glyph: "layers" },
  { module: "rewards", title: "nav.rewards", glyph: "target" },
  { module: "outlet", title: "nav.outlet", glyph: "tag" },
  { module: "campaigns", title: "nav.campaigns", glyph: "calendar" },
];

const PRE = { margin: 0, padding: 10, border: `1px solid ${WON_LINE}`, borderRadius: 8, background: WON_WASH, fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 220, overflow: "auto" } as const;

function where(tag: ScannedTag): { file: string; line: number } {
  return { file: tag.file, line: tag.line };
}

function StatePill({ row }: { row: PieceRow }) {
  const { t } = useT();
  if (row.cause?.kind === "embed_off") return <NotePill tone="attention" label={t("webPlaces.state.off")} marker="embed_off" />;
  if (row.state.at === "tag_copy") return <NotePill tone="warning" label={t("webPlaces.state.copy")} marker="tag_copy" />;
  const tone = pieceTone(row);
  return <PlacementPill placement={tone === "attention" ? "missing" : tone} />;
}

/** The sentences of a row: where it is, why it is empty, why the code way. */
function RowNotes({ row, unknownTheme }: { row: PieceRow; unknownTheme: boolean }) {
  const { t } = useT();
  const notes: { key: string; text: string; attention?: boolean }[] = [];
  if (row.state.at === "tag_live") notes.push({ key: "live", text: t("webPlaces.tagLive", where(row.state.tags[0]!)) });
  if (row.state.at === "auto") notes.push({ key: "auto", text: t("webPlaces.auto", { theme: row.state.theme === "horizon" ? "Horizon" : "Dawn", position: t(row.state.position === "top" ? "webPlaces.auto.top" : "webPlaces.auto.summary") }) });
  if (row.state.at === "missing" && row.state.off) notes.push({ key: "off", text: t("webPlaces.autoOff"), attention: true });
  if (row.state.at === "tag_copy") notes.push({ key: "copy", text: t("webPlaces.tagCopy", { theme: row.state.theme, file: row.state.tags[0]!.file }), attention: true });
  if (row.cause?.kind === "embed_off") notes.push({ key: "embed", text: t(row.cause.draft ? "webPlaces.embedDraft" : "webPlaces.embedOff"), attention: true });
  if (row.cause?.kind === "nothing") notes.push({ key: "nothing", text: t(`webPlaces.nothing.${row.cause.why}`) });
  const absent = row.state.at === "missing" || row.state.at === "unknown";
  if (absent && row.way === "tag") notes.push({ key: "why", text: t(row.place === "drawer" ? "webPlaces.why.drawer" : "webPlaces.why.card") });
  if (absent && row.way === "block" && row.key === "cardTier") notes.push({ key: "card", text: t(unknownTheme ? "webPlaces.why.unknown" : "webPlaces.card.block") });
  return (
    <>
      {notes.map((note) => (
        <RowNote key={note.key} tone={note.attention ? "attention" : undefined}>
          {note.text}
        </RowNote>
      ))}
    </>
  );
}

function Guide({ row, show, file, themeId, shop }: { row: PieceRow; show: KnownShow; file: string | null; themeId: string | null; shop: string }) {
  const { t } = useT();
  const [tab, setTab] = useState<"ai" | "self">("ai");
  const brief = useFetcher<PlacementsResult>();
  const check = useFetcher<PlacementsResult>();
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  const got = brief.data && brief.data.ok && brief.data.kind === "brief" && brief.data.piece === row.key ? brief.data : null;
  const copy = () => {
    if (!got || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopied("failed");
      return;
    }
    navigator.clipboard.writeText(got.brief).then(
      () => setCopied("done"),
      () => setCopied("failed"),
    );
  };
  const fileUrl = themeId ? codeEditorUrl(shop, themeId, file) : null;
  const themesUrl = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop) ? `https://${shop}/admin/themes` : null;
  const def = tagDef(show);
  const tab$ = (key: "ai" | "self", label: MessageKey) => (
    <s-button variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)} data-won-guide-tab={key}>
      {t(label)}
    </s-button>
  );
  return (
    <div data-won-guide={row.key} style={{ marginTop: 10, padding: 12, border: `1px solid ${WON_LINE}`, borderRadius: 10, fontFamily: WON_FONT, color: WON_INK }}>
      <s-stack direction="block" gap="base">
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>
          {tab$("ai", "webPlaces.guide.ai")}
          {tab$("self", "webPlaces.guide.self")}
        </span>
        {tab === "ai" ? (
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{t("webPlaces.guide.step1")}</s-text>
              <RowNote>{file ? t("webPlaces.guide.step1.file", { file }) : t("webPlaces.guide.step1.noFile")}</RowNote>
              {got ? (
                <>
                  {!got.read && got.file ? <RowNote tone="attention">{t("webPlaces.guide.notRead")}</RowNote> : null}
                  <pre data-won-brief={row.key} style={PRE}>
                    {got.brief}
                  </pre>
                  <div>
                    <s-button variant="primary" onClick={copy}>
                      {copied === "done" ? `${t("webPlaces.guide.copied")} ✓` : t("webPlaces.guide.copy")}
                    </s-button>
                  </div>
                  {copied === "failed" ? <RowNote tone="attention">{t("webPlaces.guide.copyFailed")}</RowNote> : null}
                </>
              ) : (
                <div>
                  <s-button
                    variant="primary"
                    loading={brief.state !== "idle" ? true : undefined}
                    onClick={() => brief.submit({ [PLACEMENTS_FIELD.intent]: PLACEMENTS_INTENT.brief, [PLACEMENTS_FIELD.piece]: row.key }, { method: "post" })}
                  >
                    {t("webPlaces.guide.prepare")}
                  </s-button>
                </div>
              )}
            </s-stack>
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{t("webPlaces.guide.step2")}</s-text>
              <RowNote>{t("webPlaces.guide.step2.text")}</RowNote>
              <RowNote>{t("webPlaces.guide.step2.safe")}</RowNote>
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>
                {fileUrl ? (
                  <s-button href={fileUrl} target="_blank" variant="secondary">
                    {t("webPlaces.guide.openFile")}
                  </s-button>
                ) : null}
                {themesUrl ? (
                  <s-button href={themesUrl} target="_blank" variant="tertiary">
                    {t("webPlaces.guide.openThemes")}
                  </s-button>
                ) : null}
              </span>
            </s-stack>
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{t("webPlaces.guide.step3")}</s-text>
              <RowNote>{t("webPlaces.guide.step3.text")}</RowNote>
              <div>
                <s-button variant="secondary" loading={check.state !== "idle" ? true : undefined} onClick={() => check.submit({ [PLACEMENTS_FIELD.intent]: PLACEMENTS_INTENT.check }, { method: "post" })}>
                  {t("placement.recheck")}
                </s-button>
              </div>
              {check.data && check.data.ok && check.state === "idle" ? <RowNote>{t("webPlaces.checked")}</RowNote> : null}
            </s-stack>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="small-300">
            <RowNote>{file ? t("webPlaces.self.file", { file }) : t("webPlaces.self.noFile")}</RowNote>
            <pre data-won-tag-line={row.key} style={PRE}>
              {tagLine(show, row.place, file)}
            </pre>
            {def.attrs.length ? <RowNote>{t("webPlaces.self.attrs", { list: def.attrs.map((a) => (a.values ? `${a.name}: ${a.values.join(" | ")}` : a.name)).join(" · ") })}</RowNote> : null}
            <RowNote>{t("webPlaces.self.note")}</RowNote>
          </s-stack>
        )}
      </s-stack>
    </div>
  );
}

function PieceRowView({ row, page, open, toggle }: { row: PieceRow; page: PlacementsScreenProps; open: boolean; toggle: () => void }) {
  const { t } = useT();
  const links = page.links[row.key];
  const there = row.state.at === "in_theme" || row.state.at === "tag_live";
  const buttons: JSX.Element[] = [];
  if (row.cause?.kind === "embed_off" && page.embed.activateUrl) {
    buttons.push(
      <s-button key="embed" href={page.embed.activateUrl} target="_top" variant="primary">
        {t("rewards.cart.activate")}
      </s-button>,
    );
  } else if (row.way === "auto" && row.state.at !== "tag_live") {
    // The drawer of Horizon / Dawn: its place is the Won embed's setting in the theme editor.
    const off = row.state.at === "missing";
    if (page.embed.activateUrl)
      buttons.push(
        <s-button key="auto" href={page.embed.activateUrl} target="_top" variant={off ? "primary" : "secondary"} data-won-drawer-setting="">
          {t(off ? "webPlaces.autoOn" : "webPlaces.autoMove")}
        </s-button>,
      );
  } else if (row.way === "block" && row.state.at !== "tag_live") {
    const href = row.state.at === "in_theme" ? (links?.open ?? links?.add) : links?.add;
    if (href)
      buttons.push(
        <s-button key="block" href={href} target="_top" variant={there ? "secondary" : "primary"}>
          {t(there ? "placement.open" : "placement.add")}
        </s-button>,
      );
  } else if (row.show) {
    buttons.push(
      <s-button key="guide" onClick={toggle} variant={there ? "secondary" : "primary"} data-won-guide-open={row.key}>
        {t(open ? "webPlaces.hide" : there ? "webPlaces.howTo" : "webPlaces.brief")}
      </s-button>,
    );
  }
  // The code way where a block goes: there, but quiet (zadání §11, varianta a).
  const elsewhere = (row.way === "block" || row.way === "auto") && row.show && row.state.at !== "tag_live";
  return (
    <WonRow tone={pieceTone(row) === "missing" || row.cause?.kind === "embed_off" ? "attention" : undefined} action={buttons.length ? <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>{buttons}</span> : undefined}>
      <div data-won-piece={row.key} data-won-piece-state={row.state.at} data-won-piece-way={row.way}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: WON_FONT, fontSize: 13.5, fontWeight: 700, color: WON_INK }}>{t(`webPlaces.piece.${row.key}` as MessageKey)}</span>
          <StatePill row={row} />
        </div>
        <RowNotes row={row} unknownTheme={page.scan.state !== "ok"} />
        {elsewhere ? (
          <div style={{ marginTop: 4 }}>
            <s-button variant="tertiary" onClick={toggle} data-won-elsewhere={row.key}>
              {t(open ? "webPlaces.hide" : "webPlaces.elsewhere")}
            </s-button>
          </div>
        ) : null}
        {open && row.show ? <Guide row={row} show={row.show} file={page.files[row.place] ?? null} themeId={page.scan.theme?.id ?? null} shop={page.shop} /> : null}
      </div>
    </WonRow>
  );
}

export function PlacementsScreen(props: PlacementsScreenProps) {
  const { t } = useT();
  const [open, setOpen] = useState<PieceKey | null>(null);
  const check = useFetcher<PlacementsResult>();
  const theme = props.scan.theme;
  return (
    <s-page heading={t("webPlaces.title")}>
      <DiscountsSubNav active="placements" />
      <PageGuide page="placements" />
      <s-stack direction="block" gap="base">
        <WonSection
          title={theme ? t("webPlaces.theme", { theme: theme.name }) : t("webPlaces.title")}
          glyph="store"
          summary={t("webPlaces.intro")}
          action={
            <s-button variant="secondary" loading={check.state !== "idle" ? true : undefined} onClick={() => check.submit({ [PLACEMENTS_FIELD.intent]: PLACEMENTS_INTENT.check }, { method: "post" })} data-won-recheck="">
              {t("placement.recheck")}
            </s-button>
          }
        >
          <s-stack direction="block" gap="small-300">
            {props.scan.state === "no_scope" ? <RowNote tone="attention">{t("webPlaces.theme.noScope")}</RowNote> : null}
            {props.scan.state === "unknown" ? <RowNote tone="attention">{t("webPlaces.theme.unknown")}</RowNote> : null}
            {theme && !theme.complete ? <RowNote tone="attention">{t("webPlaces.theme.incomplete")}</RowNote> : null}
            {props.scan.copies.length ? <RowNote>{t("webPlaces.copies", { names: props.scan.copies.map((c) => `„${c.name}“`).join(", ") })}</RowNote> : null}
            {props.syncing ? <RowNote>{t("webPlaces.syncing")}</RowNote> : null}
            {check.data && check.data.ok && check.state === "idle" ? <RowNote>{t("webPlaces.checked")}</RowNote> : null}
          </s-stack>
        </WonSection>
        {MODULES.map(({ module, title, glyph }) => {
          const rows = props.rows.filter((row) => row.module === module);
          return (
            <WonSection key={module} title={t(title)} glyph={glyph} anchor={`web-${module}`}>
              <div data-won-placements-module={module}>
                {rows.map((row) => (
                  <PieceRowView key={row.key} row={row} page={props} open={open === row.key} toggle={() => setOpen(open === row.key ? null : row.key)} />
                ))}
              </div>
            </WonSection>
          );
        })}
        {props.other.length ? (
          <WonSection title={t("webPlaces.other.title")} glyph="code" anchor="web-other">
            <div data-won-placements-other="">
              {props.other.map((tag) => {
                const known = PIECES.some((p) => p.show === tag.show);
                return (
                  <WonRow key={`${tag.file}:${tag.line}`} tone={known ? undefined : "attention"}>
                    <RowNote tone={known ? undefined : "attention"}>
                      {known ? t("webPlaces.other.known", { name: t(`webPlaces.show.${tag.show}` as MessageKey), file: tag.file, line: tag.line }) : t("webPlaces.other.unknown", { show: tag.show, file: tag.file, line: tag.line })}
                    </RowNote>
                  </WonRow>
                );
              })}
            </div>
          </WonSection>
        ) : null}
      </s-stack>
    </s-page>
  );
}
