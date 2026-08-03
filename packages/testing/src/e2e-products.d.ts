export interface WonE2EVariant {
  price: string;
  /** Map of optionName → value; empty/omitted for single-variant products. */
  options?: Record<string, string>;
}

export interface WonE2EProductOption {
  name: string;
  values: string[];
}

export interface WonE2EProduct {
  handle: string;
  title: string;
  options: WonE2EProductOption[];
  variants: WonE2EVariant[];
}

export type WonE2EProductKey =
  | "simpleA"
  | "simpleB"
  | "twoVariants"
  | "multiAxis"
  | "spare";

export const WON_E2E_PRODUCTS: Record<WonE2EProductKey, WonE2EProduct>;
export const WON_E2E_PRODUCT_LIST: WonE2EProduct[];
