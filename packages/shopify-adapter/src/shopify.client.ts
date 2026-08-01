export interface ShopifyCustomerSnapshot {
  id: string;
  tags: string[];
}

export interface ShopifyAdminGraphqlClient {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<{
    json(): Promise<any>;
  }>;
}

export interface ShopifyClientAdapter {
  getCustomerById(
    admin: ShopifyAdminGraphqlClient,
    customerId: string,
  ): Promise<ShopifyCustomerSnapshot | null>;
}

export function createShopifyClientAdapter(): ShopifyClientAdapter {
  return {
    async getCustomerById(admin, customerId) {
      const response = await admin.graphql(
        `#graphql
        query GetCustomerTags($id: ID!) {
          customer(id: $id) {
            id
            tags
          }
        }`,
        { variables: { id: customerId } },
      );
      const payload = await response.json();
      const customer = payload?.data?.customer;

      if (!customer?.id) {
        return null;
      }

      return {
        id: customer.id,
        tags: Array.isArray(customer.tags) ? customer.tags : [],
      };
    },
  };
}
