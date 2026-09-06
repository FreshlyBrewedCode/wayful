import { StatusPill } from "@/components/status-pill";
import { StepLink } from "@/components/step-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Step } from "@/lib/wayful";

export function ListView({
  steps,
  next,
  selected,
}: {
  steps: Step[];
  next: number[];
  selected: number | null;
}) {
  return (
    <div className="h-full overflow-auto p-4 pt-16">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Step</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Depends on</TableHead>
              <TableHead>Outputs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {steps.map((step) => {
              const status = displayStatus(step, next);
              return (
                <TableRow
                  key={step.id}
                  data-status={status}
                  data-state={selected === step.id ? "selected" : undefined}
                >
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {step.id}
                  </TableCell>
                  <TableCell>
                    <StepLink
                      id={step.id}
                      className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <div
                        className={cn(
                          "font-mono text-[13px] font-medium",
                          status === "cancelled" && "line-through",
                        )}
                      >
                        {step.name}
                      </div>
                      <div className="text-muted-foreground text-xs">{step.description}</div>
                    </StepLink>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {step.type}
                  </TableCell>
                  <TableCell>
                    <StatusPill status={status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {step.dependencies.join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {step.outputs.map((output) => output.artifact).join(", ") || "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
