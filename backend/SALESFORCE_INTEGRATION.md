# Salesforce Integration (Admin > Integrations, Phase 1)

A real, production-grade OAuth 2.0 (Web Server Flow) connection to Salesforce,
backing the **Salesforce CTI** catalogue entry's Connect / Disconnect / Test
Connection controls, and the `CRM_Lookup_Customer` Data Action's real
execution path. Everything else under Admin > Integrations still uses the
existing simulated test/connection paths — this is a reference
implementation for one integration, not a rewrite of the whole surface.

## What's real

- **OAuth**: `authorize-url` → redirect to Salesforce → `callback` exchanges
  the auth code for tokens via `salesforce_client.py`'s real HTTP calls to
  `/services/oauth2/token`.
- **Token storage**: access/refresh tokens are Fernet-encrypted before being
  written to `salesforce_connections` — never stored in plaintext.
- **Token refresh**: `salesforce_oauth.get_valid_access_token()` transparently
  refreshes an expired/near-expired token before every use.
- **Data Action execution**: `dataact.py`'s `CRM_Lookup_Customer` (integration
  `Salesforce`) action runs a real SOQL query
  (`SELECT Id, Name, AccountId, Account.Type FROM Contact WHERE Phone = ...`)
  against the connected org, never a simulated result.
- **Errors are honest**: not installed, not connected, expired token, or a
  real Salesforce API error all surface as a genuine `Failing` status with a
  specific `last_error` — never a fabricated success.

## Setting up a Salesforce Connected App

1. In Salesforce Setup, go to **App Manager → New Connected App**.
2. Enable OAuth Settings. Set the **Callback URL** to:
   `{OG_PUBLIC_BASE_URL}/api/integrations/salesforce/oauth/callback`
   (e.g. `http://127.0.0.1:5000/api/integrations/salesforce/oauth/callback`
   locally, or your real backend origin in production).
3. Selected OAuth Scopes: **Manage user data via APIs (api)** and
   **Perform requests at any time (refresh_token, offline_access)**.
4. Save, then copy the **Consumer Key** and **Consumer Secret**.

## Environment variables (all optional at boot — see `.env.example`)

| Variable | Purpose |
|---|---|
| `OG_SALESFORCE_CLIENT_ID` | Connected App Consumer Key |
| `OG_SALESFORCE_CLIENT_SECRET` | Connected App Consumer Secret |
| `OG_SALESFORCE_LOGIN_BASE_URL` | `https://login.salesforce.com` (production/Dev Edition) or `https://test.salesforce.com` (sandbox) |
| `OG_INTEGRATION_ENCRYPTION_KEY` | Fernet key encrypting stored tokens — generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and keep it stable; rotating it makes existing stored tokens undecryptable (reconnect fixes it) |

The app boots fine with none of these set. Only Connect/Test Connection on
the Salesforce CTI row and the `CRM_Lookup_Customer` Data Action need them —
those routes return a clear `"Salesforce integration is not configured on
this server"` error until configured, rather than failing silently or
faking success.

## Routes

```
POST /api/integrations/salesforce/oauth/authorize-url   (auth required)
GET  /api/integrations/salesforce/oauth/callback         (public — Salesforce redirects the bare browser here)
POST /api/integrations/salesforce/oauth/disconnect       (auth required)
POST /api/integrations/salesforce/oauth/test             (auth required)
GET  /api/integrations/salesforce/oauth/status/<installed_integration_id>  (auth required)
```

## Database

Two new, additive tables (`database/schema.sql`) — no existing table
altered:

- `salesforce_connections` — one row per installed Salesforce integration's
  OAuth state (encrypted tokens, `connection_status`, `last_error`,
  `connected_at`). 1:1 with `installed_integrations` via a UNIQUE constraint.
- `salesforce_oauth_states` — short-lived (10 min), single-use OAuth CSRF
  state, deleted the moment it's read back in the callback.

## Testing

`backend/tests/test_salesforce_oauth.py` and
`backend/tests/test_dataact_salesforce_execution.py` mock only the outbound
HTTP layer (`salesforce_client`'s functions) — the DB layer, auth, and
routing are all exercised for real against a disposable pytest tenant. Run:

```bash
cd backend
./venv/Scripts/python.exe -m pytest tests/test_salesforce_oauth.py tests/test_dataact_salesforce_execution.py -q
```
