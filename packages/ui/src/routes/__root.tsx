import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import { useState } from "react";

import { MapRail } from "@/components/map-rail";
import { TopBar } from "@/components/top-bar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { overviewQuery } from "@/lib/api";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

/**
 * Three regions: a map rail, the map itself, and a step detail panel. The rail
 * becomes an overlay sheet below 940px; the detail panel is the map route's
 * business, since it belongs to a map.
 */
function RootLayout() {
  const { data: overview } = useQuery(overviewQuery());
  const live = useLiveUpdates();
  const [railOpen, setRailOpen] = useState(false);
  const activeMap = useActiveMapName();

  const rail = (
    <MapRail
      maps={overview?.maps ?? []}
      types={overview?.types ?? []}
      activeMap={activeMap}
      onNavigate={() => setRailOpen(false)}
    />
  );

  return (
    <TooltipProvider>
      <a
        href="#map"
        className="bg-primary text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
      >
        Skip to map
      </a>

      <div className="flex h-full flex-col">
        <TopBar project={overview?.project} live={live} onOpenRail={() => setRailOpen(true)} />

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-66 shrink-0 border-r min-[941px]:block">{rail}</aside>
          <main id="map" className="flex min-w-0 flex-1 flex-col">
            <Outlet />
          </main>
        </div>
      </div>

      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent side="left" title="Maps" className="w-72 p-0">
          {rail}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}

/** The rail highlights the map in the URL without depending on the map route. */
function useActiveMapName(): string | null {
  return useRouterState({
    select: (state) => {
      const match = /^\/maps\/([^/?#]+)/.exec(state.location.pathname);
      return match?.[1] ? decodeURIComponent(match[1]) : null;
    },
  });
}
