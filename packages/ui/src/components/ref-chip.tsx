/**
 * A step or goal attachment carries its ref directly (ADR-0004) — the viewer
 * never dereferences it, and never looks it up in a separate registry.
 */
export function RefChip({ reference, kind }: { reference: string; kind: string }) {
  return (
    <span className="bg-secondary text-secondary-foreground inline-flex max-w-full items-baseline gap-1.5 rounded-md px-2 py-0.5 text-xs">
      <span className="truncate font-mono">{reference}</span>
      <span className="text-muted-foreground shrink-0">{kind}</span>
    </span>
  );
}
