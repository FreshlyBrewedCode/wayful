import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export type LiveState = "connecting" | "live" | "updating" | "offline";

/**
 * The server watches `.wayful` and pushes an invalidation over SSE. Watching is
 * best-effort — the viewer works without it, so a dropped stream only changes
 * the indicator.
 */
export function useLiveUpdates(): LiveState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    const source = new EventSource("/api/events");
    let settle: ReturnType<typeof setTimeout> | undefined;

    source.addEventListener("open", () => setState("live"));
    source.addEventListener("error", () => setState("offline"));
    source.addEventListener("message", (event) => {
      if (event.data !== "changed") return;
      setState("updating");
      // A single edit through the CLI touches several files; one refetch at the
      // end of the burst is enough.
      clearTimeout(settle);
      settle = setTimeout(() => {
        void queryClient.invalidateQueries().then(() => setState("live"));
      }, 150);
    });

    return () => {
      clearTimeout(settle);
      source.close();
    };
  }, [queryClient]);

  return state;
}
