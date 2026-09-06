import { Compass, Menu, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LiveState } from "@/hooks/use-live-updates";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import type { ProjectMeta } from "@/lib/wayful";

const LIVE_LABEL: Record<LiveState, string> = {
  connecting: "connecting",
  live: "live",
  updating: "updating",
  offline: "offline",
};

export function TopBar({
  project,
  live,
  onOpenRail,
}: {
  project?: ProjectMeta;
  live: LiveState;
  onOpenRail: () => void;
}) {
  const { theme, toggle } = useTheme();
  const name = project?.root.split("/").findLast(Boolean) ?? "Wayful";

  return (
    <header className="bg-background/85 sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b px-3 backdrop-blur">
      <Button
        variant="ghost"
        size="icon"
        className="min-[941px]:hidden"
        onClick={onOpenRail}
        aria-label="Show maps"
      >
        <Menu />
      </Button>

      <Compass className="text-primary size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {project?.description || project?.error || project?.root}
        </p>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:inline-flex"
            aria-live="polite"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                live === "live" && "bg-status-complete",
                live === "updating" && "bg-status-ready animate-pulse",
                live === "connecting" && "bg-status-pending",
                live === "offline" && "bg-status-cancelled",
              )}
            />
            {LIVE_LABEL[live]}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Watching <code className="font-mono">.wayful</code> for changes. Read-only — the viewer
          never writes.
        </TooltipContent>
      </Tooltip>

      <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle colour scheme">
        {theme === "dark" ? <Sun /> : <Moon />}
      </Button>
    </header>
  );
}
