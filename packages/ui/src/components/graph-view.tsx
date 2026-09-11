import { Maximize2, Minus, Plus } from "lucide-react";
import { useMemo } from "react";

import { StepCard } from "@/components/step-card";
import { Button } from "@/components/ui/button";
import { useGraphViewport } from "@/hooks/use-graph-viewport";
import { GRAPH, edgePath, layoutGraph } from "@/lib/graph-layout";
import { displayStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { type Goal, goalSatisfied, type Step } from "@/lib/wayful";

export function GraphView({
  steps,
  next,
  start,
  goals,
  selected,
  viewportKey,
}: {
  steps: Step[];
  next: number[];
  start: string;
  goals: Goal[];
  selected: number | null;
  /** Changing this returns the canvas to its opening view. */
  viewportKey: string;
}) {
  const layout = useMemo(() => layoutGraph(steps), [steps]);
  const content = useMemo(
    () => ({ width: layout.width, height: layout.height }),
    [layout.width, layout.height],
  );
  const viewport = useGraphViewport(content, `${viewportKey}:${layout.width}x${layout.height}`);
  const satisfied = goals.filter(goalSatisfied).length;

  return (
    <div
      ref={viewport.wrapRef}
      className="bg-dot-grid relative h-full w-full touch-none overflow-hidden [&[data-grabbing]]:cursor-grabbing [&[data-grabbing]]:select-none"
    >
      <div
        ref={viewport.canvasRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          className="pointer-events-none absolute inset-0"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {layout.edges.map((edge) => {
            const hot = selected !== null && (edge.fromId === selected || edge.toId === selected);
            return (
              <path
                key={edge.key}
                d={edgePath(edge)}
                fill="none"
                strokeWidth={hot ? 2.5 : 1.5}
                className={cn(
                  "stroke-border transition-[stroke,stroke-width]",
                  edge.dimmed && "opacity-40 [stroke-dasharray:4_4]",
                  hot && "stroke-primary opacity-100",
                )}
              />
            );
          })}
        </svg>

        <Terminus x={layout.start.x} y={layout.start.y} width={layout.start.width} heading="Start">
          <p className="text-muted-foreground line-clamp-4 text-xs leading-snug">{start}</p>
        </Terminus>

        {layout.nodes.map(({ step, x, y }) => (
          <StepCard
            key={step.id}
            step={step}
            status={displayStatus(step, next)}
            selected={selected === step.id}
            data-graph-node=""
            className="absolute"
            style={{
              left: x,
              top: y,
              width: GRAPH.nodeWidth,
              minHeight: GRAPH.nodeHeight,
            }}
          />
        ))}

        <Terminus
          x={layout.goal.x}
          y={layout.goal.y}
          width={layout.goal.width}
          heading={`Goals ${satisfied}/${goals.length}`}
        >
          {goals.map((goal) => (
            <p key={goal.name} className="text-muted-foreground line-clamp-2 text-xs leading-snug">
              <span className={goalSatisfied(goal) ? "text-status-complete" : ""}>
                {goalSatisfied(goal) ? "✓" : "○"}
              </span>{" "}
              {goal.description}
            </p>
          ))}
        </Terminus>
      </div>

      <div
        data-graph-hud=""
        className="bg-card/90 absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border p-1 shadow-sm backdrop-blur"
      >
        <Button variant="ghost" size="icon-sm" onClick={() => viewport.zoomBy(1 / 1.25)}>
          <Minus />
          <span className="sr-only">Zoom out</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-14 font-mono tabular-nums"
          title="Reset to 100%"
          onClick={() => viewport.zoomTo(1)}
        >
          {Math.round(viewport.scale * 100)}%
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => viewport.zoomBy(1.25)}>
          <Plus />
          <span className="sr-only">Zoom in</span>
        </Button>
        <Button variant="ghost" size="icon-sm" title="Fit map to view" onClick={viewport.fit}>
          <Maximize2 />
          <span className="sr-only">Fit map to view</span>
        </Button>
      </div>
    </div>
  );
}

function Terminus({
  x,
  y,
  width,
  heading,
  children,
}: {
  x: number;
  y: number;
  width: number;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-muted/60 absolute flex flex-col gap-1 rounded-lg border border-dashed p-2.5"
      style={{ left: x, top: y, width, minHeight: GRAPH.terminusHeight }}
    >
      <h4 className="text-[11px] font-semibold tracking-wide uppercase">{heading}</h4>
      {children}
    </div>
  );
}
