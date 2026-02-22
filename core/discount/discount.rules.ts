export interface DiscountInput {
  code?: string;
  percentOff?: number;
}

export interface DiscountRules {
  allowStacking: boolean;
  maxCombinedPercentOff?: number;
}

export interface DiscountResult {
  totalPercentOff: number;
  appliedCodes: string[];
}
