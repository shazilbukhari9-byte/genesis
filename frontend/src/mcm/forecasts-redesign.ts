/* ============================================================
   MCM Cloud CX — Forecasts router wiring
   Unlike Recording Policies/Evaluation Forms/Calibrations, Forecasts
   was already a REAL, working, backend-synced feature in scripts.ts
   (window.renderForecastFx + editPG/savePG/editSG/saveSG/genForecast,
   DYN12-routed to 'forecast', synced to /api/planning-groups,
   /api/service-goals, /api/forecasts). This migrates that same logic
   to a real React page (features/quality/ForecastsPage.tsx) — a
   faithful port preserving the generation algorithm, not a redesign —
   and registers it with the shared custom-pages router (see
   mcm/custom-pages-router.ts) so it takes over from DYN12 cleanly.
   ============================================================ */

export const FORECASTS_SCRIPT: string = `
(function() {
  'use strict';
  window.__registerCustomPage('forecast',
    function() { if (window.__showForecasts) window.__showForecasts(); },
    function() { if (window.__hideForecasts) window.__hideForecasts(); }
  );
})();
`;
