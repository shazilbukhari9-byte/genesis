export interface AuditEntry {
  when: string;
  who: string;
  action: string;
  detail?: string;
}

export const AUDIT_ACTION_TYPES = [
  "Sign in",
  "Create",
  "Edit",
  "Delete",
  "ALERT",
  "Callback",
  "Coaching",
  "Monitor",
  "Copilot",
  "Export",
  "Supervisor",
] as const;

export function isWarningAction(action: string): boolean {
  return /ALERT|Delete|log-off|Barge/i.test(action);
}
