export interface OAuthClient {
  id: string;
  name: string;
  grantType: string;
  clientId: string;
  scope: string;
  tokenDurationSec: number;
  lastUsed: string;
  status: "Active" | "Disabled";
  statusNote?: string;
}

export const GRANT_TYPES = ["Client Credentials", "Implicit Grant", "Code Authorization", "SAML2 Bearer"];
