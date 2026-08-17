/* ============================================================
   MCM Cloud CX — People & Permissions Bridge
   Mounts the real React <PeoplePage/> feature module into the
   legacy vanilla-JS shell's #cnt container.

   The shell's REACT_PAGES registry (see scripts.ts) already
   dispatches 'people' navigation to window.__showPeople /
   window.__hidePeople instead of the old renderPeople() string
   renderer — this module just supplies those two hooks.
   ============================================================ */

import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PeoplePage } from "../features/people-permissions/PeoplePage";

const MOUNT_ID = "people-react-root";

// Self-contained: PeoplePage only talks to its own localStorage-backed
// store, so a dedicated QueryClient (rather than the route tree's) is fine.
const peopleQueryClient = new QueryClient();

let activeRoot: Root | null = null;

function unmountPeople(): void {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
}

function mountPeople(): void {
  // Re-clicking "People" while already on it calls __showPeople again
  // without an intervening __hidePeople, so guard against a leaked root.
  unmountPeople();
  const cnt = document.getElementById("cnt");
  if (!cnt) return;
  cnt.innerHTML = `<div id="${MOUNT_ID}"></div>`;
  const container = document.getElementById(MOUNT_ID);
  if (!container) return;
  activeRoot = createRoot(container);
  activeRoot.render(
    <QueryClientProvider client={peopleQueryClient}>
      <PeoplePage />
    </QueryClientProvider>,
  );
}

type LegacyWindow = Window & {
  __showPeople?: () => void;
  __hidePeople?: () => void;
};

// Wires the legacy shell to the React feature module and returns a cleanup
// function that restores everything it touched.
export function installPeopleBridge(): () => void {
  const win = window as unknown as LegacyWindow;
  win.__showPeople = mountPeople;
  win.__hidePeople = unmountPeople;

  // Safety net for legacy nav paths that swap #cnt's contents without going
  // through the REACT_PAGES-aware openPage() (e.g. window.go() switching
  // top-level views) — if the mount node disappears from under us, unmount
  // instead of leaking the root.
  const observer = new MutationObserver(() => {
    if (activeRoot && !document.getElementById(MOUNT_ID)) unmountPeople();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    unmountPeople();
    if (win.__showPeople === mountPeople) delete win.__showPeople;
    if (win.__hidePeople === unmountPeople) delete win.__hidePeople;
  };
}
