import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ToastContainer, toast as toastify, type Id } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { bridgeGlobalToast } from "../lib/global-toast";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      { name: "description", content: "Lovable Generated Project" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      { property: "og:description", content: "Lovable Generated Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// react-toastify's `stacked` mode renders each toast as a card in a single
// deck — newest on top, older ones collapsed behind it showing only a thin
// sliver of edge (see .Toastify__toast--stacked rules in styles.css) —
// rather than piling full-height toasts one under another. That's what
// "overlapping based on time" and "swipe to dismiss and see next" need:
// dismissing (click, autoClose, or the built-in swipe from `draggable`)
// the top card animates the next one into place, so N alerts can never
// add up to N toast-heights of screen the way plain stacking did.
function useActiveToastCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const activeIds = new Set<Id>();
    const unsubscribe = toastify.onChange((item) => {
      if (item.status === "added") activeIds.add(item.id);
      else if (item.status === "removed") activeIds.delete(item.id);
      setCount(activeIds.size);
    });
    return unsubscribe;
  }, []);
  return count;
}

// The reserved gap above the deck exists so the "Clear all" pill always has
// somewhere to sit that isn't underneath the top toast card. Gating this on
// count (only reserving it for 2+) was tried first, but that just traded
// "dead space above a single toast" for "no way to clear the one toast
// that's there" -- reserving it whenever a toast exists, and showing the
// pill every time too, means the space is always doing something.
function useToastActiveFlag() {
  const count = useActiveToastCount();
  useEffect(() => {
    document.documentElement.toggleAttribute("data-toast-active", count >= 1);
  }, [count]);
  return count;
}

// "Clear all" is not a built-in react-toastify control — toast.dismiss()
// with no id dismisses every active toast. Shown for any active toast (not
// just 2+) so it's a reliable, always-in-the-same-place control rather than
// something that only sometimes exists -- and it names the count outright
// rather than relying on how visible the collapsed cards' peeking edges are.
function ClearAllToasts() {
  const count = useToastActiveFlag();
  if (count < 1) return null;
  const label = count === 1 ? "1 notification" : `${count} notifications`;
  return (
    <button
      type="button"
      className="mcm-toast-clear-all"
      onClick={() => toastify.dismiss()}
    >
      {label} · Clear all
    </button>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const bridgedRef = useRef(false);

  useEffect(() => {
    if (bridgedRef.current) return;
    bridgedRef.current = true;
    // Runs after the route tree's own mount effects (see bridgeGlobalToast's
    // comment above) — in particular after scripts.ts has defined its own
    // window.toast, so this always overrides it, not the other way around.
    bridgeGlobalToast();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <ToastContainer
        position="top-right"
        stacked
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable
        theme="light"
        toastClassName="mcm-toast"
        // Bounds how many toasts can exist at once — the stacked deck itself
        // keeps the screen clear regardless of count, this is just a backstop
        // against an unbounded pile-up if alerts fire faster than autoClose.
        limit={8}
      />
      <ClearAllToasts />
    </QueryClientProvider>
  );
}
