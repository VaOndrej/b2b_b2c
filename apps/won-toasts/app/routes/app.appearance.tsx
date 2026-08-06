import { redirect } from "react-router";

// Appearance + Behavior were merged into the single "Design" page (doctrine §7).
// Kept as a redirect so old links / settings-search deep-links still resolve.
export const loader = () => redirect("/app/design");
