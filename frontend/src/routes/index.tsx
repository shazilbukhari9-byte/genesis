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
import { PROMPTS_SCRIPT } from "../mcm/prompts-redesign";
import { EMERGENCY_SCRIPT } from "../mcm/emergency-redesign";
import { BOTS_SCRIPT } from "../mcm/bots-redesign";
import { FLOWS_SCRIPT } from "../mcm/flows-redesign";
import { CALLROUTING_SCRIPT } from "../mcm/callrouting-redesign";
import { GALLERY_SCRIPT } from "../mcm/gallery-redesign";
import { RESPONSIVE_SCRIPT } from "../mcm/responsive-redesign";
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

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.textContent = MCM_SCRIPT;
    document.body.appendChild(script);

    // Dev-only: point every mcm/*-redesign.ts page at the local backend.
    // MCM_SCRIPT (above) unconditionally hardcodes window.SUBS_API_BASE to
    // production (https://genesis-yysv.onrender.com), so this has to run
    // after it, not before. Production predates several schema columns
    // added since (e.g. prompts.audio_data) and this project has no deploy
    // access to run those migrations there, so audio uploads and the new
    // Architect/Call Routing/Emergency Groups demo data silently no-op
    // against it. The local backend has the full current schema.
    if (import.meta.env.DEV) {
      (window as any).SUBS_API_BASE = "http://127.0.0.1:5000";
    }

    // Runs after MCM_SCRIPT so window.SNAP already exists — it patches in
    // window.SNAP.authorg (the Authorized Organizations page content) the
    // same way the legacy script itself works, rather than through the
    // mountLegacyReactPage/REACT_PAGES system the pages above use.
    const authorgScript = document.createElement("script");
    authorgScript.type = "text/javascript";
    authorgScript.textContent = AUTHORG_SCRIPT;
    document.body.appendChild(authorgScript);

    const directoryScript = document.createElement("script");
    directoryScript.type = "text/javascript";
    directoryScript.textContent = DIRECTORY_SCRIPT;
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
    syncScript.textContent = BACKEND_SYNC_SCRIPT;
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

    // Patches window.SNAP.prompts (Prompts) with real, backend-connected
    // data — same visual page, dead Add/Export/row-edit made real, no
    // more single shared "Saved — prototype only" stub. See
    // mcm/prompts-redesign.ts.
    const promptsScript = document.createElement("script");
    promptsScript.type = "text/javascript";
    promptsScript.textContent = PROMPTS_SCRIPT;
    document.body.appendChild(promptsScript);

    // Patches window.renderEmergencyFx (Emergency Groups) with a real
    // "+ Add Group" (was a static toast, no create action at all). See
    // mcm/emergency-redesign.ts.
    const emergencyScript = document.createElement("script");
    emergencyScript.type = "text/javascript";
    emergencyScript.textContent = EMERGENCY_SCRIPT;
    document.body.appendChild(emergencyScript);

    // Adds a real Edit drawer to Bot Connectors rows (was Add/Delete
    // only — no way to view or change an existing connector). See
    // mcm/bots-redesign.ts.
    const botsScript = document.createElement("script");
    botsScript.type = "text/javascript";
    botsScript.textContent = BOTS_SCRIPT;
    document.body.appendChild(botsScript);

    // Makes Architect's Publish button persist the flow graph/status to
    // the backend (was local-only — reverted on reload). See
    // mcm/flows-redesign.ts.
    const flowsScript = document.createElement("script");
    flowsScript.type = "text/javascript";
    flowsScript.textContent = FLOWS_SCRIPT;
    document.body.appendChild(flowsScript);

    // Makes Call Routing (the "Call Routing" button on the Flows page)
    // real: Edit, Enable/Disable, search/filters/pagination, and a
    // schedule/division/queue-fallback editor, replacing what was a
    // bare Create+Delete list with no other controls. See
    // mcm/callrouting-redesign.ts.
    const callRoutingScript = document.createElement("script");
    callRoutingScript.type = "text/javascript";
    callRoutingScript.textContent = CALLROUTING_SCRIPT;
    document.body.appendChild(callRoutingScript);

    // Makes the Screen Gallery's search, category filter, Refresh, and
    // Back (the breadcrumb) real, and fixes 4 blank workspace-tile
    // thumbnails and a filter-to-zero-results blank page. See
    // mcm/gallery-redesign.ts.
    const galleryScript = document.createElement("script");
    galleryScript.type = "text/javascript";
    galleryScript.textContent = GALLERY_SCRIPT;
    document.body.appendChild(galleryScript);

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

    // Adds the sidebar hamburger toggle (no page-specific dependency —
    // runs after everything else so #top already exists). See
    // mcm/responsive-redesign.ts and mcm.css's "RESPONSIVE" section.
    const responsiveScript = document.createElement("script");
    responsiveScript.type = "text/javascript";
    responsiveScript.textContent = RESPONSIVE_SCRIPT;
    document.body.appendChild(responsiveScript);

    // Re-assert the toast bridge (see lib/global-toast.tsx) now that
    // MCM_SCRIPT has run and defined its own window.toast — this call is
    // what actually wins, since it runs after scripts.ts's assignment
    // above, not routes/__root.tsx's earlier baseline call.
    bridgeGlobalToast();
  }, []);

  return <div id="mcm-app" dangerouslySetInnerHTML={{ __html: MCM_HTML }} />;
}
