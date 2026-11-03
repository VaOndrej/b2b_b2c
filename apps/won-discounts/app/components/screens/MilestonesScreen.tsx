// Milníky (feedback 6 Oct 2026, body 9 a 10) — the module screen at /app/rewards. ONE ladder of steps by the value
// of the cart; a step is an amount for every market and one reward: a free gift, free shipping, or a discount off
// the whole order. It replaces "Odměny" (free shipping and gifts as two separate sections); what was stored reads
// as steps as it is (core milestones.ts).
// The page (Ondřej, 31 Oct 2026): one sentence on what milestones are, the new step by its reward, the steps as a
// table where a row opens in place, the ladder as the customer sees it from the form as it is NOW
// (rewards/MilestonePreview), and the settings of the whole ladder.
//   Na webu  the four places the ladder shows (the top strip, the product page, the cart drawer, the cart page),
//            each with its label and its one button; opened from the settings, with the way back on top.
// One save for the whole page (the App Bridge save bar, shell/one-save.tsx); the server parses the same fields (model/milestones.ts readMilestonesForm, SEC-1).
// Limits hold PER MARKET: Free runs the 2 steps with the lowest amount in each market, Pro 6 — here and on the
// server. A step past a market's limit stays stored, visible and editable; the row says in which market it is
// not in force (§14a, §16).
//
// The page follows its form: values are re-read on native input / change (React 18 never fires `onChange` on an
// `s-*` element), a field's attributes are never changed while it is typed in, and "částka chybí" is said only
// after a go at the field, a refused save, or when the step is already stored.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";

import { CONFIG_LIMITS } from "@won/core/discounts/config";
import type { MilestoneKind } from "@won/core/discounts/milestones";
import { amountKeyCurrency } from "@won/core/discounts/money";

import type { MessageKey } from "../../i18n";
import { useT } from "../../i18n/context";
import { LookSection } from "../looks/LookSection";
import { CombinePart, combinePart } from "../shell/ModuleCombine";
import { PartRefusal, useOneSave } from "../shell/one-save";
import { useFormActions } from "../shell/form-actions";
import { splitSave } from "../model/one-save";
import { presetLabel } from "../model/looks";
import { editorOpenUrl, embedPlacement, placementOf, spotAdvice } from "../model/embed";
import { PlacementsLink, SpotNote } from "../StorefrontPlacements";
import { placementStatus } from "../model/module-status";
import { amountInput, amountsText, emptyStepView, liveAmounts, MILESTONES_INTENT, milestoneRowsMax, MS_FIELD, overLimitColumns, rewardText, stepMissingColumns } from "../model/milestones";
import { freeShippingDefaults } from "../model/rule-form";
import type { EmbedState, EmbedView, GiftVariantView, LookView, MilestoneStepView, RewardsScreenData, UiResult } from "../model/types";
import { pickGiftVariants } from "../rewards/gift-picker";
import { MilestonePreview, type PreviewStep } from "../rewards/MilestonePreview";
import { FieldMessage, Shown } from "../rule-editor/parts";
import { AmountSuggestions } from "../shell/AmountSuggestions";
import { boolAttr } from "../shell/attrs";
import { snapshotOf } from "../shell/form-snapshot";
import { GateNotes } from "../shell/GateNotes";
import { hoverMark } from "../shell/hover";
import { PickList, PlainHead, type PickIcon } from "../shell/PickList";
import { Notice } from "../shell/Notice";
import { ProSell } from "../shell/ProSell";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { DiscountsSubNav } from "../shell/SubNav";
import { WON_ATTENTION, WON_EDGE, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "../shell/tokens";
import { useView, ViewPanel } from "../shell/views";
import { usePolarisJump } from "../shell/scroll";
import { RowNote, WonRow, WonSection, type PlacementState } from "../shell/WonSection";
import { StatusBadge } from "../shell/StatusBadge";

const F = MS_FIELD;

export interface MilestonesScreenProps extends RewardsScreenData {
  result?: UiResult | null;
  /** "shipping": opened from the setup guide — a shop without a step starts with free shipping, its amounts prefilled (audit N1). */
  start?: "shipping" | null;
}

interface Row {
  /** The form key: the stored step's id, or "new-…". */
  uid: string;
  initial: MilestoneStepView;
  choices: GiftVariantView[];
  fallback: GiftVariantView | null;
  /** Stored already (a fact about the shop: its missing amounts are said at once). */
  stored: boolean;
}

/** The app embed's state → its sentence, what to do about it, and the one action (the cart drawer needs Won switched on in the store). */
const EMBED_COPY: Readonly<Record<Exclude<EmbedState, "on">, { summary: MessageKey; fix: MessageKey; action: MessageKey; primary: boolean }>> = {
  off: { summary: "rewards.cart.off", fix: "rewards.cart.embedNeeded", action: "rewards.cart.activate", primary: true },
  draft_only: { summary: "rewards.cart.draftOnly", fix: "rewards.cart.draftOnlyFix", action: "rewards.cart.activate", primary: true },
  unknown: { summary: "rewards.cart.unknown", fix: "rewards.cart.checkFix", action: "rewards.cart.check", primary: false },
  no_scope: { summary: "rewards.cart.noScope", fix: "rewards.cart.checkFix", action: "rewards.cart.check", primary: false },
};

/** The DOM id of the card of the step at a position (the row of numbers jumps to it; positions follow the live list). */
const stepAnchor = (index: number) => `step-${index + 1}`;

/** The two questions of a step's form ("1. Co zákazník dostane", "2. Od jaké hodnoty košíku"). */
const STEP_HEADING = { fontFamily: WON_FONT, fontSize: 13.5, fontWeight: 700, color: WON_INK } as const;

/** The steps as a table; on a phone the amount and the state share the line under the reward. */
const TABLE_CSS = `
.won-ms-row{box-sizing:border-box;display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr) 170px 150px;gap:4px 14px;align-items:center;padding:11px 16px}
@media (max-width:640px){.won-ms-row{grid-template-columns:minmax(0,1fr) auto}.won-ms-row__market,.won-ms-head{display:none}.won-ms-row__reward{grid-column:1/-1;grid-row:1}}
`;

/** A row of the settings: the frame around them carries no padding of its own. */
const SETTING = { paddingInline: 16 } as const;

/** The new step by its reward: the same three a step's form offers. */
const NEW_STEPS: readonly { kind: MilestoneKind; icon: PickIcon; title: MessageKey; body: MessageKey }[] = [
  { kind: "shipping", icon: "truck", title: "milestones.kind.shipping", body: "milestones.new.shipping" },
  { kind: "gift", icon: "gift", title: "milestones.kind.gift", body: "milestones.new.gift" },
  { kind: "discount", icon: "percent", title: "milestones.new.discountTitle", body: "milestones.new.discount" },
];

function errorText(result: UiResult | null | undefined, field: string, t: ReturnType<typeof useT>["t"]): string | undefined {
  if (!result || result.ok || result.reason !== "invalid") return undefined;
  const e = result.errors?.find((x) => x.field === field);
  return e ? t(e.key, e.params) : undefined;
}

const majorOf = (raw: string | undefined): number => Number((raw ?? "").trim().replace(/\s/g, "").replace(",", "."));

function GiftList({ items, onRemove, removeLabel, unknown }: { items: readonly GiftVariantView[]; onRemove: (id: string) => void; removeLabel: string; unknown: string }) {
  return (
    <s-stack direction="block" gap="small-200">
      {items.map((g) => (
        <WonRow
          key={g.id}
          action={
            <s-button variant="tertiary" onClick={() => onRemove(g.id)}>
              {removeLabel}
            </s-button>
          }
        >
          <s-text>{g.title || unknown}</s-text>
        </WonRow>
      ))}
    </s-stack>
  );
}

/**
 * The ladder's look, one place at a time (7th round, bod 3: a strip at the top cannot look like the ladder of the
 * cart page): the places as a row of buttons, under it the chosen place's look — its own form with its own Save.
 * The others stay mounted and out of sight, so what was picked or typed in one is not lost by looking at another.
 * A deep link `#look-<place>` opens that place.
 */
function PlaceLooks({ looks, plan, configVersion, embed }: { looks: readonly LookView[]; plan: "free" | "pro"; configVersion: string | null; embed?: EmbedView | null }) {
  const tr = useT();
  const { t } = tr;
  const [place, setPlace] = useState(looks[0]?.element ?? "milestones");
  useEffect(() => {
    const wanted = window.location.hash.replace(/^#look-/, "");
    if (looks.some((look) => look.element === wanted)) setPlace(wanted as LookView["element"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the address is read once, when the panel mounts
  }, []);
  if (looks.length === 1) return <LookSection look={looks[0]!} plan={plan} configVersion={configVersion} embed={embed} />;
  return (
    <s-stack direction="block" gap="base">
      <div data-won-look-places="" style={{ fontFamily: WON_FONT }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{t("milestones.look.places")}</div>
        <div style={{ marginTop: 2, marginBottom: 10, fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{t("milestones.look.intro")}</div>
        <div role="group" aria-label={t("milestones.look.places")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {looks.map((look) => {
            const on = look.element === place;
            return (
              <button
                key={look.element}
                type="button"
                data-won-look-place={look.element}
                aria-pressed={on}
                onClick={() => setPlace(look.element)}
                {...hoverMark("chip", on)}
                style={{ display: "grid", gap: 1, padding: on ? "7px 13px" : "8px 14px", borderRadius: 10, textAlign: "left", cursor: "pointer", font: "inherit", border: `${on ? 2 : 1}px solid ${on ? WON_SELECT : "#d6dbe1"}`, background: on ? "#f2f7ff" : WON_SURFACE, boxShadow: on ? "0 0 0 3px rgba(26,115,232,.12)" : "none" }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK }}>{t(`milestones.look.place.${look.element}` as "milestones.look.place.msBar")}</span>
                <span style={{ fontSize: 12, color: WON_MUTED }}>{look.presets.length > 1 ? presetLabel(look.element, look.preset, tr) : t(Object.values(look.custom).some((v) => v.trim() !== "") ? "looks.custom.summary.on" : "looks.custom.summary.off")}</span>
              </button>
            );
          })}
        </div>
      </div>
      {looks.map((look) => (
        <div key={look.element} data-won-look-panel={look.element} style={{ display: look.element === place ? "block" : "none" }}>
          <LookSection look={look} plan={plan} configVersion={configVersion} embed={look.element === "cart" ? undefined : embed} />
        </div>
      ))}
    </s-stack>
  );
}

export function MilestonesScreen(props: MilestonesScreenProps) {
  const tr = useT();
  const { t } = tr;
  const { plan, configVersion, currencies, steps, limit, limitPro, countOther, gateNotes, embed, cartBlockAddUrl, result, suggest, start = null } = props;
  const pro = plan === "pro";
  const codes = useMemo(() => currencies.map((c) => c.code), [currencies]);
  const err = (field: string) => errorText(result, field, t);
  const marketName = useCallback((code: string) => currencies.find((c) => c.code === code)?.markets.map((m) => m.name).join(", ") || amountKeyCurrency(code), [currencies]);
  const columnLabel = (code: string) => ((currencies.find((c) => c.code === code)?.markets.length ?? 0) > 0 ? `${marketName(code)} (${amountKeyCurrency(code)})` : amountKeyCurrency(code));

  // The rows: the stored ladder, in ladder order. The setup guide's first step: free shipping with the recipe's amounts.
  const storedRows = useMemo<Row[]>(() => {
    const rows: Row[] = steps.map((step) => ({ uid: step.id, initial: step, choices: step.choices, fallback: step.fallback, stored: true }));
    if (rows.length === 0 && start === "shipping") {
      const first = emptyStepView("shipping", freeShippingDefaults(codes));
      rows.push({ uid: first.id, initial: first, choices: [], fallback: null, stored: false });
    }
    return rows;
  }, [steps, start, codes]);
  const [rows, setRows] = useState<Row[]>(storedRows);
  const [pickError, setPickError] = useState(false);
  const [pickTrimmed, setPickTrimmed] = useState<{ uid: string; max: number } | null>(null);
  // The list: one step open at a time. A refused save opens the first step it is about (an error behind a closed
  // row would be a dead end, §13); the setup guide's prefilled first step starts open.
  const rowErrors = useMemo(() => {
    const fields = result && !result.ok && result.reason === "invalid" ? (result.errors ?? []).map((e) => e.field) : [];
    return new Set(storedRows.map((row) => row.uid).filter((uid) => fields.some((field) => field.includes(uid))));
  }, [result, storedRows]);
  const [openUid, setOpenUid] = useState<string | null>(() => storedRows.find((row) => rowErrors.has(row.uid) || !row.stored)?.uid ?? null);
  useEffect(() => {
    const first = [...rowErrors][0];
    if (first) setOpenUid(first);
  }, [rowErrors]);
  const submit = useSubmit();

  // §2 / B2: the live form. null = not read yet (the server render, before the first event): what is stored.
  const formRef = useRef<HTMLFormElement>(null);
  // One save for the page (shell/one-save.tsx): the steps to this route's action, then Sčítá se s to /app/combine.
  const actions = useFormActions();
  const oneSave = useOneSave({ pageKey: "rewards", formRef, result, parts: [combinePart("rewards", configVersion, actions.combine)] });
  // The form element for the parts drawn outside it (Sčítá se s under the preview).
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  useEffect(() => setFormEl(formRef.current), []);
  const [snapshot, setSnapshot] = useState<Map<string, string> | null>(null);
  const recompute = useCallback(() => {
    if (formRef.current) setSnapshot(snapshotOf(formRef.current));
  }, []);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    el.addEventListener("input", recompute);
    el.addEventListener("change", recompute);
    return () => {
      el.removeEventListener("input", recompute);
      el.removeEventListener("change", recompute);
    };
  }, [recompute]);
  const typed = (field: string): string | null => (snapshot ? (snapshot.get(field) ?? "") : null);

  // "Částka chybí" is said once the merchant has had a go at the row (a field of it was left), or a save was refused.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onLeave = (event: Event) => {
      const name = (event.target as { name?: unknown } | null)?.name;
      if (typeof name === "string" && name) setLeft((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
    };
    el.addEventListener("focusout", onLeave);
    return () => el.removeEventListener("focusout", onLeave);
  }, []);
  const refused = !!result && !result.ok;

  // "Co se počítá" sits under the preview, and the preview stays outside the form: the switch keeps a hidden field of
  // the form up to date (the same way a picked gift does).
  const [countNow, setCountNow] = useState(countOther);
  useEffect(() => setCountNow(countOther), [countOther]);
  const countRef = useRef<HTMLElementTagNameMap["s-switch"]>(null);
  const countTold = useRef(countOther);
  useEffect(() => {
    if (countTold.current === countNow) return;
    countTold.current = countNow;
    formRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [countNow]);

  // A gift picked, a step added or removed: React changes hidden fields, which fire no event of their own — tell the
  // form once it has rendered (the live draft re-reads; the save bar sees a changed form).
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) return;
    touched.current = false;
    formRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [rows]);
  const change = (next: (list: Row[]) => Row[]) => {
    touched.current = true;
    setRows(next);
  };

  // "Zahodit" in the save bar resets the form — remount the fields with what is stored.
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onReset = () => {
      setFormKey((k) => k + 1);
      setRows(storedRows);
      setCountNow(countOther);
      countTold.current = countOther;
      setSnapshot(null);
      setPickError(false);
      setOpenUid(null);
    };
    el.addEventListener("reset", onReset);
    return () => el.removeEventListener("reset", onReset);
  }, [storedRows, countOther]);
  useEffect(() => {
    const el = countRef.current;
    if (!el) return;
    const onChange = () => setCountNow(el.checked === true);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [formKey]);

  const update = (uid: string, patch: Partial<Row>) => change((list) => list.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  const choose = async (row: Row, which: "choices" | "fallback") => {
    // The picker opens on the current gift(s) and holds the limit itself; what it returns is the new selection (B6).
    const max = which === "fallback" ? 1 : pro ? CONFIG_LIMITS.giftChoices : 1;
    const current = which === "fallback" ? (row.fallback ? [row.fallback.id] : []) : row.choices.map((c) => c.id);
    const picked = await pickGiftVariants(current, max);
    setPickError(!picked.ok && picked.reason === "unavailable");
    if (!picked.ok) return;
    // More variants ticked than the limit: said at the row, never trimmed silently.
    setPickTrimmed(picked.trimmed ? { uid: row.uid, max } : null);
    if (which === "fallback") update(row.uid, { fallback: picked.items[0] ?? null });
    else update(row.uid, { choices: picked.items });
  };
  const replaceUnreadable = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData();
    for (const [name, value] of splitSave(new FormData(form).entries()).page) data.append(name, value);
    data.set("replaceUnreadable", "1");
    submit(data, { method: "post" });
  };

  // Every row as the form holds it NOW.
  const kindOf = (row: Row): MilestoneKind => {
    const raw = typed(F.kind(row.uid));
    return raw === "shipping" || raw === "gift" || raw === "discount" ? raw : row.initial.kind;
  };
  const liveRows = rows.map((row) => {
    const kind = kindOf(row);
    const valueRaw = typed(F.valueKind(row.uid));
    const value = valueRaw === "fixed" || valueRaw === "percentage" ? valueRaw : row.initial.value;
    const percentRaw = typed(F.percent(row.uid));
    const percentNow = percentRaw === null ? row.initial.percent : majorOf(percentRaw);
    const live: MilestoneStepView = {
      id: row.uid,
      kind,
      threshold: liveAmounts((c) => typed(F.amount(row.uid, c)), row.initial.threshold, codes),
      choices: row.choices,
      fallback: row.fallback,
      value,
      percent: percentNow !== null && Number.isFinite(percentNow) && percentNow >= 1 && percentNow <= 100 ? percentNow : null,
      off: liveAmounts((c) => typed(F.off(row.uid, c)), row.initial.off, codes),
    };
    return { row, live };
  });
  const open = liveRows;
  // Where a step is past the plan's limit — per market, from the form as it is now (the server's gate ranks the same way).
  const over = overLimitColumns(liveRows.map((x) => x.live), codes, limit);
  const hasShipping = (except: string) => liveRows.some((x) => x.row.uid !== except && x.live.kind === "shipping");

  // The preview and the tiles read the same live rows; a step past a market's limit is not in force there, so that market's customer does not see it.
  const previewSteps: PreviewStep[] = open.map(({ row, live }) => ({
    key: row.uid,
    threshold: live.threshold,
    reward: (column) => rewardText(live, codes, tr, column),
    offered: (column) => !(over.get(row.uid) ?? []).includes(column) && (!(live.kind === "discount" && live.value === "fixed") || typeof live.off[column] === "number"),
  }));
  const missingMarkets = [...new Set(open.flatMap(({ live }) => stepMissingColumns(live, codes)))];
  // Limits: the plan's number of steps; a gift for at most CONFIG_LIMITS.giftTiers of them.
  const maxRows = milestoneRowsMax(plan, codes.length);
  const full = rows.length >= maxRows;
  const addStep = (kind: MilestoneKind) =>
    change((list) => {
      if (list.length >= maxRows) return list;
      const next = emptyStepView(kind);
      setOpenUid(next.id);
      return [...list, { uid: next.id, initial: next, choices: [], fallback: null, stored: false }];
    });

  // "Na webu": the four places, and what is still to do there.
  const placed = props.placed ?? {};
  const embedCopy = embed.state === "on" ? null : EMBED_COPY[embed.state];
  const cartBlock = placementOf(placed.cartBlock);
  const places: { key: string; placement: PlacementState; text: MessageKey; href: string | null | undefined; action: MessageKey; primary: boolean }[] = [
    { key: "topBar", placement: placementOf(placed.topBarRewards), text: placed.topBarRewards ? "milestones.places.topBar.on" : "milestones.places.topBar", href: props.placements?.topBar, action: placed.topBarRewards ? "placement.open" : "placements.addTopBar", primary: false },
    { key: "product", placement: placementOf(placed.rewardsProduct), text: "milestones.places.product", href: placed.rewardsProduct ? (editorOpenUrl(props.placements?.product, placed.spots?.rewardsProduct) ?? props.placements?.product) : props.placements?.product, action: placed.rewardsProduct ? "placement.open" : "placement.add", primary: placed.rewardsProduct === false },
    { key: "drawer", placement: embedPlacement(embed.state), text: embedCopy ? embedCopy.fix : "milestones.places.drawer", href: embedCopy ? embed.activateUrl : null, action: embedCopy?.action ?? "rewards.cart.activate", primary: embedCopy?.primary === true },
    { key: "cart", placement: cartBlock, text: "milestones.places.cart", href: cartBlock === "in_theme" ? (editorOpenUrl(cartBlockAddUrl) ?? cartBlockAddUrl) : cartBlockAddUrl, action: cartBlock === "in_theme" ? "placement.open" : "placement.add", primary: cartBlock === "missing" },
  ];
  const webParts = [
    t(placed.topBarRewards ? "rewards.web.topBar.yes" : "rewards.web.topBar.no"),
    t(placed.rewardsProduct ? "rewards.web.product.yes" : "rewards.web.product.no"),
    t(embed.state === "on" ? "rewards.web.cart.yes" : embed.state === "off" || embed.state === "draft_only" ? "rewards.web.cart.no" : "rewards.web.cart.unknown"),
  ];
  const webLine = webParts.join(" · ").replace(/^./, (ch) => ch.toLocaleUpperCase(tr.locale));
  // The tile says what the rows under it say: a place whose row is red is counted, one in the wrong spot too; a
  // shop with no step yet has nothing to resolve on the web.
  const productMisplaced = spotAdvice(placed.spots?.rewardsProduct)?.move === true;
  const webStatus = placementStatus(embedPlacement(embed.state), {
    runs: storedRows.length > 0,
    alsoMissing: places.filter((place) => place.key !== "drawer" && place.placement === "missing").length + (productMisplaced ? 1 : 0),
  });
  const saved = !!result && result.ok;

  const [view, setView] = useView<"steps" | "web" | "look">({
    initial: () => "steps",
    // `#step-N` (Kontrola kombinací links to a step): the view with the list; the effect below opens that step.
    hash: { steps: "steps", preview: "steps", amounts: "steps", count: "steps", shipping: "steps", gift: "steps", "new-step": "steps", settings: "steps", web: "web", places: "web", cart: "web", look: "look", "look-milestones": "look", "look-msBar": "look", "look-msCart": "look", "look-msDrawer": "look", "look-cart": "look", ...Object.fromEntries(rows.map((_, i) => [stepAnchor(i), "steps" as const])) },
    resetKey: result,
  });
  const toSteps = usePolarisJump("steps", () => setView("steps"));

  useEffect(() => {
    const at = /^#step-(\d+)$/.exec(window.location.hash);
    const target = at ? storedRows[Number(at[1]) - 1] : undefined;
    if (target) setOpenUid(target.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a deep link is read once
  }, []);
  const tried = (row: Row) => row.stored || refused || codes.some((c) => left.has(F.amount(row.uid, c)) || left.has(F.off(row.uid, c)));

  return (
    <s-page heading={t("module.rewards")}>
      <DiscountsSubNav active="rewards" />
      {/* The notice and what to do next are not fields: they sit above the form. */}
      <s-stack direction="block" gap="base">
      <Notice result={result} onReplace={replaceUnreadable} />
      <PartRefusal refusal={oneSave.refusal} />
      {/* A save says what the customer sees now and what is still to do, with the button that does it. */}
      {saved ? (
        <WonSection title={t("rewards.next.title")} glyph="store" anchor="next">
          <div data-won-rewards-next>
            <WonRow>
              <RowNote>{open.length === 0 ? t("milestones.next.none") : tr.tp("milestones.next.steps", open.length)}</RowNote>
            </WonRow>
            {missingMarkets.length > 0 ? (
              <WonRow
                tone="attention"
                action={
                  <s-button {...toSteps} variant="secondary">
                    {t("milestones.next.fillAmounts")}
                  </s-button>
                }
              >
                <RowNote tone="attention">{t("milestones.next.missing", { markets: tr.list(missingMarkets.map(marketName)) })}</RowNote>
              </WonRow>
            ) : null}
            <WonRow
              tone={embed.state === "on" ? undefined : "attention"}
              action={
                embed.state !== "on" && embed.activateUrl ? (
                  <s-button href={embed.activateUrl} target="_top" variant="primary">
                    {t("rewards.cart.activate")}
                  </s-button>
                ) : undefined
              }
            >
              <RowNote tone={embed.state === "on" ? undefined : "attention"}>{t(embed.state === "on" ? "milestones.next.cart.on" : "milestones.next.cart.off")}</RowNote>
            </WonRow>
            {placed.rewardsProduct === false && props.placements?.product ? (
              <WonRow
                action={
                  <s-button href={props.placements.product} target="_top" variant="secondary">
                    {t("rewards.next.product.add")}
                  </s-button>
                }
              >
                <RowNote>{t("milestones.next.product.missing")}</RowNote>
              </WonRow>
            ) : null}
          </div>
        </WonSection>
      ) : null}

      {view === "steps" ? (
        <>
          <p data-won-ms-lead="" style={{ margin: 0, fontFamily: WON_FONT, fontSize: 14, color: WON_MUTED }}>
            {t("milestones.lead")}
          </p>
          <section>
            <PlainHead id="new-step" title={t("milestones.new.title")} sub={t("milestones.new.sub")} />
            <PickList
              items={NEW_STEPS.map((item) => {
                // Free shipping is one step at most: more of them would say the same thing twice.
                const once = item.kind === "shipping" && hasShipping("");
                return { key: item.kind, icon: item.icon, title: t(item.title), body: t(once ? "milestones.new.shippingOnce" : item.body), disabled: full || once, onPick: () => addStep(item.kind), marker: { "data-won-ms-new": item.kind } };
              })}
            />
            {full ? <div style={{ marginTop: 8 }}>{pro ? <RowNote>{t("milestones.limit.full", { max: maxRows })}</RowNote> : <ProSell benefit={t(codes.length > 1 ? "milestones.limit.proMarkets" : "milestones.limit.pro", { max: limit, pro: limitPro })} />}</div> : null}
          </section>
        </>
      ) : (
        <div>
          <s-button variant="tertiary" onClick={() => setView("steps")} data-won-ms-back="">
            {t("milestones.back")}
          </s-button>
        </div>
      )}
      </s-stack>
      <style dangerouslySetInnerHTML={{ __html: TABLE_CSS }} />
      <div style={{ marginTop: 20 }}>
      <Form method="post" ref={formRef} data-save-bar data-won-milestones onSubmit={oneSave.onSubmit}>
        <input type="hidden" name={F.intent} value={MILESTONES_INTENT.save} />
        {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
        {countNow ? <input type="hidden" name={F.other} value="1" /> : null}
        <s-stack key={formKey} direction="block" gap="base">
          <ViewPanel id="steps" view={view}>
            {/* The plan note is about the stored steps, so it sits with them. */}
            <GateNotes notes={gateNotes} />

            <div data-won-ms-steps="">
              {/* `#amounts` (older links: "doplnit částky") still lands on the list. */}
              <span id="amounts" style={{ display: "block", scrollMarginTop: 16 }} />
              <PlainHead id="steps" title={t("milestones.steps.title")} sub={pro ? tr.tp("milestones.summary.count", rows.length) : t("milestones.limit.left", { n: rows.length, max: maxRows })} />
              <s-stack direction="block" gap="base">
                {/* A row per step: from what cart value, what it gives, where, and its state. One step is open at a time; its
                    form asks in order: what the customer gets, then from what cart value in each market. A closed step's
                    fields stay mounted (hidden): they still submit (§17d). */}
                {rows.length === 0 ? (
                  <div data-won-ms-list="empty" style={{ border: `1px dashed ${WON_LINE}`, borderRadius: 12, padding: 12 }}>
                    <RowNote>{t("milestones.steps.empty")}</RowNote>
                  </div>
                ) : (
                  <div style={{ border: `1px solid ${WON_EDGE}`, borderRadius: 12, overflow: "hidden", background: WON_SURFACE, fontFamily: WON_FONT }}>
                    <div className="won-ms-row won-ms-head" style={{ paddingBlock: 7, fontSize: 12, fontWeight: 600, color: WON_MUTED, background: WON_WASH }}>
                      <div>{t("milestones.table.from")}</div>
                      <div>{t("milestones.table.reward")}</div>
                      <div>{t("milestones.table.markets")}</div>
                      <div>{t("milestones.table.state")}</div>
                    </div>
                {liveRows.map(({ row, live }, index) => {
                  const from = amountsText(live.threshold, codes, tr);
                  const isOpen = openUid === row.uid;
                  const missing = stepMissingColumns({ ...live, off: live.off }, codes).filter((c) => typeof live.threshold[c] !== "number");
                  const overHere = over.get(row.uid) ?? [];
                  const hasError = rowErrors.has(row.uid);
                  const noGift = live.kind === "gift" && row.choices.length === 0 && tried(row);
                  const problem = overHere.length > 0 || hasError || noGift || (tried(row) && missing.length > 0);
                  const moduleState = props.status?.state === "attention" ? "active" : props.status?.state;
                  const where = codes.filter((code) => typeof live.threshold[code] === "number" && !overHere.includes(code)).map(marketName);
                  const head = (
                    <button type="button" className="won-ms-row" data-won-ms-row={row.uid} aria-expanded={isOpen} {...hoverMark("line", isOpen)} onClick={() => setOpenUid(isOpen ? null : row.uid)} style={{ width: "100%", border: 0, margin: 0, font: "inherit", textAlign: "left", cursor: "pointer", background: isOpen ? "#fafbfc" : WON_SURFACE }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em", color: from ? WON_INK : WON_ATTENTION }}>{from ? t("milestones.step.titleFrom", { amount: from }) : t("milestones.list.noAmount")}</span>
                      <span className="won-ms-row__reward" style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em", color: WON_INK, overflowWrap: "anywhere" }}>{rewardText(live, codes, tr)}</span>
                      <span className="won-ms-row__market" style={{ fontSize: 13, color: WON_MUTED }}>{tr.list(where)}</span>
                      <span>{problem ? <StatusBadge state="attention" /> : !row.stored ? <StatusBadge status={{ kind: "draft" }} /> : moduleState ? <StatusBadge state={moduleState} /> : null}</span>
                    </button>
                  );
                  // A closed row still tells the truth: what is missing, what the plan does not run, what a save refused.
                  const notes = (
                    <>
                      {overHere.length > 0 ? (
                        <div data-won-ms-over={overHere.join(" ")}>
                          <RowNote>{t(codes.length > 1 ? "milestones.step.overMarket" : "milestones.step.over", { markets: tr.list(overHere.map(marketName)), max: limit, pro: limitPro })}</RowNote>
                        </div>
                      ) : null}
                      {tried(row)
                        ? missing.map((code) => (
                            <RowNote key={code} tone="attention">
                              {t("milestones.missingMarket", { market: columnLabel(code) })}
                            </RowNote>
                          ))
                        : null}
                      {!isOpen && noGift ? <RowNote tone="attention">{t("rewards.error.giftChoice")}</RowNote> : null}
                      {!isOpen && hasError ? <RowNote tone="attention">{t("milestones.list.error")}</RowNote> : null}
                    </>
                  );
                  const kind = live.kind;
                  const choiceError = err(F.choice(row.uid));
                  const offField = (code: string) => F.off(row.uid, code);
                  const offMissing = live.kind === "discount" && live.value === "fixed" ? codes.filter((c) => typeof live.threshold[c] === "number" && typeof live.off[c] !== "number") : [];
                  return (
                    <div key={row.uid} id={stepAnchor(index)} data-won-ms-step={row.uid} style={{ borderTop: `1px solid ${WON_LINE}`, background: WON_SURFACE, fontFamily: WON_FONT, scrollMarginTop: 16 }}>
                      <input type="hidden" name={F.step} value={row.uid} />
                      {row.choices.map((c) => (
                        <input key={c.id} type="hidden" name={F.choice(row.uid)} value={c.id} />
                      ))}
                      {row.fallback ? <input type="hidden" name={F.fallback(row.uid)} value={row.fallback.id} /> : null}
                      {head}
                      {problem ? <div style={{ padding: "0 16px 10px" }}>{notes}</div> : null}
                      <div data-won-ms-editor={isOpen ? "open" : "closed"} style={{ padding: "4px 16px 14px", display: isOpen ? "block" : "none" }}>
                        <s-stack direction="block" gap="small-300">
                          <SegmentedChoice
                            name={F.kind(row.uid)}
                            label={t("milestones.step.kind")}
                            defaultValue={row.initial.kind}
                            options={[
                              { value: "gift", label: t("milestones.kind.gift") },
                              // Free shipping is one step at most: more of them would say the same thing twice.
                              { value: "shipping", label: t("milestones.kind.shipping"), disabled: kind !== "shipping" && hasShipping(row.uid) },
                              { value: "discount", label: t("milestones.kind.discount") },
                            ]}
                          />
                          <FieldMessage text={err(F.kind(row.uid))} />
                          {kind !== "shipping" && hasShipping(row.uid) ? <RowNote>{t("milestones.kind.shippingOnce")}</RowNote> : null}

                          <Shown when={kind === "gift"}>
                            <s-stack direction="block" gap="small-300">
                              <s-text>{t(pro ? "rewards.gift.choicesPro" : "rewards.gift.choice")}</s-text>
                              <GiftList items={row.choices} removeLabel={t("rewards.gift.removeChoice")} unknown={t("rewards.gift.unknown")} onRemove={(id) => update(row.uid, { choices: row.choices.filter((c) => c.id !== id) })} />
                              <div>
                                <s-button variant="secondary" onClick={() => void choose(row, "choices")}>
                                  {t(row.choices.length > 0 ? "rewards.gift.change" : "rewards.gift.pick")}
                                </s-button>
                              </div>
                              {pickTrimmed?.uid === row.uid ? <RowNote tone="attention">{t("rewards.gift.trimmed", { max: pickTrimmed.max })}</RowNote> : null}
                              {/* A gift step without a gift cannot be saved — said here once there was a go at the row, or by the refused save. */}
                              {choiceError ? <RowNote tone="attention">{choiceError}</RowNote> : row.choices.length === 0 && tried(row) ? <RowNote tone="attention">{t("rewards.error.giftChoice")}</RowNote> : <RowNote>{t("rewards.gift.stockHint")}</RowNote>}
                              {/* Its own framed box with a real button (feedback 9 Oct 2026, 3rd round, bod 1): as a bare text link it was overlooked. */}
                              <div data-won-ms-fallback="" style={{ border: `1px solid ${WON_LINE}`, borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
                                <s-text type="strong">{t("rewards.gift.fallback")}</s-text>
                                {row.fallback ? <GiftList items={[row.fallback]} removeLabel={t("rewards.gift.removeChoice")} unknown={t("rewards.gift.unknown")} onRemove={() => update(row.uid, { fallback: null })} /> : null}
                                <div>
                                  <s-button variant="secondary" onClick={() => void choose(row, "fallback")}>
                                    {t(row.fallback ? "rewards.gift.changeFallback" : "rewards.gift.pickFallback")}
                                  </s-button>
                                </div>
                              </div>
                              {!pro ? <RowNote>{t("milestones.gift.choicePro")}</RowNote> : null}
                            </s-stack>
                          </Shown>

                          <Shown when={kind === "shipping"}>
                            <RowNote>{t("milestones.shipping.note")}</RowNote>
                          </Shown>

                          <Shown when={kind === "discount"}>
                            <s-stack direction="block" gap="small-300">
                              <SegmentedChoice
                                name={F.valueKind(row.uid)}
                                label={t("milestones.discount.kind")}
                                defaultValue={row.initial.value}
                                options={[
                                  { value: "percentage", label: t("milestones.discount.percent") },
                                  { value: "fixed", label: t("milestones.discount.fixed") },
                                ]}
                              />
                              <Shown when={live.value === "percentage"}>
                                <div style={{ maxWidth: 220 }}>
                                  <s-number-field name={F.percent(row.uid)} label={t("milestones.discount.percentLabel")} value={row.initial.percent !== null ? String(row.initial.percent) : ""} min={1} max={100} suffix="%" inputMode="decimal" error={err(F.percent(row.uid))} />
                                </div>
                              </Shown>
                              <Shown when={live.value === "fixed"}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))", gap: 12, alignItems: "start" }}>
                                  {codes.map((code) => (
                                    <s-number-field key={code} name={offField(code)} label={t("milestones.discount.offLabel", { market: columnLabel(code) })} value={amountInput(row.initial.off, code)} min={0} suffix={amountKeyCurrency(code)} inputMode="decimal" error={err(offField(code))} />
                                  ))}
                                </div>
                                <AmountSuggestions suggest={suggest} currencies={currencies} field={offField} initial={Object.fromEntries(codes.map((code) => [code, amountInput(row.initial.off, code)]))} />
                                {tried(row)
                                  ? offMissing.map((code) => (
                                      <RowNote key={code} tone="attention">
                                        {t("milestones.discount.offMissing", { market: columnLabel(code) })}
                                      </RowNote>
                                    ))
                                  : null}
                              </Shown>
                              {/* Where a discount step behaves differently from a gift: said at the step. */}
                              <RowNote>{t("milestones.discount.differs")}</RowNote>
                              {props.marginOn ? <RowNote>{t("milestones.discount.margin")}</RowNote> : null}
                              {!props.productWithOrder ? <RowNote>{t("milestones.discount.exclusive")}</RowNote> : null}
                            </s-stack>
                          </Shown>

                          {/* The second question: from what cart value, a field per market (an empty one = not offered there). */}
                          <div data-won-ms-amounts={row.uid} style={{ marginTop: 6, paddingTop: 12, borderTop: `1px solid ${WON_LINE}` }}>
                            <div style={STEP_HEADING}>{t("milestones.form.from")}</div>
                            <div style={{ fontFamily: WON_FONT, fontSize: 13, color: WON_MUTED, margin: "2px 0 10px" }}>{t(codes.length > 1 ? "milestones.form.fromHintMarkets" : "milestones.form.fromHint")}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))", gap: 12, alignItems: "start" }}>
                              {codes.map((code) => (
                                <s-number-field
                                  key={code}
                                  name={F.amount(row.uid, code)}
                                  label={codes.length > 1 ? columnLabel(code) : t("milestones.form.amount")}
                                  value={amountInput(row.initial.threshold, code)}
                                  min={0}
                                  suffix={amountKeyCurrency(code)}
                                  inputMode="decimal"
                                  error={err(F.amount(row.uid, code))}
                                />
                              ))}
                            </div>
                            {/* The other markets' amounts by the rate set by hand in Shopify: offered only where a field is still empty. */}
                            <AmountSuggestions suggest={suggest} currencies={currencies} field={(code) => F.amount(row.uid, code)} initial={Object.fromEntries(codes.map((code) => [code, amountInput(row.initial.threshold, code)]))} />
                          </div>
                          <div>
                            <s-button variant="tertiary" tone="critical" onClick={() => change((list) => list.filter((x) => x.uid !== row.uid))}>
                              {t("milestones.step.remove")}
                            </s-button>
                          </div>
                        </s-stack>
                      </div>
                    </div>
                  );
                })}
                  </div>
                )}

                {pickError ? <RowNote tone="attention">{t("rewards.picker.unavailable")}</RowNote> : null}
                <FieldMessage text={err(F.step)} />
              </s-stack>
            </div>
          </ViewPanel>

          <ViewPanel id="web" view={view}>
            <WonSection title={t("milestones.places.title")} glyph="store" summary={t("milestones.places.summary")} anchor="places">
              <div data-won-placements>
                {places.map((place) => (
                  <WonRow
                    key={place.key}
                    tone={place.placement === "missing" ? "attention" : undefined}
                    action={
                      place.href ? (
                        <s-button href={place.href} target="_top" variant={place.primary ? "primary" : "secondary"}>
                          {t(place.action)}
                        </s-button>
                      ) : undefined
                    }
                  >
                    <div data-won-ms-place={place.key}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: WON_FONT, fontSize: 13.5, fontWeight: 700, color: WON_INK }}>{t(`milestones.places.${place.key}.name` as MessageKey)}</span>
                        <StatusBadge placement={place.placement} move={place.key === "product" && spotAdvice(placed.spots?.rewardsProduct)?.move === true} />
                      </div>
                      {/* Every state of the check has its own sentence, and what to do about it. */}
                      {place.key === "drawer" && embedCopy ? <RowNote tone={embedCopy.primary ? "attention" : undefined}>{t(embedCopy.summary)}</RowNote> : null}
                      {place.key === "product" ? <SpotNote placement={place.placement} spot={placed.spots?.rewardsProduct} place="product" spotKey="rewardsProduct" /> : null}
                      <RowNote tone={place.key === "drawer" && embedCopy?.primary ? "attention" : undefined}>{t(place.key === "drawer" && embedCopy && !embed.activateUrl ? "rewards.cart.noLink" : place.text)}</RowNote>
                    </div>
                  </WonRow>
                ))}
              </div>
              <PlacementsLink module="rewards" />
            </WonSection>
            <WonSection title={t("milestones.honest.title")} glyph="cart" anchor="cart">
              <s-stack direction="block" gap="small-300">
                <RowNote>{t("rewards.honest.checkout")}</RowNote>
                <RowNote>{t("rewards.honest.code")}</RowNote>
              </s-stack>
            </WonSection>
          </ViewPanel>

        </s-stack>
      </Form>
      {/* The preview is a tool, not a setting (feedback 9 Oct 2026, 2nd round, bod 4): OUTSIDE the form, so walking
          the ladder with its slider never reads as an unsaved change. */}
      {view === "steps" ? (
        <aside data-won-ms-preview-aside="" style={{ marginTop: 16 }}>
          <MilestonePreview steps={previewSteps} currencies={currencies} />
        </aside>
      ) : null}
      </div>
      {view === "steps" ? (
        <section data-won-ms-settings="" style={{ marginTop: 28 }}>
          <PlainHead id="settings" title={t("milestones.settings.title")} sub={t("milestones.settings.sub")} />
          <div style={{ border: `1px solid ${WON_EDGE}`, borderRadius: 12, overflow: "hidden", background: WON_SURFACE, fontFamily: WON_FONT }}>
            <div data-won-view-tile="web" style={SETTING}>
              <div data-won-view-body="web">
                <WonRow action={<s-button variant="secondary" onClick={() => setView("web")}>{t("common.edit")}</s-button>}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: WON_INK }}>{t("milestones.settings.web")}</span>
                    {webStatus ? <StatusBadge state={webStatus.state} /> : null}
                  </div>
                  <RowNote>{webLine}</RowNote>
                  {(webStatus?.issues ?? 0) > 0 ? <RowNote tone="attention">{tr.tp("tile.issues", webStatus?.issues ?? 0)}</RowNote> : null}
                </WonRow>
              </div>
            </div>
            {props.look ? (
              <div data-won-view-tile="look" style={{ ...SETTING, borderTop: `1px solid ${WON_LINE}` }}>
                <WonRow action={<s-button variant="secondary" onClick={() => setView("look")}>{t("common.edit")}</s-button>}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: WON_INK }}>{t("milestones.view.look.title")}</div>
                  <RowNote>
                    {props.placeLooks?.length
                      ? t("milestones.view.look.places")
                      : `${presetLabel("milestones", props.look.preset, tr)} · ${t([props.look.custom.accent, props.look.custom.line, props.look.custom.tint, props.look.custom.radius, props.look.custom.css].some((v) => v.trim() !== "") ? "looks.custom.summary.on" : "milestones.view.look.custom")}`}
                  </RowNote>
                </WonRow>
              </div>
            ) : null}
            <div id="count" style={{ ...SETTING, borderTop: `1px solid ${WON_LINE}`, scrollMarginTop: 16 }}>
              <WonRow>
                <s-stack direction="block" gap="small-300">
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: WON_INK }}>{t("rewards.count.title")}</div>
                  <RowNote>{t(countNow ? "milestones.count.on" : "milestones.count.off")}</RowNote>
                  <s-switch key={formKey} ref={countRef} label={t("milestones.count.label")} checked={boolAttr(countNow)} />
                  <RowNote>{t("milestones.count.explain")}</RowNote>
                </s-stack>
              </WonRow>
            </div>
          </div>
        </section>
      ) : null}
      {/* "Sčítá se s" of every reward, under the steps (Ondřej 14 Oct 2026: set here): drawn outside the form (the preview
          above it must stay outside), saved with it by the page's one save. Hidden, never unmounted, in the other views. */}
      <div style={{ marginTop: 16, display: view === "steps" ? "block" : "none" }}>
        <CombinePart key={formKey} module="rewards" stored={props.combine} form={formEl} />
      </div>
      {/* The ladder's look: its own form, so outside the page's; under its own tile. */}
      {props.look ? (
        <div style={{ marginTop: 16 }}>
          <ViewPanel id="look" view={view}>
            <PlaceLooks looks={[...(props.placeLooks ?? []), props.look, ...(props.cartLook ? [props.cartLook] : [])]} plan={plan} configVersion={configVersion} embed={props.embed} />
          </ViewPanel>
        </div>
      ) : null}
    </s-page>
  );
}
