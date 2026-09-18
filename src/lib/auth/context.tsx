"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import * as api from "./client";
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from "./storage";
import { ApiError, type AuthSession, type User } from "./types";

/**
 * Session state for the whole app.
 *
 * The access token is held in a ref, never in storage and never in React
 * state. Keeping it out of storage means a script that reads localStorage
 * gets only the refresh token, which rotation and server-side revocation can
 * invalidate. Keeping it in a ref rather than state avoids re-rendering the
 * tree every fifteen minutes when it silently renews.
 */

type Status = "restoring" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: Status;
  user: User | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Valid access token, refreshing first if necessary. Null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /**
   * Authenticated call against the backend. Attaches the access token, and on
   * a rejected token refreshes once and replays the request.
   */
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // "restoring" is the correct initial state: a returning user has a token in
  // storage, and rendering the login screen before checking it would flash
  // sign-in at someone who is already signed in.
  const [status, setStatus] = useState<Status>("restoring");
  const [user, setUser] = useState<User | null>(null);

  const accessTokenRef = useRef<string | null>(null);
  /** Shared in-flight refresh, so N concurrent 401s cause one refresh call. */
  const refreshInFlight = useRef<Promise<string | null> | null>(null);

  const applySession = useCallback((session: AuthSession) => {
    accessTokenRef.current = session.accessToken;
    writeRefreshToken(session.refreshToken);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const clearSession = useCallback(() => {
    accessTokenRef.current = null;
    refreshInFlight.current = null;
    clearRefreshToken();
    setUser(null);
    setStatus("anonymous");
  }, []);

  /**
   * Exchanges the stored refresh token for a new session. Concurrent callers
   * share one request; without this, several components hitting 401 at once
   * would each rotate the token, and every rotation but the last would look
   * to the backend like a replayed token — which correctly triggers theft
   * detection and logs the user out.
   */
  const runRefresh = useCallback((): Promise<string | null> => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const stored = readRefreshToken();
    if (!stored) {
      return Promise.resolve(null);
    }

    const attempt = api
      .refresh(stored)
      .then((session) => {
        applySession(session);
        return session.accessToken;
      })
      .catch((error: unknown) => {
        // A rejected refresh token is final: it is expired, revoked, or was
        // replayed. Only a fresh login recovers. A network failure is not
        // final, so the stored token is kept for the next attempt.
        if (error instanceof ApiError && error.code !== "NETWORK_ERROR") {
          clearSession();
        } else {
          setStatus("anonymous");
        }
        return null;
      })
      .finally(() => {
        refreshInFlight.current = null;
      });

    refreshInFlight.current = attempt;
    return attempt;
  }, [applySession, clearSession]);

  // Restore the session on mount. This is what makes login persist across
  // reloads and browser restarts.
  //
  // The work runs in an async callback rather than the effect body so the
  // state update lands after a microtask, avoiding a synchronous cascading
  // render. The cancellation flag stops a slow refresh from writing state
  // into a provider that has already unmounted.
  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      if (!readRefreshToken()) {
        if (!isCancelled) {
          setStatus("anonymous");
        }
        return;
      }
      await runRefresh();
    })();

    return () => {
      isCancelled = true;
    };
  }, [runRefresh]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const session = await api.login(username, password);
      applySession(session);
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    const stored = readRefreshToken();
    // Clear locally first. If the network call fails the user is still signed
    // out on this device, which is what they asked for.
    clearSession();

    if (stored) {
      try {
        await api.logout(stored);
      } catch {
        // The token stays valid server-side until it expires. Nothing can be
        // done from here, and surfacing it would only make a completed logout
        // look broken.
      }
    }
  }, [clearSession]);

  const getAccessToken = useCallback(async () => {
    return accessTokenRef.current ?? (await runRefresh());
  }, [runRefresh]);

  /**
   * The single way the app talks to authenticated endpoints.
   *
   * An access token lives fifteen minutes, so a tab left open will hit
   * INVALID_TOKEN during normal use. Refreshing and replaying here means every
   * caller sees that as a slightly slower call rather than an error it has to
   * handle. Exactly one retry: if a token minted seconds ago is also rejected,
   * the session is genuinely over and retrying again would only loop.
   *
   * `init.body` must be a plain value (a string, as `JSON.stringify` gives).
   * A stream body cannot be read twice and would replay empty.
   */
  const apiFetch = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await getAccessToken();
      if (!token) {
        throw new ApiError(
          "INVALID_TOKEN",
          "Your session has ended. Please sign in again.",
          401,
        );
      }

      try {
        return await api.authorizedRequest<T>(path, token, init);
      } catch (error: unknown) {
        const isRejectedToken =
          error instanceof ApiError && error.code === "INVALID_TOKEN";
        if (!isRejectedToken) {
          throw error;
        }

        // `runRefresh` clears the session itself when the refresh token is
        // rejected, so a null here already means "signed out".
        const renewed = await runRefresh();
        if (!renewed) {
          throw error;
        }

        try {
          return await api.authorizedRequest<T>(path, renewed, init);
        } catch (replayError: unknown) {
          if (
            replayError instanceof ApiError &&
            replayError.code === "INVALID_TOKEN"
          ) {
            clearSession();
          }
          throw replayError;
        }
      }
    },
    [clearSession, getAccessToken, runRefresh],
  );

  const value = useMemo(
    () => ({ status, user, signIn, signOut, getAccessToken, apiFetch }),
    [status, user, signIn, signOut, getAccessToken, apiFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
