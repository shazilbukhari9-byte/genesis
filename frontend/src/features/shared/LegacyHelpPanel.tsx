// Renders the exact same "Help & Resources" panel the legacy pages show,
// by calling straight into the legacy window.renderHelp(topicKey) — same
// markup, same topics/keywords/videos data, same show/hide toggle. This
// keeps the panel byte-for-byte identical without duplicating its content
// here (and staying in sync if the legacy HELP data ever changes).
export function LegacyHelpPanel({ topicKey }: { topicKey: string }) {
  const renderHelp = (window as unknown as { renderHelp?: (id: string) => string }).renderHelp;
  const html = renderHelp?.(topicKey) ?? "";
  if (!html) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
