import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import "../mcm/mcm.css";
import { MCM_HTML } from "../mcm/markup";
import { MCM_SCRIPT } from "../mcm/scripts";
import { AUTHORG_SCRIPT } from "../mcm/authorg-redesign";
import { DIRECTORY_SCRIPT } from "../mcm/directory-redesign";
import { APPS_SCRIPT } from "../mcm/apps-redesign";
import { BACKEND_SYNC_SCRIPT } from "../mcm/backend-sync";
import { CANNED_SCRIPT } from "../mcm/canned-redesign";
import { CERTS_SCRIPT } from "../mcm/certs-redesign";
import { CONTACTLISTS_SCRIPT } from "../mcm/contactlists-redesign";
import { DATAACT_SCRIPT } from "../mcm/dataact-redesign";
import { DNCLISTS_SCRIPT } from "../mcm/dnclists-redesign";
import { SUBSCRIPTION_SCRIPT } from "../mcm/subscription-redesign";
import { bridgeGlobalToast } from "../lib/global-toast";
import { OrganizationSettingsPage } from "../features/org-settings/OrganizationSettingsPage";
import { PurchasesPage } from "../features/purchases/PurchasesPage";
import { AuditLogPage } from "../features/audit-log/AuditLogPage";
import { PeoplePage } from "../features/people-permissions/PeoplePage";
import { RolesPage } from "../features/people-permissions/RolesPage";
import { DivisionsPage } from "../features/people-permissions/DivisionsPage";
import { GroupsPage } from "../features/people-permissions/GroupsPage";
import { SkillsPage } from "../features/people-permissions/SkillsPage";
import { LangsPage } from "../features/people-permissions/LangsPage";
import { LicencesPage } from "../features/people-permissions/LicencesPage";
import { SsoPage } from "../features/sso/SsoPage";
import { OAuthClientsPage } from "../features/oauth-clients/OAuthClientsPage";
import { RecordingPoliciesPage } from "../features/quality/RecordingPoliciesPage";
import { RECPOL_SCRIPT } from "../mcm/recpol-redesign";
import { EvaluationFormsPage } from "../features/quality/EvaluationFormsPage";
import { EVALFORMS_SCRIPT } from "../mcm/evalforms-redesign";
import { CalibrationsPage } from "../features/quality/CalibrationsPage";
import { CALIBRATIONS_SCRIPT } from "../mcm/calibrations-redesign";
import { ForecastsPage } from "../features/quality/ForecastsPage";
import { FORECASTS_SCRIPT } from "../mcm/forecasts-redesign";
import { CUSTOM_PAGES_ROUTER_SCRIPT } from "../mcm/custom-pages-router";
import { SESSION_GUARD_SCRIPT } from "../mcm/session-guard";
import { API_BASE } from "../features/shared/backend";

const DEPLOYED_API_BASE = "https://genesis-yysv.onrender.com";

// scripts.ts / authorg-redesign.ts / directory-redesign.ts / backend-sync.ts
// hardcode the deployed backend's URL as a plain string literal (not read
// from Vite env — they're injected as raw <script> text, not real ES
// modules). Every other legacy page (canned, certs, contactlists, dataact,
// dnclists, apps) reads window.SUBS_API_BASE at call time instead of its
// own hardcoded literal, so swapping the one assignment inside scripts.ts
// is enough to redirect all of them together — see backend.ts for the
// VITE_API_BASE override this mirrors.
function withApiBase(script: string): string {
  return API_BASE === DEPLOYED_API_BASE ? script : script.split(DEPLOYED_API_BASE).join(API_BASE);
}

declare global {
  interface Window {
    __showOrgSettings?: () => void;
    __hideOrgSettings?: () => void;
    __showPurchases?: () => void;
    __hidePurchases?: () => void;
    __showAuditLog?: () => void;
    __hideAuditLog?: () => void;
    __showPeople?: () => void;
    __hidePeople?: () => void;
    __showRoles?: () => void;
    __hideRoles?: () => void;
    __showDivisions?: () => void;
    __hideDivisions?: () => void;
    __showGroups?: () => void;
    __hideGroups?: () => void;
    __showSkills?: () => void;
    __hideSkills?: () => void;
    __showLangs?: () => void;
    __hideLangs?: () => void;
    __showLicences?: () => void;
    __hideLicences?: () => void;
    __showSso?: () => void;
    __hideSso?: () => void;
    __showOauth?: () => void;
    __hideOauth?: () => void;
    __showRecpol?: () => void;
    __hideRecpol?: () => void;
    __showEvalforms?: () => void;
    __hideEvalforms?: () => void;
    __showCalibrations?: () => void;
    __hideCalibrations?: () => void;
    __showForecasts?: () => void;
    __hideForecasts?: () => void;
    __registerCustomPage?: (id: string, show: () => void, hide: () => void) => void;
  }
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MCM Cloud CX — Experience Platform" },
      {
        name: "description",
        content:
          "MCM Cloud CX admin console: directory, activity, performance, telephony, routing and WEM tools.",
      },
      { property: "og:title", content: "MCM Cloud CX — Experience Platform" },
      {
        property: "og:description",
        content:
          "Admin console for MCM Cloud CX: people, queues, flows, telephony and quality management.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: McmCloudCx,
});

// Mounts a page as its OWN isolated React root inside a legacy container
// (not as a child of McmCloudCx). McmCloudCx renders once via
// dangerouslySetInnerHTML and is then driven entirely by the legacy
// imperative script — letting it re-render for any reason would reset that
// HTML back to defaults, wiping out everything the legacy script has done
// since. Returns {show, hide} to wire up to the legacy router.
function mountLegacyReactPage(containerId: string, element: ReactNode) {
  let root: Root | null = null;
  const queryClient = new QueryClient();

  const show = () => {
    const cnt = document.getElementById("cnt");
    const container = document.getElementById(containerId);
    if (cnt) cnt.style.display = "none";
    if (!container) return;
    container.style.display = "";
    if (!root) root = createRoot(container);
    root.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
  };

  const hide = () => {
    const cnt = document.getElementById("cnt");
    const container = document.getElementById(containerId);
    if (container) container.style.display = "none";
    if (cnt) cnt.style.display = "";
  };

  return { show, hide };
}

function McmCloudCx() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const orgSettings = mountLegacyReactPage("orgsetRoot", <OrganizationSettingsPage />);
    window.__showOrgSettings = orgSettings.show;
    window.__hideOrgSettings = orgSettings.hide;

    const purchases = mountLegacyReactPage("purchRoot", <PurchasesPage />);
    window.__showPurchases = purchases.show;
    window.__hidePurchases = purchases.hide;

    const auditLog = mountLegacyReactPage("auditlogRoot", <AuditLogPage />);
    window.__showAuditLog = auditLog.show;
    window.__hideAuditLog = auditLog.hide;

    const people = mountLegacyReactPage("peopleRoot", <PeoplePage />);
    window.__showPeople = people.show;
    window.__hidePeople = people.hide;

    const roles = mountLegacyReactPage("rolesRoot", <RolesPage />);
    window.__showRoles = roles.show;
    window.__hideRoles = roles.hide;

    const divisions = mountLegacyReactPage("divisionsRoot", <DivisionsPage />);
    window.__showDivisions = divisions.show;
    window.__hideDivisions = divisions.hide;

    const groups = mountLegacyReactPage("groupsRoot", <GroupsPage />);
    window.__showGroups = groups.show;
    window.__hideGroups = groups.hide;

    const skills = mountLegacyReactPage("skillsRoot", <SkillsPage />);
    window.__showSkills = skills.show;
    window.__hideSkills = skills.hide;

    const langs = mountLegacyReactPage("langsRoot", <LangsPage />);
    window.__showLangs = langs.show;
    window.__hideLangs = langs.hide;

    const licences = mountLegacyReactPage("licencesRoot", <LicencesPage />);
    window.__showLicences = licences.show;
    window.__hideLicences = licences.hide;

    const sso = mountLegacyReactPage("ssoRoot", <SsoPage />);
    window.__showSso = sso.show;
    window.__hideSso = sso.hide;

    const oauth = mountLegacyReactPage("oauthRoot", <OAuthClientsPage />);
    window.__showOauth = oauth.show;
    window.__hideOauth = oauth.hide;

    const recpol = mountLegacyReactPage("recpolRoot", <RecordingPoliciesPage />);
    window.__showRecpol = recpol.show;
    window.__hideRecpol = recpol.hide;

    const evalforms = mountLegacyReactPage("evalformsRoot", <EvaluationFormsPage />);
    window.__showEvalforms = evalforms.show;
    window.__hideEvalforms = evalforms.hide;

    const calibrations = mountLegacyReactPage("calibrationsRoot", <CalibrationsPage />);
    window.__showCalibrations = calibrations.show;
    window.__hideCalibrations = calibrations.hide;

    const forecasts = mountLegacyReactPage("forecastsRoot", <ForecastsPage />);
    window.__showForecasts = forecasts.show;
    window.__hideForecasts = forecasts.hide;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.textContent = withApiBase(MCM_SCRIPT);
    document.body.appendChild(script);

    // Shared router for every migrated real-React page (recpol, evalforms,
    // ...) — must run right after MCM_SCRIPT (window.openPage must already
    // exist) and before any *-redesign.ts script below that registers a page
    // with it. See mcm/custom-pages-router.ts.
    const customPagesRouterScript = document.createElement("script");
    customPagesRouterScript.type = "text/javascript";
    customPagesRouterScript.textContent = CUSTOM_PAGES_ROUTER_SCRIPT;
    document.body.appendChild(customPagesRouterScript);

    // Validates a restored token on boot and clears the session on any
    // later 401, rather than leaving the UI silently wedged with a dead
    // token. Must run after MCM_SCRIPT (reads window.SUBS_API_BASE /
    // window.__authToken, which MCM_SCRIPT sets up). See mcm/session-guard.ts.
    const sessionGuardScript = document.createElement("script");
    sessionGuardScript.type = "text/javascript";
    sessionGuardScript.textContent = SESSION_GUARD_SCRIPT;
    document.body.appendChild(sessionGuardScript);

    // Runs after MCM_SCRIPT so window.SNAP already exists — it patches in
    // window.SNAP.authorg (the Authorized Organizations page content) the
    // same way the legacy script itself works, rather than through the
    // mountLegacyReactPage/REACT_PAGES system the pages above use.
    const authorgScript = document.createElement("script");
    authorgScript.type = "text/javascript";
    authorgScript.textContent = withApiBase(AUTHORG_SCRIPT);
    document.body.appendChild(authorgScript);

    const directoryScript = document.createElement("script");
    directoryScript.type = "text/javascript";
    directoryScript.textContent = withApiBase(DIRECTORY_SCRIPT);
    document.body.appendChild(directoryScript);

    // Same pattern as authorgScript above — patches window.SNAP.__apps (the
    // Apps > Installed page content) with backend-ready data and polished,
    // interactive cards after MCM_SCRIPT has set up window.SNAP.
    const appsScript = document.createElement("script");
    appsScript.type = "text/javascript";
    appsScript.textContent = APPS_SCRIPT;
    document.body.appendChild(appsScript);

    // Same pattern again — overrides scripts.ts's bare-bones
    // renderCannedFx/editCannedFx/saveCannedFx/delCannedFx with a fully
    // interactive, filterable, backend-ready Canned Responses page.
    const cannedScript = document.createElement("script");
    cannedScript.type = "text/javascript";
    cannedScript.textContent = CANNED_SCRIPT;
    document.body.appendChild(cannedScript);

    // Alert Rules + Adherence/WFM backend sync — wraps the window.*
    // functions MCM_SCRIPT already defined with API fetch/persist logic.
    const syncScript = document.createElement("script");
    syncScript.type = "text/javascript";
    syncScript.textContent = withApiBase(BACKEND_SYNC_SCRIPT);
    document.body.appendChild(syncScript);

    // Patches window.SNAP.certs (Digital Certificates) with real,
    // backend-connected data — same visual page, dead Search/Filter/
    // Upload/Delete actions made real. See mcm/certs-redesign.ts.
    const certsScript = document.createElement("script");
    certsScript.type = "text/javascript";
    certsScript.textContent = CERTS_SCRIPT;
    document.body.appendChild(certsScript);

    // Wraps window.openPage to intercept 'contactlists' — it's DYN4-routed
    // in scripts.ts (like 'canned' was DYN9-routed), so a plain
    // window.renderContactLists reassignment alone wouldn't be picked up.
    // See mcm/contactlists-redesign.ts.
    const contactListsScript = document.createElement("script");
    contactListsScript.type = "text/javascript";
    contactListsScript.textContent = CONTACTLISTS_SCRIPT;
    document.body.appendChild(contactListsScript);

    // Patches window.SNAP.dataact (Data Actions) with real, backend-
    // connected data — same visual page, dead Search/Filter/Create/Test/
    // Delete actions made real. See mcm/dataact-redesign.ts.
    const dataactScript = document.createElement("script");
    dataactScript.type = "text/javascript";
    dataactScript.textContent = DATAACT_SCRIPT;
    document.body.appendChild(dataactScript);

    // Wraps window.openPage to intercept 'dnclists' — it's DYN4-routed
    // in scripts.ts (like 'contactlists'), so a plain window.renderDnc
    // reassignment alone wouldn't be picked up. See mcm/dnclists-redesign.ts.
    const dncListsScript = document.createElement("script");
    dncListsScript.type = "text/javascript";
    dncListsScript.textContent = DNCLISTS_SCRIPT;
    document.body.appendChild(dncListsScript);

    // Wraps window.renderSubsFx to drop the billing banner's own duplicate
    // "Manage Plan" button after every render — the light-themed banner
    // and de-emphasized KPI cards are pure CSS (see mcm.css). See
    // mcm/subscription-redesign.ts.
    const subscriptionScript = document.createElement("script");
    subscriptionScript.type = "text/javascript";
    subscriptionScript.textContent = SUBSCRIPTION_SCRIPT;
    document.body.appendChild(subscriptionScript);

    // Registers the real Recording Policies page with the shared custom-pages
    // router (mcm/custom-pages-router.ts) — 'recpol' is DYN7-routed in
    // scripts.ts, so a plain window.__showRecpol assignment alone wouldn't
    // be picked up. See mcm/recpol-redesign.ts.
    const recpolScript = document.createElement("script");
    recpolScript.type = "text/javascript";
    recpolScript.textContent = RECPOL_SCRIPT;
    document.body.appendChild(recpolScript);

    // Same pattern for Evaluation Forms. See mcm/evalforms-redesign.ts.
    const evalformsScript = document.createElement("script");
    evalformsScript.type = "text/javascript";
    evalformsScript.textContent = EVALFORMS_SCRIPT;
    document.body.appendChild(evalformsScript);

    // Same pattern for Calibrations. See mcm/calibrations-redesign.ts.
    const calibrationsScript = document.createElement("script");
    calibrationsScript.type = "text/javascript";
    calibrationsScript.textContent = CALIBRATIONS_SCRIPT;
    document.body.appendChild(calibrationsScript);

    // Same pattern for Forecasts. See mcm/forecasts-redesign.ts.
    const forecastsScript = document.createElement("script");
    forecastsScript.type = "text/javascript";
    forecastsScript.textContent = FORECASTS_SCRIPT;
    document.body.appendChild(forecastsScript);

    // Re-assert the toast bridge (see lib/global-toast.tsx) now that
    // MCM_SCRIPT has run and defined its own window.toast — this call is
    // what actually wins, since it runs after scripts.ts's assignment
    // above, not routes/__root.tsx's earlier baseline call.
    bridgeGlobalToast();
  }, []);

  return <div id="mcm-app" dangerouslySetInnerHTML={{ __html: MCM_HTML }} />;
}
