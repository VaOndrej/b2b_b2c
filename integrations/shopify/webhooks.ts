export interface CustomerWebhookPayload {
  id: string;
  tags?: string;
}

export function parseCustomerTags(payload: CustomerWebhookPayload): string[] {
  if (!payload.tags) {
    return [];
  }

  return payload.tags
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
