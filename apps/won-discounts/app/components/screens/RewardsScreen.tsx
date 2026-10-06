// Odměny za košík (MVP 4) — the module screen. "Utrať X, dostaneš Y":
//   1. Doprava zdarma — on/off and the threshold in every market currency (MKT-1:
//      a market without one does not offer it, the screen names it);
//   2. Dárek zdarma — the threshold per currency and the gift (a real product
//      variant from the store, picked in Shopify's resource picker), the fallback
//      gift when it is sold out (A4); Pro (amber, §16): more thresholds (a ladder)
//      and a choice of up to 3 gifts. On Free the thresholds past the first stay
//      as stored and say they do not apply (gate notes, BILL-1);
//   3. Počítání prahu — countOtherDiscounts with what it really does (the cart
//      warns, checkout never takes a gift that was in the cart);
//   4. Košík na webu — the app embed (the cart panel needs it; every state of the check has its own sentence
//      and its fix), the cart block, the honest sentences (a code entered only at checkout keeps the gift).
// One save for the whole form; the server parses the same fields (readRewardsForm, SEC-1).
//
// The page follows its form (P5): the switches, the amounts and the state lines are re-read from the form on
// native input / change (React 18 never fires `onChange` on an `s-*` element — B2), the gifts are picked at the
// variant level with the current ones preselected (B6, components/rewards/gift-picker.ts), and "Zahodit" in the
// save bar puts back the stored gifts, thresholds and switches (B12). A state pill is never green from what is
// only typed: off says "Vypnuto", anything else has no pill (this page has no sync facts).

import { StorefrontPlacements } from "../StorefrontPlacements";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { currencyCodes } from "../model/markets";
import { amountInput, giftSummary, liveMissingCurrencies, liveThreshold, newGiftTierId, REWARDS_FIELD, REWARDS_INTENT, shippingSummary } from "../model/rewards";
import type { EmbedState, GiftTierView, GiftVariantView, RewardsScreenData, UiResult } from "../model/types";
import type { MessageKey } from "../../i18n";
import { pickGiftVariants } from "../rewards/gift-picker";
import { FieldMessage, Shown } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { GateNotes } from "../shell/GateNotes";
import { Notice } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { DiscountsSubNav } from "../shell/SubNav";
import { embedPlacement, placementOf } from "../model/embed";
import { PlacementPill, RowNote, WonRow, WonSection } from "../shell/WonSection";

const F = REWARDS_FIELD;

export interface RewardsScreenProps extends RewardsScreenData {
  result?: UiResult | null;
}

function errorText(result: UiResult | null | undefined, field: string, t: ReturnType<typeof useT>["t"]): string | undefined {
  if (!result || result.ok || result.reason !== "invalid") return undefined;
  const e = result.errors?.find((x) => x.field === field);
  return e ? t(e.key, e.params) : undefined;
}

/** The last read value of every field (the first one of a name). */
function snapshotOf(form: HTMLFormElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of new FormData(form).entries()) if (!out.has(name) && typeof value === "string") out.set(name, value);
  return out;
}

/** The app embed's state → its sentence (the section's state line), what to do about it, and the one action. */
const EMBED_COPY: Readonly<Record<Exclude<EmbedState, "on">, { summary: MessageKey; fix: MessageKey; action: MessageKey; primary: boolean }>> = {
  off: { summary: "rewards.cart.off", fix: "rewards.cart.embedNeeded", action: "rewards.cart.activate", primary: true },
  draft_only: { summary: "rewards.cart.draftOnly", fix: "rewards.cart.draftOnlyFix", action: "rewards.cart.activate", primary: true },
  unknown: { summary: "rewards.cart.unknown", fix: "rewards.cart.checkFix", action: "rewards.cart.check", primary: false },
  no_scope: { summary: "rewards.cart.noScope", fix: "rewards.cart.checkFix", action: "rewards.cart.check", primary: false },
};

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

export function RewardsScreen(props: RewardsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const { plan, configVersion, currencies, shipping, gifts, countOther, gateNotes, embed, cartBlockAddUrl, result } = props;
  const codes = useMemo(() => currencyCodes(currencies), [currencies]);
  const pro = plan === "pro";
  // The first tier is edited on every plan; on Free the rest are kept as stored (hidden fields).
  const storedTiers = useMemo(() => (pro ? gifts : gifts.slice(0, 1)), [pro, gifts]);
  const [tiers, setTiers] = useState<GiftTierView[]>(storedTiers);
  const kept = pro ? [] : gifts.slice(1);
  const [pickError, setPickError] = useState(false);
  const submit = useSubmit();
  const err = (field: string) => errorText(result, field, t);
  const marketsOf = (code: string) => currencies.find((c) => c.code === code)?.markets.map((m) => m.name).join(", ") || code;

  // §2 / B2: the live form. null = not read yet (the server render, before the first event): what is stored.
  const formRef = useRef<HTMLFormElement>(null);
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
  const shipOn = snapshot ? snapshot.get(F.shipOn) === "1" : shipping !== null;
  const countOtherNow = snapshot ? snapshot.get(F.other) === "1" : countOther;

  // A gift picked, a threshold added or removed: React changes hidden fields, which fire no event of their own —
  // tell the form once it has rendered (the live draft re-reads; the save bar sees a changed form).
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) return;
    touched.current = false;
    formRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [tiers]);
  const change = (next: (list: GiftTierView[]) => GiftTierView[]) => {
    touched.current = true;
    setTiers(next);
  };

  // B12: "Zahodit" in the save bar resets the form — remount the fields with what is stored (gifts, thresholds, switches).
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onReset = () => {
      setFormKey((k) => k + 1);
      setTiers(storedTiers);
      setSnapshot(null);
      setPickError(false);
    };
    el.addEventListener("reset", onReset);
    return () => el.removeEventListener("reset", onReset);
  }, [storedTiers]);

  const update = (id: string, patch: Partial<GiftTierView>) => change((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const choose = async (tier: GiftTierView, which: "choices" | "fallback") => {
    // The picker opens on the current gift(s) and holds the limit itself; what it returns is the new selection (B6).
    const max = which === "fallback" ? 1 : pro ? CONFIG_LIMITS.giftChoices : 1;
    const current = which === "fallback" ? (tier.fallback ? [tier.fallback.id] : []) : tier.choices.map((c) => c.id);
    const picked = await pickGiftVariants(current, max);
    setPickError(!picked.ok && picked.reason === "unavailable");
    if (!picked.ok) return;
    if (which === "fallback") update(tier.id, { fallback: picked.items[0] ?? null });
    else update(tier.id, { choices: picked.items });
  };

  const replaceUnreadable = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set("replaceUnreadable", "1");
    submit(data, { method: "post" });
  };

  const amountFields = (field: (c: string) => string, initial: Record<string, number> | null) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {codes.map((code) => (
        <s-number-field
          key={code}
          name={field(code)}
          label={t("rewards.amount", { currency: code })}
          value={amountInput(initial, code)}
          min={0}
          suffix={code}
          inputMode="decimal"
          error={err(field(code))}
        />
      ))}
    </div>
  );
  // MKT-1 notes follow the fields: a currency whose field is empty NOW.
  const missingNotes = (field: (c: string) => string, stored: Record<string, number> | null) =>
    liveMissingCurrencies((c) => typed(field(c)), stored, codes).map((c) => (
      <RowNote key={c} tone="attention">
        {t("rewards.missingCurrency", { currency: c, markets: marketsOf(c) })}
      </RowNote>
    ));

  // The state lines, from what the form holds now.
  const shipSummary = shippingSummary(shipOn, liveThreshold((c) => typed(F.shipAmount(c)), shipping, codes), codes, tr);
  const giftLine = giftSummary(
    tiers.map((tier) => ({ threshold: liveThreshold((c) => typed(F.tierAmount(tier.id, c)), tier.threshold, codes), choices: tier.choices })),
    codes,
    tr,
  );
  const maxTiers = CONFIG_LIMITS.giftTiers;
  const tiersFull = tiers.length + kept.length >= maxTiers;
  const embedCopy = embed.state === "on" ? null : EMBED_COPY[embed.state];
  const cartBlock = placementOf(props.placed?.cartBlock);

  return (
    <s-page heading={t("module.rewards")}>
      <DiscountsSubNav active="rewards" />
      <Form method="post" ref={formRef} data-save-bar data-won-rewards>
        <input type="hidden" name={F.intent} value={REWARDS_INTENT.save} />
        {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
        <s-stack key={formKey} direction="block" gap="base">
          <Notice result={result} onReplace={replaceUnreadable} />
          <GateNotes notes={gateNotes} />

          <WonSection title={t("rewards.ship.title")} glyph="receipt" state={props.status?.shipping} summary={shipSummary} hint={t("rewards.ship.hint")} anchor="shipping">
            <s-stack direction="block" gap="base">
              {/* `checked` is what is STORED; the live state is read from the form (never React's onChange on an s-* element). */}
              <s-switch name={F.shipOn} value="1" label={t("rewards.ship.on")} checked={boolAttr(shipping !== null)} />
              {/* Hidden, never unmounted: an amount typed before the switch was flipped is not lost. The server ignores it while off. */}
              <Shown when={shipOn}>
                <s-stack direction="block" gap="small-200">
                  {amountFields(F.shipAmount, shipping)}
                  {missingNotes(F.shipAmount, shipping)}
                </s-stack>
              </Shown>
            </s-stack>
          </WonSection>

          <WonSection title={t("rewards.gift.title")} glyph="spark" state={props.status?.gift} summary={giftLine} hint={t("rewards.gift.hint")} anchor="gift">
            <s-stack direction="block" gap="base">
              {tiers.map((tier, i) => {
                const choiceError = err(F.choice(tier.id));
                return (
                  <s-box key={tier.id} padding="base" border="base" borderRadius="base">
                    <input type="hidden" name={F.tier} value={tier.id} />
                    {tier.choices.map((c) => (
                      <input key={c.id} type="hidden" name={F.choice(tier.id)} value={c.id} />
                    ))}
                    {tier.fallback ? <input type="hidden" name={F.fallback(tier.id)} value={tier.fallback.id} /> : null}
                    <s-stack direction="block" gap="small-300">
                      <s-heading>{tiers.length > 1 ? t("rewards.gift.tierN", { n: i + 1 }) : t("rewards.gift.threshold")}</s-heading>
                      {amountFields((c) => F.tierAmount(tier.id, c), tier.threshold)}
                      {missingNotes((c) => F.tierAmount(tier.id, c), tier.threshold)}
                      <s-text>{t(pro ? "rewards.gift.choicesPro" : "rewards.gift.choice")}</s-text>
                      <GiftList
                        items={tier.choices}
                        removeLabel={t("rewards.gift.removeChoice")}
                        unknown={t("rewards.gift.unknown")}
                        onRemove={(id) => update(tier.id, { choices: tier.choices.filter((c) => c.id !== id) })}
                      />
                      <div>
                        <s-button variant="secondary" onClick={() => void choose(tier, "choices")}>
                          {t(tier.choices.length > 0 ? "rewards.gift.change" : "rewards.gift.pick")}
                        </s-button>
                      </div>
                      {/* P3: a threshold without a gift cannot be saved — marked here, before the save. */}
                      {tier.choices.length === 0 ? (
                        <RowNote tone="attention">{t("rewards.error.giftChoice")}</RowNote>
                      ) : choiceError ? (
                        <RowNote tone="attention">{choiceError}</RowNote>
                      ) : (
                        <RowNote>{t("rewards.gift.stockHint")}</RowNote>
                      )}
                      <s-text>{t("rewards.gift.fallback")}</s-text>
                      {tier.fallback ? (
                        <GiftList items={[tier.fallback]} removeLabel={t("rewards.gift.removeChoice")} unknown={t("rewards.gift.unknown")} onRemove={() => update(tier.id, { fallback: null })} />
                      ) : null}
                      <div>
                        <s-button variant="tertiary" onClick={() => void choose(tier, "fallback")}>
                          {t(tier.fallback ? "rewards.gift.changeFallback" : "rewards.gift.pickFallback")}
                        </s-button>
                      </div>
                      {pro || tiers.length > 1 ? (
                        <div>
                          <s-button variant="tertiary" tone="critical" onClick={() => change((list) => list.filter((x) => x.id !== tier.id))}>
                            {t("rewards.gift.remove")}
                          </s-button>
                        </div>
                      ) : null}
                    </s-stack>
                  </s-box>
                );
              })}
              {kept.map((tier) => (
                // A stored Pro threshold the Free plan does not run: the plan signal is amber only (doctrine §16b).
                <ProFrame key={tier.id} locked>
                  <input type="hidden" name={F.tier} value={tier.id} />
                  <input type="hidden" name={F.kept} value={tier.id} />
                  <RowNote>{t("rewards.gift.kept", { gifts: tier.choices.map((c) => c.title || t("rewards.gift.unknown")).join(", ") })}</RowNote>
                </ProFrame>
              ))}
              {pickError ? <RowNote tone="attention">{t("rewards.picker.unavailable")}</RowNote> : null}
              <FieldMessage text={err(F.tier)} />
              {tiers.length === 0 || pro ? (
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-button
                    variant="secondary"
                    disabled={boolAttr(tiersFull)}
                    onClick={() => change((list) => (list.length + kept.length >= maxTiers ? list : [...list, { id: newGiftTierId(), threshold: {}, choices: [], fallback: null }]))}
                  >
                    {t(tiers.length === 0 ? "rewards.gift.add" : "rewards.gift.addTier")}
                  </s-button>
                  {tiersFull ? <s-text color="subdued">{t("rewards.gift.limit", { max: maxTiers })}</s-text> : null}
                </s-stack>
              ) : (
                <ProSell benefit={t("rewards.gift.ladderPro")} />
              )}
            </s-stack>
          </WonSection>

          <WonSection title={t("rewards.count.title")} glyph="sliders" summary={t(countOtherNow ? "rewards.count.on" : "rewards.count.off")} anchor="count">
            <s-stack direction="block" gap="small-300">
              <s-switch name={F.other} value="1" label={t("rewards.count.label")} checked={boolAttr(countOther)} />
              <RowNote>{t("rewards.count.explain")}</RowNote>
            </s-stack>
          </WonSection>

          <WonSection
            title={t("rewards.cart.title")}
            glyph="cart"
            summary={t(embedCopy ? embedCopy.summary : "rewards.cart.on")}
            anchor="cart"
            // Bod 5: Won in the theme — the label, and the fix in the header when it is not there.
            placement={embedPlacement(embed.state)}
            action={
              embedCopy && embed.activateUrl ? (
                <s-button href={embed.activateUrl} target="_top" variant={embedCopy.primary ? "primary" : "secondary"}>
                  {t(embedCopy.action)}
                </s-button>
              ) : undefined
            }
          >
            <s-stack direction="block" gap="small-300">
              {embedCopy ? (
                // Every state of the check has its own sentence (the header) and what to do about it (this row).
                <WonRow tone={embedCopy.primary ? "attention" : undefined}>
                  <RowNote tone={embedCopy.primary ? "attention" : undefined}>{t(embed.activateUrl ? embedCopy.fix : "rewards.cart.noLink")}</RowNote>
                </WonRow>
              ) : null}
              {cartBlockAddUrl ? (
                <WonRow
                  tone={cartBlock === "missing" ? "attention" : undefined}
                  action={
                    <s-button href={cartBlockAddUrl} target="_top" variant={cartBlock === "missing" ? "primary" : "secondary"}>
                      {t(cartBlock === "in_theme" ? "placement.open" : "placement.add")}
                    </s-button>
                  }
                >
                  <PlacementPill placement={cartBlock} />
                  <RowNote>{t("rewards.cart.blockHint")}</RowNote>
                </WonRow>
              ) : null}
              <RowNote>{t("rewards.honest.checkout")}</RowNote>
              <RowNote>{t("rewards.honest.code")}</RowNote>
            </s-stack>
          </WonSection>

          {/* Feedback 2, bod 5: the progress to free shipping and to the gift outside the cart — a block for any page, and the strip at the top. */}
          {props.placements ? (
            <WonSection title={t("rewards.places.title")} glyph="store" summary={t("rewards.places.summary")} anchor="places">
              <StorefrontPlacements
                links={props.placements}
                placed={props.placed}
                rows={[
                  { place: "product", key: "rewardsProduct", text: "rewards.places.product" },
                  { place: "home", key: "rewardsHome", text: "rewards.places.home" },
                  { place: "topBar", key: "topBarRewards", text: "rewards.places.topBar", action: "placements.openEmbed" },
                ]}
              />
            </WonSection>
          ) : null}

          <div>
            <s-button type="submit" variant="primary">
              {t("common.save")}
            </s-button>
          </div>
        </s-stack>
      </Form>
    </s-page>
  );
}
