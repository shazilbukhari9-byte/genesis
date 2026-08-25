import { toast as toastify } from "react-toastify";

// Global toast bridge (Section: Unify toast notifications). The legacy MCM
// engine (frontend/src/mcm/scripts.ts) and every module built on top of it
// (authorg-redesign.ts, apps-redesign.ts, directory-redesign.ts, ...) all
// call window.toast(message) — previously a bottom-center DOM toast defined
// inside scripts.ts itself. This repoints window.toast to react-toastify
// instead, without touching any of those files.
//
// scripts.ts's own `window.toast = function(m){...}` runs inside routes/
// index.tsx's mount effect, which — because that route's component is
// lazy-loaded (tsr-split) — actually commits AFTER routes/__root.tsx's own
// mount effect, not before. So bridgeGlobalToast() is called from BOTH
// places: once in __root.tsx for an early baseline (covers any toast call
// before the MCM page's scripts finish loading), and once again in
// index.tsx right after its last legacy <script> tag is appended, which is
// the call that actually wins the "last assignment" race against
// scripts.ts and makes the override stick.
export type ToastKind = "success" | "error" | "warning" | "info" | "default";

function inferToastKind(message: string): ToastKind {
  if (/^[✓✔]/.test(message)) return "success";
  if (/^[✗✕]/.test(message)) return "error";
  if (/^⚠/.test(message)) return "warning";
  if (/\berror\b|\bfailed\b/i.test(message)) return "error";
  return "default";
}

// Legacy callers embed simple HTML (<b>…</b>) in their messages — rendered
// as literal text by react-toastify by default. These are all developer-
// authored strings, never raw user input, so rendering them as HTML carries
// no more risk than the legacy toast's own t.innerHTML = m did.
function ToastMessage({ html }: { html: string }) {
  // eslint-disable-next-line react/no-danger
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function bridgeGlobalToast() {
  window.toast = (message: string, type?: ToastKind) => {
    const text = String(message ?? "");
    const kind = type ?? inferToastKind(text);
    const content = <ToastMessage html={text} />;
    // toastId keyed on the message text: react-toastify no-ops a toast()
    // call whose id is already showing, instead of stacking a duplicate.
    // Without this, retrying the same failing action (e.g. Save Card with
    // the same invalid input) piled up an identical toast on top of the
    // last one every click, since each call was otherwise a fresh toast.
    const options = { toastId: text };
    switch (kind) {
      case "success":
        toastify.success(content, options);
        break;
      case "error":
        toastify.error(content, options);
        break;
      case "warning":
        toastify.warn(content, options);
        break;
      case "info":
        toastify.info(content, options);
        break;
      default:
        toastify(content, options);
    }
  };
}

declare global {
  interface Window {
    toast?: (message: string, type?: ToastKind) => void;
  }
}
