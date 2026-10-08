// Překlady (feedback 2026-10-06, body 11, 12, 14) — the texts a customer sees on the storefront, one table per
// language of the shop: the default language first, further ones added from the languages switched on in
// Shopify. A row is one text: where it shows (never its key), the extension's own text in grey, the merchant's
// own. A text that drops or adds a `{…}` part says so next to its field while it is typed (P5) and the server
// refuses it. Free translates the default language and one more (§16: the limit is amber and says what Pro
// gives; a language stored past it stays, with what the storefront does instead, §14a). Export and import as CSV
// are Pro; an import shows what it changes and what it refuses before anything is saved.
// A presentational component: app/routes/app.translations.tsx renders it from loadTranslationsScreen
// (app/lib/integration/translations.server.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, useFetcher, useRevalidator, useSubmit } from "react-router";

import { useT } from "../../i18n/context";
import { requestScopes, type ScopeRequestResult } from "../model/app-bridge";
import {
  changedCount,
  groupLabel,
  languageName,
  languagesNotShipped,
  TEXT_GROUPS,
  textDefault,
  textError,
  textField,
  textGroup,
  textLabel,
  TRANSLATIONS_FIELD,
  TRANSLATIONS_INTENT,
  type ImportPlan,
  type TextRow,
} from "../model/translations";
import type { TranslationsScreenData, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { useFormActions } from "../shell/form-actions";
import { snapshotOf } from "../shell/form-snapshot";
import { Notice } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
import { WON_FAINT, WON_INK, WON_LINE, WON_MUTED } from "../shell/tokens";

/** What the CSV intents answer (translations.server.ts TranslationsResult). */
type CsvResult = UiResult | { ok: true; message: "export"; csv: string } | { ok: true; message: "import-preview"; plan: ImportPlan; csv: string };

export interface TranslationsScreenProps extends TranslationsScreenData {
  result?: UiResult | null;
  /** The dev harness: an import already planned (in the app it comes from the action). */
  importPreview?: { plan: ImportPlan; csv: string } | null;
}

/** The language picker's field: read on the page only, never a table. */
const ADD_FIELD = "add";

/** Three columns that fold under each other on a narrow page: where, the default, the merchant's own. */
const ROW_GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "4px 14px", alignItems: "start", padding: "8px 0", borderTop: `1px solid ${WON_LINE}` } as const;

export function TranslationsScreen(props: TranslationsScreenProps) {
  const { plan, configVersion, shopLanguages, rows, values, result } = props;
  const pro = plan === "pro";
  const tr = useT();
  const { t } = tr;
  const formRef = useRef<HTMLFormElement>(null);
  const [languages, setLanguages] = useState<string[]>(props.languages);

  // P5: the messages next to the fields follow what is typed (native events; an `s-*` field has no onChange).
  const [snapshot, setSnapshot] = useState<Map<string, string> | null>(null);
  const recompute = useCallback(() => {
    if (formRef.current) setSnapshot(snapshotOf(formRef.current));
  }, []);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onReset = () => {
      setLanguages(props.languages);
      setSnapshot(null);
    };
    el.addEventListener("input", recompute);
    el.addEventListener("change", recompute);
    el.addEventListener("reset", onReset);
    return () => {
      el.removeEventListener("input", recompute);
      el.removeEventListener("change", recompute);
      el.removeEventListener("reset", onReset);
    };
  }, [props.languages, recompute]);

  const errors = result && !result.ok && result.reason === "invalid" ? (result.errors ?? []) : [];
  const serverError = (field: string) => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  const valueOf = (locale: string, row: TextRow) => (snapshot ? (snapshot.get(textField(locale, row.key)) ?? "") : (values[locale]?.[row.key] ?? ""));
  const messageOf = (locale: string, row: TextRow) => {
    const live = textError(row.key, textDefault(row, locale), valueOf(locale, row).trim());
    return live ? t(live.key, live.params) : snapshot ? undefined : serverError(textField(locale, row.key));
  };

  const grouped = useMemo(() => TEXT_GROUPS.map((group) => ({ group, rows: rows.filter((row) => textGroup(row.key) === group) })).filter((g) => g.rows.length > 0), [rows]);
  const notShipped = languagesNotShipped(languages, plan);
  const offered = (shopLanguages ?? []).filter((code) => !languages.includes(code));
  const atLimit = props.limit !== null && languages.length >= props.limit;

  // The shop's languages need a permission the merchant gives once (an optional scope).
  const revalidator = useRevalidator();
  const [scope, setScope] = useState<ScopeRequestResult | null>(null);
  const grantScope = () => {
    void requestScopes(["read_locales"]).then((answer) => {
      setScope(answer);
      if (answer === "granted") revalidator.revalidate();
    });
  };

  const submit = useSubmit();
  const replaceUnreadable = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set(TRANSLATIONS_FIELD.replaceUnreadable, "1");
    submit(data, { method: "post" });
  };

  // CSV (Pro): the export answers with the file's text, the import with its plan; nothing is saved until confirmed.
  const csv = useFetcher<CsvResult>();
  const actions = useFormActions();
  const [dismissed, setDismissed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const answer = csv.data ?? null;
  useEffect(() => {
    if (!answer || !answer.ok || answer.message !== "export") return;
    const url = URL.createObjectURL(new Blob([answer.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "won-discounts-translations.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [answer]);
  const preview = dismissed ? null : answer && answer.ok && answer.message === "import-preview" ? { plan: answer.plan, csv: answer.csv } : (props.importPreview ?? null);
  const csvFailure = answer && !answer.ok ? answer : null;
  const csvSaved: UiResult | null = answer && answer.ok && answer.message !== "export" && answer.message !== "import-preview" ? answer : null;
  const post = (intent: string, extra: Record<string, string> = {}) => {
    setDismissed(false);
    csv.submit({ [TRANSLATIONS_FIELD.intent]: intent, ...(configVersion ? { [TRANSLATIONS_FIELD.configVersion]: configVersion } : {}), ...extra }, { method: "post", action: actions.translations });
  };
  const onFile = (file: File | undefined) => {
    if (!file) return;
    setReadFailed(false);
    file.text().then(
      (text) => post(TRANSLATIONS_INTENT.importPreview, { [TRANSLATIONS_FIELD.csv]: text }),
      () => setReadFailed(true),
    );
  };
  const rowByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const place = (key: string) => {
    const row = rowByKey.get(key);
    return row ? `${groupLabel(textGroup(key), tr)}: ${textLabel(row, tr)}` : key;
  };
  const csvError = csvFailure?.reason === "invalid" ? csvFailure.errors?.find((e) => e.field === TRANSLATIONS_FIELD.csv) : undefined;

  const csvBody = (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="small-300">
        <s-button variant="secondary" onClick={() => post(TRANSLATIONS_INTENT.exportCsv)} disabled={boolAttr(!pro)}>
          {t("translations.csv.export")}
        </s-button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: WON_INK, opacity: pro ? 1 : 0.55 }}>
          <span>{t("translations.csv.import")}</span>
          <input type="file" accept=".csv,text/csv" disabled={!pro} data-won-csv-file onChange={(e) => onFile(e.currentTarget.files?.[0])} />
        </label>
      </s-stack>
      <RowNote>{t("translations.csv.exportNote")}</RowNote>
      {readFailed ? <RowNote tone="attention">{t("translations.csv.readFailed")}</RowNote> : null}
      {csvError ? <RowNote tone="attention">{t(csvError.key, csvError.params)}</RowNote> : null}
      {preview ? (
        <div data-won-import-preview style={{ border: `1px solid ${WON_LINE}`, borderRadius: 11, padding: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{t("translations.csv.preview")}</div>
          <RowNote>
            {[t("translations.csv.changes", { n: preview.plan.changes.length }), t("translations.csv.unchanged", { n: preview.plan.unchanged }), t("translations.csv.refused", { n: preview.plan.refused.length })].join(" · ")}
          </RowNote>
          {preview.plan.changes.length > 0 ? (
            <ul data-won-import-changes style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.45, color: WON_INK, overflowWrap: "anywhere" }}>
              {preview.plan.changes.map((c) => (
                <li key={`${c.locale}.${c.key}`}>
                  {t("translations.csv.change", { place: place(c.key), language: languageName(c.locale, tr), from: c.from === "" ? t("translations.csv.empty") : `„${c.from}“`, to: c.to === "" ? t("translations.csv.empty") : `„${c.to}“` })}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.plan.refused.length > 0 ? (
            <ul data-won-import-refused style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.45, color: "#8a4b00", overflowWrap: "anywhere" }}>
              {preview.plan.refused.map((r, i) => (
                <li key={i}>
                  {r.reason === "header"
                    ? t("translations.csv.refused.header")
                    : r.reason === "language"
                      ? t("translations.csv.refused.language", { column: r.column })
                      : r.reason === "key"
                        ? t("translations.csv.refused.key", { line: String(r.line), key: r.key })
                        : t("translations.csv.refused.text", { line: String(r.line), place: place(r.key), language: languageName(r.locale, tr), reason: t(r.error.key, r.error.params) })}
                </li>
              ))}
            </ul>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <s-button variant="primary" disabled={boolAttr(preview.plan.changes.length === 0 || csv.state !== "idle")} onClick={() => post(TRANSLATIONS_INTENT.importApply, { [TRANSLATIONS_FIELD.csv]: preview.csv })}>
              {t("translations.csv.confirm")}
            </s-button>
            <s-button variant="secondary" onClick={() => setDismissed(true)}>
              {t("translations.csv.cancel")}
            </s-button>
          </div>
        </div>
      ) : null}
    </s-stack>
  );

  return (
    <s-page heading={t("module.translations")}>
      <s-stack direction="block" gap="base">
        <Notice result={csvSaved ?? (csvFailure && !csvError ? csvFailure : result)} onReplace={replaceUnreadable} />
        <Form method="post" ref={formRef} data-save-bar>
          <input type="hidden" name={TRANSLATIONS_FIELD.intent} value={TRANSLATIONS_INTENT.save} />
          {configVersion ? <input type="hidden" name={TRANSLATIONS_FIELD.configVersion} value={configVersion} /> : null}
          <s-stack direction="block" gap="base">
            <div style={{ fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{t("translations.intro")}</div>
            <FieldMessage text={serverError(TRANSLATIONS_FIELD.language)} />
            {languages.map((locale, index) => {
              const held = notShipped.includes(locale);
              const changed = changedCount(snapshot ? Object.fromEntries(rows.map((row) => [row.key, valueOf(locale, row)])) : values[locale], rows);
              const stored = props.languages.includes(locale);
              return (
                <WonSection
                  key={locale}
                  title={index === 0 ? `${languageName(locale, tr)} · ${t("translations.lang.default")}` : languageName(locale, tr)}
                  glyph="code"
                  summary={changed > 0 ? t("translations.lang.summary.some", { n: changed }) : t("translations.lang.summary.none")}
                  anchor={`lang-${locale}`}
                  collapsible
                  defaultOpen={index === 0 || !stored || errors.some((e) => e.field.startsWith(`${TRANSLATIONS_FIELD.text}${locale}.`))}
                >
                  <input type="hidden" name={TRANSLATIONS_FIELD.language} value={locale} />
                  <s-stack direction="block" gap="base">
                    {held ? (
                      <WonRow tone="attention">
                        <RowNote tone="attention">{t("translations.lang.notShipped")}</RowNote>
                      </WonRow>
                    ) : null}
                    {grouped.map(({ group, rows: groupRows }) => (
                      <div key={group} data-won-text-group={group}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: WON_INK, marginBottom: 4 }}>{groupLabel(group, tr)}</div>
                        {groupRows.map((row) => {
                          const label = textLabel(row, tr);
                          return (
                            <div key={row.key} data-won-text={row.key} style={ROW_GRID}>
                              <div style={{ fontSize: 13, lineHeight: 1.4, color: WON_INK, minWidth: 0 }}>{label}</div>
                              <div data-won-text-default style={{ fontSize: 13, lineHeight: 1.4, color: WON_FAINT, minWidth: 0, overflowWrap: "anywhere" }}>
                                {textDefault(row, locale)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <s-text-field name={textField(locale, row.key)} label={label} labelAccessibilityVisibility="exclusive" value={values[locale]?.[row.key] ?? ""} placeholder={textDefault(row, locale)} />
                                <FieldMessage text={messageOf(locale, row)} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {index > 0 ? (
                      <WonRow
                        action={
                          <s-button variant="secondary" tone="critical" onClick={() => setLanguages((list) => list.filter((code) => code !== locale))}>
                            {t("translations.lang.remove")}
                          </s-button>
                        }
                      >
                        <RowNote>{t("translations.lang.removeNote")}</RowNote>
                      </WonRow>
                    ) : null}
                  </s-stack>
                </WonSection>
              );
            })}

            <WonSection title={t("translations.add.title")} glyph="store" summary={t("translations.add.summary")} anchor="add">
              <s-stack direction="block" gap="base">
                {shopLanguages === null ? (
                  <WonRow
                    tone="attention"
                    action={
                      <s-button variant="primary" onClick={grantScope}>
                        {t("translations.scope.grant")}
                      </s-button>
                    }
                  >
                    <RowNote tone="attention">{t("translations.scope.missing")}</RowNote>
                    {scope === "declined" || scope === "unavailable" ? <RowNote tone="attention">{t(`translations.scope.${scope}`)}</RowNote> : null}
                  </WonRow>
                ) : atLimit ? (
                  <ProSell benefit={t("translations.add.benefit")} />
                ) : offered.length === 0 ? (
                  <RowNote>{t("translations.add.none")}</RowNote>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }} data-won-add-language>
                    <div style={{ flex: "1 1 200px", minWidth: 0, maxWidth: 320 }}>
                      {/* Read from the form when "Přidat jazyk" is pressed (an `s-*` field has no React onChange); the server ignores it. */}
                      <s-select name={ADD_FIELD} label={t("translations.add.label")} value={offered[0]}>
                        {offered.map((code) => (
                          <s-option key={code} value={code} selected={boolAttr(code === offered[0])}>
                            {languageName(code, tr)}
                          </s-option>
                        ))}
                      </s-select>
                    </div>
                    <s-button
                      variant="secondary"
                      onClick={() => {
                        const picked = formRef.current ? String(new FormData(formRef.current).get(ADD_FIELD) ?? "") : "";
                        const code = offered.includes(picked) ? picked : offered[0];
                        if (code) setLanguages((list) => [...list, code]);
                      }}
                    >
                      {t("translations.add.button")}
                    </s-button>
                  </div>
                )}
              </s-stack>
            </WonSection>

            <div>
              <s-button type="submit" variant="primary">
                {t("common.save")}
              </s-button>
            </div>
          </s-stack>
        </Form>

        <WonSection title={t("translations.csv.title")} glyph="code" pro locked={!pro} summary={t("translations.csv.summary")} anchor="csv">
          {pro ? (
            csvBody
          ) : (
            <s-stack direction="block" gap="base">
              <ProSell benefit={t("translations.csv.benefit")} />
              <ProFrame locked>{csvBody}</ProFrame>
            </s-stack>
          )}
        </WonSection>
      </s-stack>
    </s-page>
  );
}
