export interface AuditLogEntry {
  type: "MARGIN_VIOLATION" | "RULE_CHANGE";
  message: string;
  createdAt: string;
}
