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
//   4. Košík na webu — the app embed (the cart panel needs it), the cart block,
//      the honest sentences (a code entered only at checkout keeps the gift).
// One save for the whole form; the server parses the same fields (readRewardsForm, SEC-1).

import { useState } from "react";
import { Form, useSubmit } from "react-router";

import { useT } from "../../i18n/context";
import { pickProducts } from "../model/app-bridge";
import { currencyCodes } from "../model/markets";
import { amountInput, missingCurrencies, newGiftTierId, REWARDS_FIELD, REWARDS_INTENT } from "../model/rewards";
import type { GiftTierView, GiftVariantView, RewardsScreenData, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { GateNotes } from "../shell/GateNotes";
import { Notice } from "../shell/Notice";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

const F = REWARDS_FIELD;

export interface RewardsScreenProps extends RewardsScreenData {
  result?: UiResult | null;
}

function errorText(result: UiResult | null | undefined, field: string, t: ReturnType<typeof useT>["t"]): string | undefined {
  if (!result || result.ok || result.reason !== "invalid") return undefined;
  const e = result.errors?.find((x) => x.field === field);
  return e ? t(e.key, e.params) : undefined;
}

/** Variants picked in Shopify's picker → gift views ("Product — Variant"). */
async function pickGifts(selected: readonly GiftVariantView[], max: number): Promise<GiftVariantView[] | null> {
  const picked = await pickProducts([]);
  if (!picked.ok) return null;
  const out: GiftVariantView[] = [];
  for (const p of picked.items) {
    const variants = p.variants.length > 0 ? p.variants : [];
    for (const v of variants) {
      const title = v.title && v.title !== "Default Title" ? `${p.title} — ${v.title}` : p.title;
      if (!out.some((x) => x.id === v.id)) out.push({ id: v.id, title });
    }
  }
  const merged = [...selected.filter((s) => !out.some((o) => o.id === s.id)), ...out];
  return merged.slice(-max);
}

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
  const codes = currencyCodes(currencies);
  const pro = plan === "pro";
  const [shipOn, setShipOn] = useState(shipping !== null);
  // The first tier is edited on every plan; on Free the rest are kept as stored (hidden fields).
  const [tiers, setTiers] = useState<GiftTierView[]>(pro ? gifts : gifts.slice(0, 1));
  const kept = pro ? [] : gifts.slice(1);
  const [pickError, setPickError] = useState(false);
  const submit = useSubmit();
  const err = (field: string) => errorText(result, field, t);
  const marketsOf = (code: string) => currencies.find((c) => c.code === code)?.markets.map((m) => m.name).join(", ") || code;

  const update = (id: string, patch: Partial<GiftTierView>) => setTiers((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const choose = async (tier: GiftTierView, which: "choices" | "fallback") => {
    const max = which === "fallback" ? 1 : pro ? 3 : 1;
    const picked = await pickGifts(which === "fallback" ? [] : tier.choices, max);
    setPickError(picked === null);
    if (!picked) return;
    if (which === "fallback") update(tier.id, { fallback: picked[0] ?? null });
    else update(tier.id, { choices: picked });
  };

  const replaceUnreadable = () => {
    const form = document.querySelector<HTMLFormElement>("form[data-won-rewards]");
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

  return (
    <s-page heading={t("module.rewards")}>
      <Form method="post" data-save-bar data-won-rewards>
        <input type="hidden" name={F.intent} value={REWARDS_INTENT.save} />
        {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
        <s-stack direction="block" gap="base">
          <Notice result={result} onReplace={replaceUnreadable} />
          <GateNotes notes={gateNotes} />

          <WonSection title={t("rewards.ship.title")} glyph="receipt" on={shipOn} summary={t(shipOn ? "rewards.ship.summaryOn" : "rewards.ship.summaryOff")} hint={t("rewards.ship.hint")}>
            <s-stack direction="block" gap="base">
              <s-switch name={F.shipOn} value="1" label={t("rewards.ship.on")} checked={boolAttr(shipOn)} onChange={(e: Event) => setShipOn((e.currentTarget as HTMLInputElement).checked)} />
              {shipOn ? amountFields(F.shipAmount, shipping) : null}
              {shipOn
                ? missingCurrencies(shipping, codes).map((c) => (
                    <RowNote key={c} tone="attention">
                      {t("rewards.missingCurrency", { currency: c, markets: marketsOf(c) })}
                    </RowNote>
                  ))
                : null}
            </s-stack>
          </WonSection>

          <WonSection
            title={t("rewards.gift.title")}
            glyph="spark"
            on={tiers.length > 0}
            summary={tiers.length === 0 ? t("rewards.gift.summaryNone") : tr.tp("rewards.gift.summary", tiers.length)}
            hint={t("rewards.gift.hint")}
          >
            <s-stack direction="block" gap="base">
              {tiers.map((tier, i) => (
                <s-box key={tier.id} padding="base" border="base" borderRadius="base">
                  <input type="hidden" name={F.tier} value={tier.id} />
                  {tier.choices.map((c) => (
                    <input key={c.id} type="hidden" name={F.choice(tier.id)} value={c.id} />
                  ))}
                  {tier.fallback ? <input type="hidden" name={F.fallback(tier.id)} value={tier.fallback.id} /> : null}
                  <s-stack direction="block" gap="small-300">
                    <s-heading>{tiers.length > 1 ? t("rewards.gift.tierN", { n: i + 1 }) : t("rewards.gift.threshold")}</s-heading>
                    {amountFields((c) => F.tierAmount(tier.id, c), tier.threshold)}
                    {missingCurrencies(tier.threshold, codes).map((c) => (
                      <RowNote key={c} tone="attention">
                        {t("rewards.missingCurrency", { currency: c, markets: marketsOf(c) })}
                      </RowNote>
                    ))}
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
                    <RowNote>{err(F.choice(tier.id)) ?? t("rewards.gift.stockHint")}</RowNote>
                    <s-text>{t("rewards.gift.fallback")}</s-text>
                    {tier.fallback ? (
                      <GiftList items={[tier.fallback]} removeLabel={t("rewards.gift.removeChoice")} unknown={t("rewards.gift.unknown")} onRemove={() => update(tier.id, { fallback: null })} />
                    ) : null}
                    <div>
                      <s-button variant="tertiary" onClick={() => void choose(tier, "fallback")}>
                        {t("rewards.gift.pickFallback")}
                      </s-button>
                    </div>
                    {pro || tiers.length > 1 ? (
                      <div>
                        <s-button variant="tertiary" tone="critical" onClick={() => setTiers((list) => list.filter((x) => x.id !== tier.id))}>
                          {t("rewards.gift.remove")}
                        </s-button>
                      </div>
                    ) : null}
                  </s-stack>
                </s-box>
              ))}
              {kept.map((tier) => (
                <div key={tier.id}>
                  <input type="hidden" name={F.tier} value={tier.id} />
                  <input type="hidden" name={F.kept} value={tier.id} />
                  <RowNote tone="attention">{t("rewards.gift.kept", { gifts: tier.choices.map((c) => c.title || t("rewards.gift.unknown")).join(", ") })}</RowNote>
                </div>
              ))}
              {pickError ? <RowNote tone="attention">{t("rewards.picker.unavailable")}</RowNote> : null}
              {tiers.length === 0 || pro ? (
                <div>
                  <s-button
                    variant="secondary"
                    onClick={() => setTiers((list) => [...list, { id: newGiftTierId(), threshold: {}, choices: [], fallback: null }])}
                  >
                    {t(tiers.length === 0 ? "rewards.gift.add" : "rewards.gift.addTier")}
                  </s-button>
                </div>
              ) : (
                <RowNote>{t("rewards.gift.ladderPro")}</RowNote>
              )}
            </s-stack>
          </WonSection>

          <WonSection title={t("rewards.count.title")} glyph="sliders" summary={t(countOther ? "rewards.count.on" : "rewards.count.off")}>
            <s-stack direction="block" gap="small-300">
              <s-switch name={F.other} value="1" label={t("rewards.count.label")} checked={boolAttr(countOther)} />
              <RowNote>{t("rewards.count.explain")}</RowNote>
            </s-stack>
          </WonSection>

          <WonSection title={t("rewards.cart.title")} glyph="cart" summary={t(embed.state === "on" ? "rewards.cart.on" : "rewards.cart.off")}>
            <s-stack direction="block" gap="small-300">
              {embed.state !== "on" && embed.activateUrl ? (
                <WonRow
                  tone="attention"
                  action={
                    <s-button href={embed.activateUrl} target="_top" variant="primary">
                      {t("rewards.cart.activate")}
                    </s-button>
                  }
                >
                  <RowNote tone="attention">{t("rewards.cart.embedNeeded")}</RowNote>
                </WonRow>
              ) : null}
              {cartBlockAddUrl ? (
                <WonRow
                  action={
                    <s-button href={cartBlockAddUrl} target="_top" variant="secondary">
                      {t("rewards.cart.addBlock")}
                    </s-button>
                  }
                >
                  <RowNote>{t("rewards.cart.blockHint")}</RowNote>
                </WonRow>
              ) : null}
              <RowNote>{t("rewards.honest.checkout")}</RowNote>
              <RowNote>{t("rewards.honest.code")}</RowNote>
            </s-stack>
          </WonSection>

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
