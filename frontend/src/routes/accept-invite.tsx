import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { apiFetch } from "../features/shared/backend";

export const Route = createFileRoute("/accept-invite")({
  head: () => ({
    meta: [{ title: "Accept invite — MCM Cloud CX" }],
  }),
  component: AcceptInvitePage,
});

type InviteInfo = { name: string; email: string };
type Status = "loading" | "ready" | "invalid" | "submitting" | "done";

function AcceptInvitePage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(t);
    if (!t) {
      setError("This invite link is missing its token — check you copied the whole URL.");
      setStatus("invalid");
      return;
    }
    apiFetch<InviteInfo>("/api/auth/invite-info", { method: "POST", body: JSON.stringify({ token: t }) })
      .then((res) => {
        setInfo(res);
        setStatus("ready");
      })
      .catch((e: Error) => {
        setError(e.message || "This invite link is invalid or has expired.");
        setStatus("invalid");
      });
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setStatus("submitting");
    apiFetch<{ token: string }>("/api/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    })
      .then(() => setStatus("done"))
      .catch((e: Error) => {
        setError(e.message || "Could not activate your account — try again.");
        setStatus("ready");
      });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            MCM
          </div>
          <h1 className="text-xl font-semibold text-foreground">Set up your account</h1>
        </div>

        {status === "loading" && <p className="text-center text-sm text-muted-foreground">Checking your invite…</p>}

        {status === "invalid" && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
            <div className="mt-3">
              <a href="/" className="font-medium underline">
                Go to sign in
              </a>
            </div>
          </div>
        )}

        {status === "done" && (
          <div className="rounded-md border border-input bg-card px-4 py-4 text-center text-sm">
            <p className="mb-3 text-foreground">Your account is set up. You can sign in now.</p>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in
            </a>
          </div>
        )}

        {(status === "ready" || status === "submitting") && info && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              Hi <b>{info.name}</b> — set a password for <b>{info.email}</b> to activate your account.
            </p>
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={status === "submitting"}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {status === "submitting" ? "Activating…" : "Activate account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
