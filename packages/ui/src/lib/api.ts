import { queryOptions } from "@tanstack/react-query";

import type { MapResponse, Overview, StepResponse } from "./wayful";

/**
 * The viewer's whole data surface. Each endpoint forwards the CLI's own
 * `--json`, so nothing here reshapes domain state — it only types it.
 */
async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const overviewQuery = () =>
  queryOptions({
    queryKey: ["overview"] as const,
    queryFn: () => get<Overview>("/api/overview"),
  });

export const mapQuery = (name: string) =>
  queryOptions({
    queryKey: ["map", name] as const,
    queryFn: () => get<MapResponse>(`/api/map?name=${encodeURIComponent(name)}`),
    enabled: name.length > 0,
  });

export const stepQuery = (map: string, id: number) =>
  queryOptions({
    queryKey: ["step", map, id] as const,
    queryFn: () =>
      get<StepResponse>(`/api/step?map=${encodeURIComponent(map)}&ref=${encodeURIComponent(id)}`),
  });
