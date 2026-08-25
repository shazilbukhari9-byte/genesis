/* ============================================================
   MCM Cloud CX — Calibrations router wiring
   Calibrations never had a working implementation anywhere — the
   reference prototype's "+ New Calibration" button calls
   drawer('calib') directly (drawer() expects an HTML string, not a
   page id — a dead no-op), and there is no window.renderCalib of any
   kind. The backend (calibrations table + /api/calibrations) was
   already built with no frontend ever wired to it (see
   database/schema.sql's comment on that table). This registers a
   real React page (features/quality/CalibrationsPage.tsx) with the
   shared custom-pages router — see mcm/custom-pages-router.ts.
   ============================================================ */

export const CALIBRATIONS_SCRIPT: string = `
(function() {
  'use strict';
  window.__registerCustomPage('calib',
    function() { if (window.__showCalibrations) window.__showCalibrations(); },
    function() { if (window.__hideCalibrations) window.__hideCalibrations(); }
  );
})();
`;
