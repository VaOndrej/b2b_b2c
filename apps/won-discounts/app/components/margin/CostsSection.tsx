// "Nákupní ceny": how many products have a purchase cost (A2: the admin says
// how many do not, and which), what applies to those without one, and how
// fresh the cost mirror is — with the ONE button that refreshes it (§13:
// "Obnovit nákupní ceny"). Leads with its state (§17): the summary is the count
// without a cost.

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { mirrorCanRefresh, mirrorText, percentText } from "../model/margin";
import { uiText } from "../model/result-copy";
import type { CostCoverageView, CostMirrorView } from "../model/types";
import { RefreshCostsButton } from "../shell/Notice";
import { RowNote, WonBlock, WonRow, WonSection } from "../shell/WonSection";

/** The section's state line: not read yet (why) / being read / all have a cost / "12 produktů nemá nákupní cenu". */
export function coverageSummary(coverage: CostCoverageView | null, mirror: CostMirrorView, tr: Translator): string {
  if (!coverage) {
    if (mirror.state === "off") return tr.t("margin.costs.notScanned");
    return mirror.state === "running" ? mirrorText(mirror, tr) : tr.t("overview.margin.costs.unknown");
  }
  if (coverage.productsWithoutCost === 0) return tr.t("margin.costs.all");
  return tr.tp("margin.costs.missing", coverage.productsWithoutCost);
}

/** The collapsed list names its first products (§9d: collapsed still tells the truth). */
function sampleSummary(sample: CostCoverageView["sample"], missing: number, tr: Translator): string {
  const names = sample.slice(0, 3).map((p) => p.title || tr.t("common.untitledProduct"));
  const rest = Math.max(0, missing - names.length);
  return rest > 0 ? `${names.join(", ")} ${tr.t("margin.costs.more", { n: rest })}` : tr.list(names);
}

/** `gid://shopify/Product/123` → the product in Shopify admin (App Bridge `shopify://admin`, §13a: the fix is there). */
export function adminProductHref(productId: string): string | null {
  const numeric = /(\d+)$/.exec(productId)?.[1];
  return numeric ? `shopify://admin/products/${numeric}` : null;
}

export function CostsSection({
  coverage,
  mirror,
  maxDiscountPercent,
}: {
  coverage: CostCoverageView | null;
  mirror: CostMirrorView;
  /** The typed ceiling for products without a cost (A2). */
  maxDiscountPercent: number;
}) {
  const tr = useT();
  const { t } = tr;
  const missing = coverage?.productsWithoutCost ?? 0;
  const sample = coverage?.sample ?? [];
  return (
    <WonSection title={t("margin.costs.title")} glyph="receipt" summary={coverageSummary(coverage, mirror, tr)} anchor="costs">
      <div>
        {coverage ? (
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">{t("margin.costs.coverage", { with: coverage.variantsWithCost, total: coverage.variants })}</s-text>
            {missing > 0 ? <s-text>{t("margin.costs.cap", { percent: percentText(maxDiscountPercent, tr) })}</s-text> : null}
          </s-stack>
        ) : null}
        {sample.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            {/* §3i: the list is capped (20 from the server) and collapsed on first paint; the summary names the count. */}
            <WonBlock title={t("margin.costs.sample")} summary={sampleSummary(sample, missing, tr)} collapsible defaultOpen={false}>
              <div>
                {sample.map((product) => {
                  const href = adminProductHref(product.productId);
                  return (
                    <WonRow
                      key={product.productId}
                      action={
                        href ? (
                          <s-link href={href} target="_top">
                            {t("margin.costs.fix")}
                          </s-link>
                        ) : undefined
                      }
                    >
                      <s-text type="strong">{product.title || t("common.untitledProduct")}</s-text>
                      <RowNote>{tr.tp("margin.costs.sampleVariants", product.variantsWithoutCost)}</RowNote>
                    </WonRow>
                  );
                })}
                {missing > sample.length ? (
                  <WonRow>
                    <s-text color="subdued">{t("margin.costs.more", { n: missing - sample.length })}</s-text>
                  </WonRow>
                ) : null}
                <WonRow>
                  <RowNote>{t("margin.costs.where")}</RowNote>
                </WonRow>
              </div>
            </WonBlock>
          </div>
        ) : null}
        <div style={{ marginTop: coverage || sample.length > 0 ? 12 : 0 }}>
          <WonRow tone={mirror.state === "failed" ? "attention" : undefined} action={mirrorCanRefresh(mirror) ? <RefreshCostsButton /> : undefined}>
            <s-text type="strong">{t("margin.mirror.label")}</s-text>
            <RowNote tone={mirror.state === "failed" ? "attention" : undefined}>{mirrorText(mirror, tr)}</RowNote>
            {mirror.state === "failed" ? mirror.problems.map((problem, i) => <RowNote key={i}>{uiText(problem, tr)}</RowNote>) : null}
            <RowNote>{t("margin.mirror.model")}</RowNote>
          </WonRow>
        </div>
      </div>
    </WonSection>
  );
}
