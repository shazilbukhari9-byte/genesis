// Renders the exact same "Help & Resources" panel the legacy pages show,
// by calling straight into the legacy window.renderHelp(topicKey) — same
// markup, same topics/keywords/videos data. This keeps the panel
// byte-for-byte identical without duplicating its content here (and
// staying in sync if the legacy HELP data ever changes).
//
// renderHelp()'s own markup hardcodes id="helpb"/id="helpcx" and a shared
// window.toggleHelp() that does document.getElementById('helpb'). That's
// fine when only one help panel exists in the DOM at a time, but every
// migrated page (this one included) keeps its React root mounted with
// display:none rather than actually unmounting it when you navigate away
// — so after visiting a few pages, there are that many duplicate
// id="helpb" elements in the DOM simultaneously. getElementById always
// returns the *first* match in DOM order, so clicking "Hide" on the
// panel you're actually looking at can silently toggle a different,
// hidden page's element instead — which is what caused the layout to
// visibly jump/shrink: the wrong panel's height was collapsing.
// Fixed by scoping the ids per topicKey and swapping the shared
// toggleHelp() for one bound to just this instance's ids.
declare global {
  interface Window {
    __toggleHelpScoped?: (bodyId: string, labelId: string) => void;
  }
}

if (typeof window !== "undefined" && !window.__toggleHelpScoped) {
  window.__toggleHelpScoped = (bodyId, labelId) => {
    const body = document.getElementById(bodyId);
    const label = document.getElementById(labelId);
    if (!body) return;
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "" : "none";
    if (label) label.textContent = isHidden ? "Hide" : "Show";
  };
}

export function LegacyHelpPanel({ topicKey }: { topicKey: string }) {
  const renderHelp = (window as unknown as { renderHelp?: (id: string) => string }).renderHelp;
  const rawHtml = renderHelp?.(topicKey) ?? "";
  if (!rawHtml) return null;

  const bodyId = `helpb-${topicKey}`;
  const labelId = `helpcx-${topicKey}`;
  const html = rawHtml
    .replace('id="helpb"', `id="${bodyId}"`)
    .replace('id="helpcx"', `id="${labelId}"`)
    .replace('onclick="toggleHelp()"', `onclick="window.__toggleHelpScoped('${bodyId}','${labelId}')"`);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
