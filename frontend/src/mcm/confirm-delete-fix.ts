/* ============================================================
   MCM Cloud CX — Delete Confirmation Backend Fix
   scripts.ts already wires window.__armConfirmDelete into 18 different
   delXxx() functions (Queues, Wrap-up Codes, Schedules, Trunks, Flows,
   Call Routes, Groups, Edges, Campaigns, Recording Policies, Domains,
   and more) with the same shape:

     var disarm = (dbId && window.__authToken)
       ? window.__armConfirmDelete(function(){ fetch(...DELETE...); })
       : null;
     origDelXxx(id);   // shows the "Please confirm" dialog synchronously
     if (disarm) disarm();

   window.__armConfirmDelete's original implementation temporarily swaps
   out window.confirmBox, betting that origDelXxx's confirm dialog is
   opened by calling window.confirmBox(msg, onYes). It isn't: scripts.ts
   is really 9 separate top-level IIFEs concatenated together, each with
   its own local `function confirmBox(msg, onYes)` declaration — the bare
   `confirmBox(...)` call inside any given delXxx resolves lexically to
   that IIFE's own local function, never to the window property. So the
   swapped-in confirmBox is simply never invoked: the dialog still shows
   and "Yes" still deletes the row locally (that part didn't need
   window.confirmBox at all), but afterConfirm() — the actual backend
   DELETE — never fires. Every one of those 18 deletes today removes the
   row from the screen and leaves it sitting in the database.

   Fix: don't try to intercept which function opens the dialog. All 9
   confirmBox copies render byte-for-byte the same markup with a stable
   `id="cfyes"` Confirm button and bind its onclick themselves — see
   scripts.ts's own `document.getElementById('cfyes').onclick=function()
   {window.closeDrawer();onYes();}`. Since disarm() already runs
   synchronously right after origDelXxx(id) has created that button,
   __armConfirmDelete is redefined here to return a binder instead of a
   revert: disarm() now attaches a second, independent click listener to
   the just-created #cfyes that fires afterConfirm(). No change needed at
   any of the 18 call sites — they already call `if(disarm)disarm()` in
   exactly the right place.
   ============================================================ */

export const CONFIRM_DELETE_FIX_SCRIPT: string = `
(function() {
  'use strict';
  if (window.__confirmDeleteFixed) return;
  window.__confirmDeleteFixed = true;

  window.__armConfirmDelete = function(afterConfirm) {
    return function bindToConfirmButton() {
      var btn = document.getElementById('cfyes');
      if (!btn) return; // origDelXxx didn't open a confirm dialog this time
      btn.addEventListener('click', function() { afterConfirm(); }, { once: true });
    };
  };
})();
`;
