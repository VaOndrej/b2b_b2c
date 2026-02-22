export interface ShopifyCustomerSnapshot {
  id: string;
  tags: string[];
}

export interface ShopifyClientAdapter {
  getCustomerById(customerId: string): Promise<ShopifyCustomerSnapshot | null>;
}

export function createShopifyClientAdapter(): ShopifyClientAdapter {
  return {
    async getCustomerById() {
      return null;
    },
  };
}
