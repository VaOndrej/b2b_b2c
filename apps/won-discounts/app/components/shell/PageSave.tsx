// The ONE "Uložit" of a page whose form spans several views (shell/views.tsx). It is shown only under a view that
// has something of the page's form to save: under a view that only shows something, leads to the theme editor or
// saves by itself (a look, with its own "Uložit vzhled"), a second Save reads as "this is a setting too"
// (doctrine §18i / §20c; walkthrough before the first review, nález 7). Hidden, never unmounted: the form and the
// App Bridge save bar keep working whichever view is open.
import { useT } from "../../i18n/context";

export function PageSave({ shown, marker }: { shown: boolean; marker?: Record<string, string> }) {
  const { t } = useT();
  return (
    <div data-won-page-save={shown ? "shown" : "hidden"} {...marker} style={{ display: shown ? "block" : "none" }}>
      <s-button type="submit" variant="primary">
        {t("common.save")}
      </s-button>
    </div>
  );
}
