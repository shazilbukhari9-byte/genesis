import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import "../mcm/mcm.css";
import { MCM_HTML } from "../mcm/markup";
import { MCM_SCRIPT } from "../mcm/scripts";
import { OrganizationSettingsPage } from "../features/org-settings/OrganizationSettingsPage";
import { AuditLogPage } from "../features/audit-log/AuditLogPage";

declare global {
  interface Window {
    __showOrgSettings?: () => void;
    __hideOrgSettings?: () => void;
    __showAuditLog?: () => void;
    __hideAuditLog?: () => void;
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

    const auditLog = mountLegacyReactPage("auditlogRoot", <AuditLogPage />);
    window.__showAuditLog = auditLog.show;
    window.__hideAuditLog = auditLog.hide;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.textContent = MCM_SCRIPT;
    document.body.appendChild(script);
  }, []);

  return <div id="mcm-app" dangerouslySetInnerHTML={{ __html: MCM_HTML }} />;
}
