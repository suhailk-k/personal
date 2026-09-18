"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/context";
import type { User } from "@/lib/auth/types";

/**
 * The home screen, shown only to a signed-in user.
 *
 * This guard is a user-experience measure, not a security boundary. The site
 * is a static export, so its JavaScript is public and anyone can read it.
 * What actually protects data is the backend rejecting requests without a
 * valid access token. Nothing secret may be embedded in this bundle; secret
 * content has to be fetched from the API after authenticating.
 */
export default function Home() {
  const router = useRouter();
  const { status, user, signOut, apiFetch } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  /** The user as the backend sees it, from /auth/me. Null until it answers. */
  const [verifiedUser, setVerifiedUser] = useState<User | null>(null);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    }
  }, [status, router]);

  /**
   * Confirms with the backend that the restored token is actually accepted.
   * `apiFetch` handles an expired access token by refreshing and replaying, so
   * a session that has merely aged is renewed here rather than dropped.
   */
  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let isCancelled = false;

    void apiFetch<{ user: User }>("/auth/me")
      .then(({ user: fetched }) => {
        if (!isCancelled) {
          setVerifiedUser(fetched);
        }
      })
      .catch(() => {
        // A rejected session has already been cleared by the context, which
        // flips `status` and sends this page to /login. Anything else is a
        // transient failure, and the header falls back to the local user.
      });

    return () => {
      isCancelled = true;
    };
  }, [status, apiFetch]);

  if (status !== "authenticated") {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-500" role="status">
          Loading
        </p>
      </main>
    );
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-neutral-900 px-6 py-4">
        <span className="text-sm text-neutral-500">
          Signed in as{" "}
          <span className="text-neutral-300">
            {(verifiedUser ?? user)?.username}
          </span>
        </span>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors duration-150 ease-out hover:bg-neutral-900 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 disabled:opacity-50"
        >
          {isSigningOut ? "Signing out" : "Sign out"}
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-8">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-100">
          Home
        </h1>
      </main>
    </div>
  );
}
