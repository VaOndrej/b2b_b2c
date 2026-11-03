// One save per page, the browser side (model/one-save.ts): the page's form with the App Bridge save bar, and the
// parts stored by their own action inside it. On Save (the bar's, or Enter):
//   1. the page's own fields go to the page's action, as a submit of the page always did (its result is the route's);
//   2. once that is saved, each changed part goes to its own action with the fields of its old form, one after the
//      other, on one fetcher (a part never runs while another write holds the shop's config lock);
//   3. a refusal stops the chain: the page says which part was not saved and why; nothing after it is posted.
// A saved page remounts with the new stored version (the route keys it so), so the chain lives in this module, not in
// the component: the remounted page picks it up. The page did not change: the parts start at once.

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useFetcher, useSubmit } from "react-router";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { planSave, splitSave, type FormEntry, type SplitSave } from "../model/one-save";
import type { UiResult } from "../model/types";
import { Notice } from "./Notice";

export interface SavePart {
  key: string;
  /** Where the part posts (its old form's action). */
  action: string;
  /** The hidden fields of its old form (intent, module, stored version), added when it is posted. */
  extra: Record<string, string>;
  /** What the part is called on the page ("Sčítá se s"), for a refusal. */
  label: MessageKey;
}

interface Chain {
  page: string;
  /** Waiting for the page's own result (true), or posting the parts. */
  waitingForPage: boolean;
  queue: { part: SavePart; entries: FormEntry[] }[];
  inFlight: SavePart | null;
  /** The fetcher left "idle" for the part in flight: its data is that part's answer, not an older one. */
  answered: boolean;
}

/** The chain of the page being saved, by the page's key (one page saves at a time). */
const chains = new Map<string, Chain>();
/** The last refusal of a part, by the page's key, until the next save. */
const refusals = new Map<string, { label: MessageKey; result: UiResult; notPosted: MessageKey[] }>();
const FETCHER_KEY = "won-one-save";

/** Reads the form once its Polaris fields are defined: what "unchanged" is measured against. */
function useBaseline(formRef: RefObject<HTMLFormElement>, resetKey: unknown): RefObject<SplitSave | null> {
  const baseline = useRef<SplitSave | null>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    baseline.current = null;
    let cancelled = false;
    const tags = [...new Set([...form.querySelectorAll("*")].map((el) => el.localName).filter((name) => name.startsWith("s-")))];
    void Promise.all(tags.map((tag) => customElements.whenDefined(tag))).then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled && formRef.current) baseline.current = splitSave(new FormData(formRef.current).entries());
        }),
      ),
    );
    // Discard puts the form back as it was loaded: the baseline stays.
    return () => {
      cancelled = true;
    };
  }, [formRef, resetKey]);
  return baseline;
}

const toFormData = (entries: readonly FormEntry[], extra: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(extra)) data.append(name, value);
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

/**
 * `pageKey`: the page (its path). `result`: the page action's result as the route hands it. `parts`: in the order
 * they are saved. Returns the form's submit handler and what to show about the parts.
 */
export function useOneSave({ pageKey, formRef, result, parts }: { pageKey: string; formRef: RefObject<HTMLFormElement>; result: UiResult | null | undefined; parts: readonly SavePart[] }) {
  const submit = useSubmit();
  const fetcher = useFetcher<UiResult>({ key: FETCHER_KEY });
  const baseline = useBaseline(formRef, pageKey);
  const [refusal, setRefusal] = useState(() => refusals.get(pageKey) ?? null);

  const postNext = useCallback(
    (chain: Chain) => {
      const next = chain.queue.shift();
      if (!next) {
        chains.delete(chain.page);
        return;
      }
      chain.inFlight = next.part;
      chain.answered = false;
      void fetcher.submit(toFormData(next.entries, next.part.extra), { method: "post", action: next.part.action });
    },
    [fetcher],
  );

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const now = splitSave(new FormData(form).entries());
      const plan = planSave(now, baseline.current, parts.map((p) => p.key));
      refusals.delete(pageKey);
      setRefusal(null);
      const queue = plan.parts.map((key) => ({ part: parts.find((p) => p.key === key)!, entries: now.parts.get(key) ?? [] }));
      const chain: Chain = { page: pageKey, waitingForPage: plan.page, queue, inFlight: null, answered: false };
      chains.set(pageKey, chain);
      if (plan.page) submit(toFormData(now.page), { method: "post" });
      else postNext(chain);
    },
    [baseline, pageKey, parts, postNext, submit],
  );

  // The page's own result: saved → the parts; refused → nothing more is posted (the parts stay in the form, unsaved).
  useEffect(() => {
    const chain = chains.get(pageKey);
    if (!chain || !chain.waitingForPage || !result) return;
    chain.waitingForPage = false;
    if (result.ok) postNext(chain);
    else chains.delete(pageKey);
  }, [pageKey, postNext, result]);

  // A part's result: saved → the next one; refused → stop and say which part, and what was not posted after it.
  useEffect(() => {
    const chain = chains.get(pageKey);
    if (!chain || !chain.inFlight) return;
    if (fetcher.state !== "idle") {
      chain.answered = true;
      return;
    }
    if (!chain.answered || !fetcher.data) return;
    const done = chain.inFlight;
    chain.inFlight = null;
    if (fetcher.data.ok) {
      postNext(chain);
      return;
    }
    const failed = { label: done.label, result: fetcher.data, notPosted: chain.queue.map((q) => q.part.label) };
    chains.delete(pageKey);
    refusals.set(pageKey, failed);
    setRefusal(failed);
  }, [fetcher.data, fetcher.state, pageKey, postNext]);

  const saving = fetcher.state !== "idle";
  return { onSubmit, refusal, saving };
}

/** A part that was not saved: which one, why (the action's own refusal), and what was not posted after it. */
export function PartRefusal({ refusal }: { refusal: { label: MessageKey; result: UiResult; notPosted: MessageKey[] } | null }) {
  const { t } = useT();
  if (!refusal) return null;
  return (
    <div data-won-part-refusal="">
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{t("oneSave.partNotSaved", { part: t(refusal.label) })}</s-text>
        <Notice result={refusal.result} />
        {refusal.notPosted.length > 0 ? <s-text>{t("oneSave.notPosted", { parts: refusal.notPosted.map((key) => t(key)).join(", ") })}</s-text> : null}
      </s-stack>
    </div>
  );
}
