export interface SsoProvider {
  id: string;
  name: string;
  type: string;
  status: "Enabled" | "Disabled" | "Not configured";
  statusNote?: string;
  certExpiry?: string;
  users: number;
  isDefault?: boolean;
}
