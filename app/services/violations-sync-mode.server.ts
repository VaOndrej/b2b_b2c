export interface ViolationsSyncMode {
  usesLocalDevLogSync: boolean;
  sourceMessage: string;
}

export function getViolationsSyncMode(
  isProduction: boolean,
): ViolationsSyncMode {
  if (isProduction) {
    return {
      usesLocalDevLogSync: false,
      sourceMessage:
        "Production mode: this page reads persisted violations only. Live checkout violations are recorded through the orders/create webhook flow.",
    };
  }

  return {
    usesLocalDevLogSync: true,
    sourceMessage:
      "Development mode: this page also syncs local Shopify Function logs from .shopify/logs.",
  };
}
