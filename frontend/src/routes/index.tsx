import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import "../mcm/mcm.css";
import { MCM_HTML } from "../mcm/markup";
import { MCM_SCRIPT } from "../mcm/scripts";
import { AUTHORG_SCRIPT } from "../mcm/authorg-redesign";
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

    // Runs after MCM_SCRIPT so window.SNAP already exists — it patches in
    // window.SNAP.authorg (the Authorized Organizations page content) the
    // same way the legacy script itself works, rather than through the
    // mountLegacyReactPage/REACT_PAGES system the pages above use.
    const authorgScript = document.createElement("script");
    authorgScript.type = "text/javascript";
    authorgScript.textContent = AUTHORG_SCRIPT;
    document.body.appendChild(authorgScript);
  }, []);

  return <div id="mcm-app" dangerouslySetInnerHTML={{ __html: MCM_HTML }} />;
}
