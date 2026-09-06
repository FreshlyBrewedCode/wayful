import { Badge } from "@/components/ui/badge";
import { statusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { DisplayStatus } from "@/lib/wayful";

export function StatusPill({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <Badge variant="status" data-status={status} className={cn("font-mono", className)}>
      {statusLabel(status)}
    </Badge>
  );
}
