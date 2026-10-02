// Přehled card "Výprodej" (MVP 5, A3 status first): how many sales run; a sale with pieces returned after its
// end asks the merchant once, with one button each (§13: "Znovu otevřít" / "Nechat skončený", posted to
// /app/outlet, which checks the plan: Free never reopens, A6); an oversold sale or a failed step is named, the
// exact number is on the module screen. The whole module is Pro: the amber marker always (§16).
// `outlet` absent = not known: the card is not rendered (§12). Without order access (5a, F-O1) the card says the
// quota is not counted.

import { Form } from "react-router";

import { useT } from "../../i18n/context";
import { OUTLET_ACTION, OUTLET_FIELD, OUTLET_INTENT } from "../model/outlet";
import type { OutletOverviewView } from "../model/types";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function OutletOverviewCard({ outlet }: { outlet: OutletOverviewView }) {
  const tr = useT();
  const { t } = tr;
  const has = outlet.running > 0 || outlet.pendingReturns.length > 0;
  return (
    <WonSection
      title={t("module.outlet")}
      glyph="tag"
      on={outlet.running > 0}
      pro
      summary={outlet.running > 0 ? tr.tp("overview.outlet.running", outlet.running) : t("overview.outlet.none")}
      anchor="outlet"
    >
      <div>
        {!outlet.ordersCounted ? (
          <WonRow>
            <RowNote tone="attention">{t("outlet.orders.off")}</RowNote>
          </WonRow>
        ) : null}
        {outlet.pendingReturns.map((p) => (
          <WonRow
            key={p.runId}
            tone="attention"
            action={
              <span style={{ display: "inline-flex", gap: 8 }}>
                <Form method="post" action={OUTLET_ACTION}>
                  <input type="hidden" name={OUTLET_FIELD.intent} value={OUTLET_INTENT.reopen} />
                  <input type="hidden" name={OUTLET_FIELD.run} value={p.runId} />
                  <s-button type="submit" variant="primary">
                    {t("outlet.ended.reopen")}
                  </s-button>
                </Form>
                <Form method="post" action={OUTLET_ACTION}>
                  <input type="hidden" name={OUTLET_FIELD.intent} value={OUTLET_INTENT.keep} />
                  <input type="hidden" name={OUTLET_FIELD.run} value={p.runId} />
                  <s-button type="submit" variant="secondary">
                    {t("outlet.ended.keep")}
                  </s-button>
                </Form>
              </span>
            }
          >
            <RowNote tone="attention">{t("overview.outlet.pending", { title: p.title || t("outlet.run.unknown"), n: p.qty })}</RowNote>
          </WonRow>
        ))}
        {outlet.oversold > 0 ? (
          <WonRow>
            <RowNote tone="attention">{t("overview.outlet.oversold")}</RowNote>
          </WonRow>
        ) : null}
        {outlet.problems > 0 ? (
          <WonRow>
            <RowNote tone="attention">{t("overview.outlet.problems")}</RowNote>
          </WonRow>
        ) : null}
        <WonRow
          action={
            <s-button href="/app/outlet" variant="secondary">
              {t(has ? "overview.outlet.open" : "overview.outlet.setup")}
            </s-button>
          }
        >
          {null}
        </WonRow>
      </div>
    </WonSection>
  );
}
