// window.toast is the legacy engine's global toast (MCM_SCRIPT), shared
// across the vanilla-JS pages and every React page mounted alongside them.
export function toast(message: string): void {
  (window as unknown as { toast?: (m: string) => void }).toast?.(message);
}
