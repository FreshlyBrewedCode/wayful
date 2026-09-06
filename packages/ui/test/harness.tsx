import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render } from "@testing-library/react";

import { routeTree } from "@/routeTree.gen";
import type { MapResponse, Overview, StepDetail } from "@/lib/wayful";

export interface Backend {
  overview: Overview;
  maps: Record<string, MapResponse>;
  steps?: Record<number, StepDetail>;
}

/**
 * Drives the real router and the real components against a stubbed HTTP
 * surface — the same seam the server exposes, so a test fails for the reasons a
 * user would notice rather than because a module moved.
 */
const body = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

export function stubFetch(backend: Backend) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");

    if (url.pathname === "/api/overview") return body(backend.overview);
    if (url.pathname === "/api/map") {
      const name = url.searchParams.get("name") ?? "";
      return body(backend.maps[name] ?? { error: `map '${name}' does not exist.` });
    }
    if (url.pathname === "/api/step") {
      const id = Number(url.searchParams.get("ref"));
      const step = backend.steps?.[id];
      return body(step ?? { error: `step '${id}' does not exist.` });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

export function renderApp(path: string, backend: Backend) {
  stubFetch(backend);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { ...result, router, queryClient };
}
