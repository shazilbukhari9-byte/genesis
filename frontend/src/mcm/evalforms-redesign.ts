/* ============================================================
   MCM Cloud CX — Evaluation Forms router wiring
   Evaluation Forms was migrated to a real React page
   (features/quality/EvaluationFormsPage.tsx) backed by the real
   /api/eval-forms and /api/evals endpoints. scripts.ts still
   DYN7-routes 'evalforms' to its old window.renderEvalforms
   implementation (a 100% in-memory prototype — see the audit that
   preceded this file), so this registers the real page with the
   shared custom-pages router (see mcm/custom-pages-router.ts)
   instead of hand-rolling another window.openPage wrapper.
   ============================================================ */

export const EVALFORMS_SCRIPT: string = `
(function() {
  'use strict';
  window.__registerCustomPage('evalforms',
    function() { if (window.__showEvalforms) window.__showEvalforms(); },
    function() { if (window.__hideEvalforms) window.__hideEvalforms(); }
  );
})();
`;
