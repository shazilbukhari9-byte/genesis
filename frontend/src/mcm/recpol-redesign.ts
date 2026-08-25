/* ============================================================
   MCM Cloud CX — Recording Policies router wiring
   Recording Policies was migrated to a real React page
   (features/quality/RecordingPoliciesPage.tsx) backed by the real
   /api/recording-policies endpoint. scripts.ts still DYN7-routes
   'recpol' to its old window.renderRecpol implementation, so this
   registers the real page with the shared custom-pages router (see
   mcm/custom-pages-router.ts) instead — that router already handles
   hiding every other React root when 'recpol' opens, and hiding
   'recpol' again when the user navigates elsewhere.
   ============================================================ */

export const RECPOL_SCRIPT: string = `
(function() {
  'use strict';
  window.__registerCustomPage('recpol',
    function() { if (window.__showRecpol) window.__showRecpol(); },
    function() { if (window.__hideRecpol) window.__hideRecpol(); }
  );
})();
`;
