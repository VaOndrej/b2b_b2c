import { createScopesUpdateAction } from "@won/app-kit/webhooks";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = createScopesUpdateAction({ authenticate, db });
