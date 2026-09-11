import { useQuery } from "@tanstack/react-query";

import { StatusPill } from "@/components/status-pill";
import { StepLink } from "@/components/step-card";
import { Skeleton } from "@/components/ui/skeleton";
import { stepQuery } from "@/lib/api";
import { displayStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { type MapDetail, type Step, type StepDetail, isError } from "@/lib/wayful";

/**
 * Step detail is fetched on selection rather than bundled with the map, because
 * `step show` is the only command that resolves live type instructions.
 */
export function StepDetailPanel({ detail, stepId }: { detail: MapDetail; stepId: number }) {
  const query = useQuery(stepQuery(detail.map.name, stepId));

  if (query.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return <Message>{query.error.message}</Message>;
  }
  if (isError(query.data)) {
    // Surface the CLI's own message rather than a generic failure.
    return <Message>{query.data.error}</Message>;
  }
  return <Body detail={detail} step={query.data} />;
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground p-4 text-sm">{children}</p>;
}

function Body({ detail, step }: { detail: MapDetail; step: StepDetail }) {
  const { map, next } = detail;
  const stepsById = new Map(map.steps.map((s) => [s.id, s]));
  const status = displayStatus(step, next);
  const dependents = map.steps.filter((s) => s.dependencies.includes(step.id));

  const reason = step.block_reason
    ? { label: "Blocked because", text: step.block_reason }
    : step.cancellation_reason
      ? { label: "Cancelled because", text: step.cancellation_reason }
      : step.completion_summary
        ? { label: "Completed with", text: step.completion_summary }
        : null;

  return (
    <div className="space-y-5 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">#{step.id}</span>
          <StatusPill status={status} />
        </div>
        <h2 className="mt-1.5 font-mono text-base font-semibold break-words">{step.name}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{step.description}</p>
      </div>

      {reason && (
        <Section heading={reason.label}>
          <Prose>{reason.text}</Prose>
        </Section>
      )}

      <Section heading="Body">
        <Prose empty={!step.body}>{step.body || "(empty)"}</Prose>
      </Section>

      <Slots heading="Inputs" required={step.required_inputs} attached={step.inputs} />
      <Slots heading="Outputs" required={step.required_outputs} attached={step.outputs} />

      <Section heading="Graph">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">type</dt>
          <dd className="font-mono">{step.type}</dd>
          <dt className="text-muted-foreground">depends on</dt>
          <dd>
            <StepRefs
              refs={step.dependencies.map((id) => ({ id, name: stepsById.get(id)?.name ?? "?" }))}
            />
          </dd>
          <dt className="text-muted-foreground">unblocks</dt>
          <dd>
            <StepRefs refs={dependents.map((s) => ({ id: s.id, name: s.name }))} />
          </dd>
        </dl>
      </Section>

      <Section heading={`Type instructions · ${step.type}`}>
        <Prose empty={!step.instructions}>{step.instructions.trim() || "(empty)"}</Prose>
      </Section>
    </div>
  );
}

/** Moving between a step and its neighbours is how you trace why it is blocked. */
function StepRefs({ refs }: { refs: { id: number; name: string }[] }) {
  if (refs.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {refs.map((ref) => (
        <StepLink
          key={ref.id}
          id={ref.id}
          className="text-primary font-mono underline-offset-2 hover:underline"
        >
          {ref.id} {ref.name}
        </StepLink>
      ))}
    </span>
  );
}

function Slots({
  heading,
  required,
  attached,
}: {
  heading: string;
  required: Step["required_inputs"];
  attached: Step["inputs"];
}) {
  const extra = attached.filter((attachment) => !("slot" in attachment));
  if (required.length === 0 && extra.length === 0) return null;

  return (
    <Section heading={heading}>
      <div className="space-y-2">
        {required.map((slot) => {
          const hit = attached.find(
            (attachment) => "slot" in attachment && attachment.slot === slot.name,
          );
          return (
            <div
              key={slot.name}
              data-status={hit ? "complete" : "ready"}
              className={cn(
                "p-2",
                hit
                  ? "bg-accent border border-l-[3px] border-l-[var(--status)]"
                  : "border-2 border-dashed",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs font-medium">{slot.name}</span>
                <span className="text-muted-foreground font-mono text-[11px]">{slot.kind}</span>
              </div>
              {slot.description && (
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                  {slot.description}
                </p>
              )}
              {hit && (
                <div className="mt-1.5">
                  <RefChip reference={hit.ref} kind={slot.kind} />
                </div>
              )}
            </div>
          );
        })}
        {extra.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {extra.map(
              (attachment) =>
                "kind" in attachment && (
                  <RefChip key={attachment.ref} reference={attachment.ref} kind={attachment.kind} />
                ),
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

/**
 * A step attachment carries its ref directly (ADR-0004) — the viewer never
 * dereferences it, and never looks it up in a separate registry.
 */
function RefChip({ reference, kind }: { reference: string; kind: string }) {
  return (
    <span className="bg-secondary text-secondary-foreground inline-flex max-w-full items-baseline gap-1.5 rounded-md px-2 py-0.5 text-xs">
      <span className="truncate font-mono">{reference}</span>
      <span className="text-muted-foreground shrink-0">{kind}</span>
    </span>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">
        {heading}
      </h3>
      {children}
    </section>
  );
}

/** Bodies and instructions are plain text; Markdown rendering is out of scope. */
function Prose({ children, empty = false }: { children: React.ReactNode; empty?: boolean }) {
  return (
    <p
      className={cn(
        "bg-muted/50 rounded-md p-2.5 text-xs leading-relaxed whitespace-pre-wrap",
        empty && "text-muted-foreground italic",
      )}
    >
      {children}
    </p>
  );
}
