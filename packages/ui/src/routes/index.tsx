import { createFileRoute, redirect } from "@tanstack/react-router";

import { EmptyState } from "@/components/empty-state";
import { overviewQuery } from "@/lib/api";

/** One map is in view at a time, so the entry point picks the first one. */
export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const overview = await context.queryClient.ensureQueryData(overviewQuery());
    const first = overview.maps[0];
    if (first) throw redirect({ to: "/maps/$mapName", params: { mapName: first.name } });
    return overview;
  },
  component: NoMaps,
});

function NoMaps() {
  const overview = Route.useLoaderData();

  if (overview.project.error || overview.error) {
    return (
      <EmptyState title="Cannot read this project">
        {overview.project.error ?? overview.error}
      </EmptyState>
    );
  }
  return (
    <EmptyState title="No maps yet">
      This project has no maps. Create one with <code className="font-mono">wayful map create</code>
      .
    </EmptyState>
  );
}
