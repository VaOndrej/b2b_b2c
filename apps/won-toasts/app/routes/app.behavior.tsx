import { redirect } from "react-router";

// Behavior was folded into the "Design" page (Placement / Timing / Grouping /
// Frequency groups — doctrine §7). Kept as a redirect so old links resolve.
export const loader = () => redirect("/app/design");
