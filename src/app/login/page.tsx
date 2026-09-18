"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/auth/types";
import { useBackendStatus, type BackendStatus } from "@/lib/auth/useBackendStatus";

/** What to say when signing in cannot work, before the user has tried. */
const BACKEND_NOTICE: Partial<Record<BackendStatus, string>> = {
  offline: "The server is not responding. Sign-in will not work until it is back.",
  unconfigured: "This build has no backend URL, so sign-in is unavailable.",
};

/**
 * Failures are deliberately not specific about which field was wrong. The
 * backend returns one message for unknown-user and wrong-password alike, and
 * the UI must not undo that by guessing.
 */
function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "RATE_LIMITED" && error.retryAfter) {
      const minutes = Math.ceil(error.retryAfter / 60);
      return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const { status, signIn } = useAuth();
  const backendStatus = useBackendStatus();
  const backendNotice = BACKEND_NOTICE[backendStatus];

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Bumped on each failure to retrigger the shake animation. */
  const [failureCount, setFailureCount] = useState(0);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
    }
  }, [status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await signIn(username, password);
      router.replace("/");
    } catch (caught: unknown) {
      setError(messageFor(caught));
      setFailureCount((count) => count + 1);
      setPassword("");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Avoid flashing the login form at someone whose session is being restored.
  if (status === "restoring") {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-500" role="status">
          Loading
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div
        key={failureCount}
        className={`w-full max-w-sm ${failureCount > 0 ? "animate-shake" : ""}`}
      >
        <header className="mb-10">
          <h1 className="text-2xl font-medium tracking-tight text-neutral-100">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            Enter your credentials to continue.
          </p>

          {/* Stated up front rather than after a failed attempt, so a correct
              password is not mistaken for a wrong one. */}
          {backendNotice ? (
            <p
              role="status"
              className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300/90"
            >
              {backendNotice}
            </p>
          ) : null}
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="block text-xs font-medium uppercase tracking-wider text-neutral-500"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                autoFocus
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={isSubmitting}
                aria-invalid={error !== null}
                aria-describedby={error ? "form-error" : undefined}
                className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-neutral-100 transition-colors duration-150 ease-out placeholder:text-neutral-600 hover:border-neutral-700 focus:border-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium uppercase tracking-wider text-neutral-500"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
                aria-invalid={error !== null}
                aria-describedby={error ? "form-error" : undefined}
                className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-neutral-100 transition-colors duration-150 ease-out hover:border-neutral-700 focus:border-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 disabled:opacity-50"
              />
            </div>
          </div>

          {/* aria-live so the failure is announced, not only shown. */}
          <p
            id="form-error"
            role="alert"
            aria-live="polite"
            className={`mt-4 min-h-5 text-sm text-rose-400/90 transition-opacity duration-150 ease-out ${
              error ? "opacity-100" : "opacity-0"
            }`}
          >
            {error}
          </p>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-neutral-950 transition-colors duration-150 ease-out hover:bg-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Signing in" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
