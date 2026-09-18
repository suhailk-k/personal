"use client";

import { useEffect, useState } from "react";

import { health, isApiConfigured } from "./client";

/**
 * Whether the backend is answering at all.
 *
 * The site is a static export that keeps serving from GitHub Pages while the
 * backend runs on a personal machine that sleeps. Without this, an unreachable
 * backend looks identical to a rejected password: the user retypes correct
 * credentials and is told again that something went wrong.
 *
 * `/health` needs no authentication, which is the point — it separates "the
 * server is down" from "your credentials are wrong" before either is asked.
 */
export type BackendStatus = "checking" | "online" | "offline" | "unconfigured";

export function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>(
    isApiConfigured() ? "checking" : "unconfigured",
  );

  useEffect(() => {
    if (!isApiConfigured()) {
      return;
    }

    let isCancelled = false;

    void health()
      .then(() => {
        if (!isCancelled) {
          setStatus("online");
        }
      })
      .catch(() => {
        // Any failure here — transport, CORS, a tunnel error page — means the
        // same thing to the user: the backend cannot be reached right now.
        if (!isCancelled) {
          setStatus("offline");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return status;
}
