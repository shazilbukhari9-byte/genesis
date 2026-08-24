export interface SsoProvider {
  id: string;
  name: string;
  type: string;
  status: "Enabled" | "Disabled" | "Not configured";
  statusNote?: string;
  certExpiry?: string;
  users: number;
  isDefault?: boolean;
  // SAML settings + Behaviour fields below match the UI prototype's own
  // provider drawer exactly (Issuer URI, Target URL, Certificate, NameID
  // format, fallback/SCIM/signing toggles, Relying party identifier) — but
  // the prototype's own "Save" button for this drawer literally toasts
  // "Saved — prototype only" (it's a decorative mockup, not backed by real
  // logic anywhere, not even in the prototype itself). The real backend
  // here only persists name/type/enabled for an actual OIDC login flow, so
  // these fields are kept in the browser (see ssoService's local overlay)
  // rather than sent to the API — visual parity with the prototype without
  // pretending they configure something real.
  samlIssuerUri?: string | undefined;
  samlTargetUrl?: string | undefined;
  certificate?: string | undefined;
  nameIdFormat?: "emailAddress" | "persistent" | "unspecified" | undefined;
  allowPasswordFallback?: boolean | undefined;
  autoProvisionScim?: boolean | undefined;
  signAuthRequests?: boolean | undefined;
  relyingPartyId?: string | undefined;
}
