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
  redirectUris: string[];
}

export const GRANT_TYPES = ["Client Credentials", "Implicit Grant", "Code Authorization", "SAML2 Bearer"];

// Only client_credentials is actually accepted by /api/oauth/token today —
// every other grant type can be selected and saved, but a client configured
// with one can never obtain a token. Surfaced in the drawer so this isn't a
// silent trap the way the unused Token duration field used to be.
export const FUNCTIONAL_GRANT_TYPES = ["Client Credentials"];
