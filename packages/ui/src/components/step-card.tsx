import { Link } from "@tanstack/react-router";

import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";
import type { DisplayStatus, Step } from "@/lib/wayful";

/** Every view of a step lives under the one map route. */
const MAP_ROUTE = "/maps/$mapName" as const;

type StepLinkProps = { id: number } & Omit<
  React.ComponentPropsWithoutRef<"a">,
  "id" | "href" | "onClick"
>;

/** Selecting a step is a URL change, so every step is linkable and shareable. */
export function StepLink({ id, children, ...props }: StepLinkProps) {
  return (
    <Link
      from={MAP_ROUTE}
      to="."
      search={(previous) => ({ ...previous, step: id })}
      onClick={(event) => {
        // A drag that ends on a step must not also select it.
        if (event.currentTarget.closest('[data-dragged="true"]')) event.preventDefault();
      }}
      {...props}
    >
      {children}
    </Link>
  );
}

export function StepCard({
  step,
  status,
  selected,
  className,
  compact = false,
  ...props
}: {
  step: Step;
  status: DisplayStatus;
  selected: boolean;
  compact?: boolean;
} & Omit<React.ComponentProps<typeof StepLink>, "id" | "children">) {
  return (
    <StepLink
      id={step.id}
      data-status={status}
      aria-current={selected ? "true" : undefined}
      title={step.description}
      {...props}
      className={cn(
        "group bg-card ring-offset-background flex flex-col gap-1.5 overflow-hidden rounded-lg border p-2.5 text-left transition-shadow",
        "border-l-[3px] border-l-[var(--status)] hover:shadow-md",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        "aria-[current]:ring-primary aria-[current]:ring-2",
        status === "cancelled" && "opacity-60",
        className,
      )}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="text-muted-foreground shrink-0 font-mono text-[11px]">#{step.id}</span>
        <span
          className={cn(
            "truncate font-mono text-[13px] font-medium",
            status === "cancelled" && "line-through",
          )}
        >
          {step.name}
        </span>
      </span>
      <span className="text-muted-foreground line-clamp-2 text-xs leading-snug">
        {step.description}
      </span>
      <span className="mt-auto flex items-center gap-1.5 pt-0.5">
        {!compact && <StatusPill status={status} />}
        <span className="text-muted-foreground min-w-0 truncate font-mono text-[11px]">
          {step.type}
        </span>
        {status === "ready" && (
          <span className="text-status-ready ml-auto shrink-0 text-[11px] font-medium">▶ next</span>
        )}
      </span>
    </StepLink>
  );
}
