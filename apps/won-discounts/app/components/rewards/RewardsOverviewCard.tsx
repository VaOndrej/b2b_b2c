// Přehled card "Odměny za košík" (MVP 4, A3 status first): free shipping and
// the gift thresholds the PLAN runs (§17c), in the shop currency, one line
// each; a threshold without a value in that currency says so (MKT-1).
// `rewards` absent = not known: the card is not rendered (§12).

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import type { RewardsOverviewView } from "../model/types";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function RewardsOverviewCard({ rewards }: { rewards: RewardsOverviewView }) {
  const tr = useT();
  const { t } = tr;
  const money = (minor: number) => formatMoney(minor, rewards.currency, tr.locale);
  const has = rewards.shipping !== null || rewards.gifts.length > 0;
  const lines: string[] = [];
  if (rewards.shipping !== null) lines.push(t("overview.rewards.ship", { amount: money(rewards.shipping) }));
  for (const g of rewards.gifts) lines.push(g === null ? t("overview.rewards.giftNoCurrency", { currency: rewards.currency }) : t("overview.rewards.gift", { amount: money(g) }));
  return (
    <WonSection title={t("module.rewards")} glyph="spark" on={has} summary={has ? lines[0] : t("overview.rewards.none")} anchor="rewards">
      <div>
        {lines.slice(1).map((line) => (
          <WonRow key={line}>
            <RowNote>{line}</RowNote>
          </WonRow>
        ))}
        <WonRow
          action={
            <s-button href="/app/rewards" variant="secondary">
              {t(has ? "overview.rewards.edit" : "overview.rewards.setup")}
            </s-button>
          }
        >
          {null}
        </WonRow>
      </div>
    </WonSection>
  );
}
