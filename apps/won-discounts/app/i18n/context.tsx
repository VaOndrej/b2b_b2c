// React side of the admin i18n. The embedded layout (routes/app.tsx) and the dev
// harness put the resolved admin locale here once; every screen and shell
// component reads it with useT(). Without a provider (unit renders) the
// default locale applies.

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { DEFAULT_LOCALE, translator, type Locale, type Translator } from "./index";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
