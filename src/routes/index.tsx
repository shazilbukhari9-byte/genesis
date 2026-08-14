import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import "../mcm/mcm.css";
import { MCM_HTML } from "../mcm/markup";
import { MCM_SCRIPT } from "../mcm/scripts";

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

function McmCloudCx() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.textContent = MCM_SCRIPT;
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  return <div id="mcm-app" dangerouslySetInnerHTML={{ __html: MCM_HTML }} />;
}
