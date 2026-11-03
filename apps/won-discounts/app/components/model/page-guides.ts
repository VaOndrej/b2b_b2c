// The explanation at the top of a page (návrh 30 Oct 2026, "Ukázka a kroky"): a sentence on what the page is for,
// three steps and what the customer sees. The texts are `guide.<page>.*`; the sample in the preview is an illustration,
// never the shop's own numbers. The one exception is Nastavení: its preview is "Váš obchod", so it shows the shop's own
// plan, markets and combining (settingsGuideRows), never a value written into the dictionary (§5, §12).

import type { MessageKey, Translator } from "../../i18n";
import { combineSummary, type CombineType } from "./combine";

export const GUIDE_PAGES = ["tiers", "outlet", "campaigns", "placements", "margin", "tryCart", "analytics", "translations", "settings"] as const;
export type GuidePage = (typeof GUIDE_PAGES)[number];

/** The pages of a Pro feature: the badge stays on them on the Pro plan too. */
const PRO_GUIDES: readonly GuidePage[] = ["outlet", "campaigns", "tryCart"];

export function guideIsPro(page: GuidePage): boolean {
  return PRO_GUIDES.includes(page);
}

export interface GuideStep {
  title: MessageKey;
  text: MessageKey;
}

export function guideSteps(page: GuidePage): GuideStep[] {
  return ([1, 2, 3] as const).map((n) => ({ title: `guide.${page}.step${n}`, text: `guide.${page}.step${n}.text` }));
}

/** What Nastavení's preview reads from the shop. `markets` null = not read (the row is left out, never guessed). */
export interface SettingsGuideFacts {
  plan: "free" | "pro";
  markets: number | null;
  combine: readonly CombineType[];
}

export interface GuideFact {
  label: string;
  value: string;
}

/** The rows of "Váš obchod": how a new discount combines, how many markets run, the plan. */
export function settingsGuideRows(facts: SettingsGuideFacts, tr: Translator): GuideFact[] {
  const combine = combineSummary(facts.combine, tr);
  return [
    { label: tr.t("guide.preview.setCombine"), value: combine.charAt(0).toLocaleUpperCase(tr.locale) + combine.slice(1) },
    ...(facts.markets === null ? [] : [{ label: tr.t("guide.preview.setMarkets"), value: tr.tp("settings.markets.count", facts.markets) }]),
    { label: tr.t("guide.preview.setPlan"), value: facts.plan === "pro" ? "Pro" : "Free" },
  ];
}

const hiddenKey = (page: GuidePage) => `won.guide.hidden.${page}`;
/** Holds the choice for this visit when the browser refuses storage. */
const hiddenNow = new Set<GuidePage>();
const listeners = new Set<() => void>();

export function subscribeGuideHidden(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Has this browser hidden the page's explanation? */
export function guideHidden(page: GuidePage): boolean {
  if (hiddenNow.has(page)) return true;
  try {
    return window.localStorage.getItem(hiddenKey(page)) === "1";
  } catch {
    return false;
  }
}

export function setGuideHidden(page: GuidePage, hidden: boolean): void {
  if (hidden) hiddenNow.add(page);
  else hiddenNow.delete(page);
  try {
    if (hidden) window.localStorage.setItem(hiddenKey(page), "1");
    else window.localStorage.removeItem(hiddenKey(page));
  } catch {
    // Storage is refused: the choice lasts until the page is reloaded.
  }
  for (const listener of listeners) listener();
}
