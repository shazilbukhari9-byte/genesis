import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// Renders its children (a #scrim + #drw pair) directly under <body> via a
// portal instead of wherever the calling component happens to be mounted
// (features/quality/*Page.tsx components render inside a persistent
// #xRoot container — see routes/index.tsx's mountLegacyReactPage). #drw
// has position:fixed and a z-index (140) higher than the top bar's (100),
// which on paper should already put it above everything — but in practice
// clicks/hit-testing at the drawer header's own coordinates were landing
// on the top bar's search input instead of the drawer, a real, reproducible
// stacking issue. Portaling to <body> is the standard fix for this whole
// class of bug (same reasoning any modal/dropdown library uses it for) —
// it removes the ancestor chain entirely rather than trying to out-guess
// which ancestor was trapping the stacking context.
export function LegacyDrawer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
