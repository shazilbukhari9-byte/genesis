"""
Salesforce HTTP client — Integrations Phase 1 (see SALESFORCE_INTEGRATION.md).

Pure functions only: no Flask, no DB, no g.tenant_id. Every function here
makes exactly one real outbound HTTP call via urllib.request (the same
stdlib approach sso.py already uses for its IdP token exchange — this repo
has no `requests`/`httpx` dependency) with an explicit timeout, and raises
one of the typed exceptions below instead of returning an ambiguous None
or a bare dict a caller has to sniff. Callers (salesforce_oauth.py,
dataact.py) branch on exception type, not on parsed error strings.

Never logs or returns a token/secret in an exception message — every
raised error carries only a short, user-safe description.
"""

import json
import socket
import urllib.error
import urllib.request
from urllib.parse import urlencode

DEFAULT_TIMEOUT = 10
API_VERSION = 'v60.0'  # matches the seeded CRM_Lookup_Customer endpoint's /services/data/v60.0/query path


class SalesforceError(Exception):
    """Base class for every error this client raises."""


class SalesforceAuthError(SalesforceError):
    """Invalid/expired code, invalid/expired token, or a 401 from the API."""


class SalesforceForbiddenError(SalesforceError):
    """403 — token is valid but lacks permission for the requested object/field."""


class SalesforceNotFoundError(SalesforceError):
    """404 from the API (e.g. an org/instance that no longer exists)."""


class SalesforceRateLimitError(SalesforceError):
    """420/429-style Salesforce API-limit response."""


class SalesforceServerError(SalesforceError):
    """5xx from Salesforce's side."""


class SalesforceTimeoutError(SalesforceError):
    """The request exceeded DEFAULT_TIMEOUT without a response."""


class SalesforceNetworkError(SalesforceError):
    """DNS/connection failure reaching Salesforce at all."""


class SalesforceResponseError(SalesforceError):
    """2xx status but the body wasn't valid/expected JSON."""


def _post_form(url, fields, timeout=DEFAULT_TIMEOUT):
    """POST application/x-www-form-urlencoded, return parsed JSON body.
    Shared by the three token-endpoint calls below (exchange/refresh/revoke
    all hit the same host in the same shape)."""
    data = urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/x-www-form-urlencoded',
    })
    return _send(req, timeout)


def _send(req, timeout):
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        raw = resp.read()
    except urllib.error.HTTPError as e:
        _raise_for_http_error(e)
    except socket.timeout:
        raise SalesforceTimeoutError('Salesforce did not respond in time.')
    except urllib.error.URLError as e:
        raise SalesforceNetworkError(f'Could not reach Salesforce: {e.reason}')

    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        raise SalesforceResponseError('Salesforce returned a response that was not valid JSON.')


def _raise_for_http_error(e):
    """Map an HTTPError's status code to a typed exception, using the
    response body's `error_description`/`message` when Salesforce sent one
    — but never re-raising the raw body, so a caller can't accidentally
    leak internal detail to the frontend."""
    try:
        body = json.loads(e.read())
    except Exception:
        body = {}
    detail = (
        body.get('error_description') or body.get('message')
        or (isinstance(body, list) and body and body[0].get('message'))
        or f'HTTP {e.code}'
    )
    if e.code == 401:
        raise SalesforceAuthError(detail)
    if e.code == 403:
        raise SalesforceForbiddenError(detail)
    if e.code == 404:
        raise SalesforceNotFoundError(detail)
    if e.code in (420, 429):
        raise SalesforceRateLimitError(detail)
    if e.code >= 500:
        raise SalesforceServerError(detail)
    if e.code == 400:
        raise SalesforceAuthError(detail)
    raise SalesforceError(f'{detail} (HTTP {e.code})')


def exchange_code_for_token(login_base, client_id, client_secret, code, redirect_uri, timeout=DEFAULT_TIMEOUT):
    """OAuth 2.0 Web Server Flow, step 2: authorization code -> tokens.
    POST {login_base}/services/oauth2/token, grant_type=authorization_code.
    Returns the full token response dict (access_token, refresh_token if
    the 'refresh_token' scope was granted, instance_url, token_type,
    scope, id, issued_at, signature) — caller decides what to persist."""
    url = login_base.rstrip('/') + '/services/oauth2/token'
    return _post_form(url, {
        'grant_type': 'authorization_code',
        'client_id': client_id,
        'client_secret': client_secret,
        'code': code,
        'redirect_uri': redirect_uri,
    }, timeout)


def refresh_access_token(login_base, client_id, client_secret, refresh_token, timeout=DEFAULT_TIMEOUT):
    """OAuth 2.0 refresh_token grant. Salesforce does not reissue a new
    refresh_token on this call — the original stays valid and reusable."""
    url = login_base.rstrip('/') + '/services/oauth2/token'
    return _post_form(url, {
        'grant_type': 'refresh_token',
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token,
    }, timeout)


def revoke_token(login_base, token, timeout=DEFAULT_TIMEOUT):
    """POST {login_base}/services/oauth2/revoke. Salesforce returns 200
    with an empty body on success — nothing to parse as JSON, so this
    doesn't go through _post_form/_send's JSON-decode step."""
    url = login_base.rstrip('/') + '/services/oauth2/revoke'
    data = urlencode({'token': token}).encode()
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/x-www-form-urlencoded',
    })
    try:
        urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        _raise_for_http_error(e)
    except socket.timeout:
        raise SalesforceTimeoutError('Salesforce did not respond in time.')
    except urllib.error.URLError as e:
        raise SalesforceNetworkError(f'Could not reach Salesforce: {e.reason}')


def soql_query(instance_url, access_token, soql, timeout=DEFAULT_TIMEOUT):
    """GET {instance_url}/services/data/vNN.N/query?q=<SOQL>. Returns the
    parsed response dict — {totalSize, done, records: [...]}."""
    url = instance_url.rstrip('/') + f'/services/data/{API_VERSION}/query?' + urlencode({'q': soql})
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {access_token}',
        'Accept': 'application/json',
    })
    return _send(req, timeout)
