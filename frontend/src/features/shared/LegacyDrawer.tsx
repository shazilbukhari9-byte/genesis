import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// Portals into a dedicated container rather than <body> itself. A dozen-plus
// legacy vanilla-JS modules (authorg-redesign.ts, apps-redesign.ts,
// contactlists-redesign.ts, dataact-redesign.ts, dnclists-redesign.ts,
// certs-redesign.ts, canned-redesign.ts, directory-redesign.ts,
// responsive-nav.ts, ...) call document.body.appendChild for their own
// scrims/modals/toasts, completely outside React's knowledge. Portaling
// straight into <body> put React's portal-managed nodes as *siblings* of
// all that raw DOM churn — when one of those scripts inserted or removed a
// node at the wrong moment relative to a drawer unmounting, React's internal
// bookkeeping of "the node after mine" went stale and the next removeChild
// call threw "NotFoundError: the node to be removed is not a child of this
// node", which (uncaught) unmounted the whole page — reproduced live on the
// Evaluation Forms page. Giving React its own container that nothing else
// ever touches removes the interference entirely; multiple independent
// React roots' portals safely share one container (a common pattern — e.g.
// a single #modal-root for a whole app), so this works fine across the
// several separate roots mountLegacyReactPage creates.
function getPortalRoot(): HTMLElement {
  let el = document.getElementById("legacy-drawer-portal-root");
  if (!el) {
    el = document.createElement("div");
    el.id = "legacy-drawer-portal-root";
    document.body.appendChild(el);
  }
  return el;
}

// Renders its children (a #scrim + #drw pair) via a portal instead of
// wherever the calling component happens to be mounted (features/quality/
// *Page.tsx components render inside a persistent #xRoot container — see
// routes/index.tsx's mountLegacyReactPage). #drw has position:fixed and a
// z-index (140) higher than the top bar's (100), which on paper should
// already put it above everything — but in practice clicks/hit-testing at
// the drawer header's own coordinates were landing on the top bar's search
// input instead of the drawer, a real, reproducible stacking issue.
// Portaling out of the ancestor chain is the standard fix for that (same
// reasoning any modal/dropdown library uses it for).
export function LegacyDrawer({ children }: { children: ReactNode }) {
  return createPortal(children, getPortalRoot());
}
