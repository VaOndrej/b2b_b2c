import { redirect } from "react-router";

// Events (cart-toast wording + milestones) were folded into the "Toasts" page
// (doctrine §7). Kept as a redirect so old links still resolve.
export const loader = () => redirect("/app/toasts");
