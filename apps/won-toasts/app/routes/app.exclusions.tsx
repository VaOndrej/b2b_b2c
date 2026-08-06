import { redirect } from "react-router";

// Exclusions were folded into the Targeting page ("where toasts run" +
// "where they never run" — doctrine §7). Kept as a redirect so old links resolve.
export const loader = () => redirect("/app/targeting");
