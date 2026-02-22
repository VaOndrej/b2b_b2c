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

export function isCustomerB2B(
  payload: CustomerWebhookPayload,
  b2bTag = "b2b",
): boolean {
  const normalized = b2bTag.trim().toLowerCase();
  return parseCustomerTags(payload).some(
    (tag) => tag.toLowerCase() === normalized,
  );
}
