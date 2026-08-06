import { redirect } from "react-router";

// Recipes + Events were merged into the single "Toasts" page (doctrine §7).
// Kept as a redirect so old links / settings-search deep-links still resolve.
export const loader = () => redirect("/app/toasts");
