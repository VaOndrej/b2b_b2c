// Where a section that saves on its own posts: the app's own routes. The dev harness posts to itself instead
// (nothing is saved there), the same way it hands Nastavení its `planAction`.

import { createContext, useContext } from "react";

import { LOOKS_ACTION } from "../model/looks";
import { TRANSLATIONS_ACTION } from "../model/translations";

export interface FormActions {
  looks: string;
  translations: string;
}

export const FormActionsContext = createContext<FormActions>({ looks: LOOKS_ACTION, translations: TRANSLATIONS_ACTION });

export const useFormActions = (): FormActions => useContext(FormActionsContext);
