// "Pro is marked once per section" (feedback 3, bod 6; doctrine §19b). A WonSection with `pro` carries the
// amber edge and the one marker on its header and tells everything inside through this context: nested
// blocks, frames and plan markers then stay neutral instead of stacking amber on amber.

import { createContext } from "react";

export const ProMarked = createContext(false);
