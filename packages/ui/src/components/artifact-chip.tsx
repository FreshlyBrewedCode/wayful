import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Artifact } from "@/lib/wayful";

/**
 * Artifacts are shown by name and kind, with the opaque reference available on
 * inspection. The viewer never dereferences a reference — the CLI treats them
 * as opaque and so does this.
 */
export function ArtifactChip({
  name,
  artifact,
  className,
}: {
  name: string;
  artifact?: Artifact;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "bg-secondary text-secondary-foreground inline-flex max-w-full items-baseline gap-1.5 rounded-md px-2 py-0.5 text-xs",
            !artifact && "text-muted-foreground italic",
            className,
          )}
        >
          <span className="truncate font-mono">{name}</span>
          {artifact ? (
            <span className="text-muted-foreground shrink-0">{artifact.kind}</span>
          ) : (
            <span className="shrink-0">missing</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {artifact ? (
          <span className="font-mono break-all">{artifact.ref}</span>
        ) : (
          "artifact not registered on this map"
        )}
      </TooltipContent>
    </Tooltip>
  );
}
