import type { ReactNode } from "react";

import { LegacyBtn } from "./LegacyBtn";
import { LegacyDrawer } from "./LegacyDrawer";

// Styled replacement for window.confirm() — matches the app's own
// "Please confirm" pattern (scripts.ts's confirmBox()) instead of the
// browser's native popup, which looked out of place next to every other
// dialog in the app.
//
// Split into two exports on purpose:
//  - ConfirmDialogBox: just the #drw box itself, no #scrim/portal. Used
//    when a drawer that already has its own #scrim + portal needs to swap
//    its content for a confirm prompt (see e.g. RecordingPoliciesPage's
//    PolicyDrawer) — rendering a SECOND #scrim/#drw alongside the first
//    produced two elements sharing the same id at once, which is the exact
//    duplicate-id class of bug already hit once with the Help panel.
//    Swapping content in place keeps exactly one #drw in the DOM.
//  - ConfirmDialog: the full standalone version (adds its own portal +
//    scrim) for a confirm prompt with no existing drawer context.
export function ConfirmDialogBox({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div id="drw" style={{ height: "auto", top: "30%", bottom: "auto", borderRadius: "8px 0 0 8px" }}>
      <div className="dh">
        <h2>Please confirm</h2>
        <div className="x" onClick={onCancel}>×</div>
      </div>
      <div className="db">
        <div style={{ fontSize: 13, color: "#33425c", lineHeight: 1.6 }}>{message}</div>
      </div>
      <div className="df">
        <LegacyBtn secondary onClick={onCancel}>Cancel</LegacyBtn>
        <LegacyBtn onClick={onConfirm}>{confirmLabel ?? "Confirm"}</LegacyBtn>
      </div>
    </div>
  );
}

export function ConfirmDialog(props: {
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <LegacyDrawer>
      <div id="scrim" onClick={props.onCancel} />
      <ConfirmDialogBox {...props} />
    </LegacyDrawer>
  );
}
