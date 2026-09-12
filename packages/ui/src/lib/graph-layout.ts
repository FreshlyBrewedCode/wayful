import type { Step } from "@/lib/wayful";

/**
 * Geometry of the dependency graph. Layout is the *only* thing the viewer
 * computes about a map — every status and count comes from the CLI.
 */
export const GRAPH = {
  nodeWidth: 218,
  nodeHeight: 108,
  columnGap: 78,
  rowGap: 18,
  terminusWidth: 168,
  terminusHeight: 88,
  pad: 22,
} as const;

export interface Point {
  x: number;
  y: number;
}

export interface GraphNode {
  step: Step;
  x: number;
  y: number;
}

export interface GraphEdge {
  key: string;
  from: Point;
  to: Point;
  /** `start`/`goal` edges attach a step to a terminus rather than to a step. */
  kind: "dependency" | "start" | "goal";
  fromId: number | null;
  toId: number | null;
  dimmed: boolean;
}

export interface Terminus {
  x: number;
  y: number;
  width: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  start: Terminus;
  goal: Terminus;
}

/**
 * Longest-path layering: a step sits one column right of its deepest visible
 * prerequisite. Columns are ordered by step ID. Dependencies on steps that are
 * not in `steps` — hidden cancelled ones, say — are simply ignored.
 *
 * The CLI rejects dependency cycles, but a cycle here would recurse forever, so
 * a step already on the walk stack degrades to depth 0 instead.
 */
export function assignColumns(steps: readonly Step[]): Step[][] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const depth = new Map<number, number>();

  const walk = (step: Step, stack: Set<number>): number => {
    const cached = depth.get(step.id);
    if (cached !== undefined) return cached;
    if (stack.has(step.id)) return 0;
    stack.add(step.id);
    const dependencies = step.dependencies
      .map((id) => byId.get(id))
      .filter((s): s is Step => s !== undefined);
    const value = dependencies.length
      ? Math.max(...dependencies.map((d) => walk(d, stack))) + 1
      : 0;
    stack.delete(step.id);
    depth.set(step.id, value);
    return value;
  };

  const sparse: Step[][] = [];
  for (const step of steps) {
    const index = walk(step, new Set());
    (sparse[index] ??= []).push(step);
  }
  // A cycle can leave a depth unused, so gaps are closed rather than drawn as
  // an empty column. An acyclic graph never has one.
  const columns = [...sparse].filter((column) => column !== undefined);
  for (const column of columns) column.sort((a, b) => a.id - b.id);
  return columns;
}

/**
 * Positions every step, both termini and every edge. Steps with no visible
 * dependencies hang off the start terminus; steps nothing depends on point at
 * the goal post. Cancelled steps keep their place — that is the record of a
 * changed understanding — but do not claim to reach the goal.
 */
export function layoutGraph(steps: readonly Step[]): GraphLayout {
  const columns = assignColumns(steps);
  const { nodeWidth, nodeHeight, columnGap, rowGap, terminusWidth, pad } = GRAPH;

  const rows = Math.max(1, ...columns.map((column) => column.length));
  const band = rows * nodeHeight + (rows - 1) * rowGap;
  const height = band + pad * 2;
  const midY = pad + band / 2;

  const columnX = (index: number) =>
    pad + terminusWidth + columnGap + index * (nodeWidth + columnGap);
  const goalX = columnX(columns.length);
  const width = goalX + terminusWidth + pad;

  const nodes: GraphNode[] = [];
  const positions = new Map<number, Point>();
  columns.forEach((column, columnIndex) => {
    const span = column.length * nodeHeight + (column.length - 1) * rowGap;
    column.forEach((step, rowIndex) => {
      const x = columnX(columnIndex);
      const y = pad + (band - span) / 2 + rowIndex * (nodeHeight + rowGap);
      positions.set(step.id, { x, y });
      nodes.push({ step, x, y });
    });
  });

  const port = (id: number, side: "in" | "out"): Point => {
    const at = positions.get(id)!;
    return { x: side === "in" ? at.x : at.x + nodeWidth, y: at.y + nodeHeight / 2 };
  };

  const edges: GraphEdge[] = [];
  for (const step of steps) {
    if (!positions.has(step.id)) continue;
    const dependencies = step.dependencies.filter((id) => positions.has(id));
    if (dependencies.length === 0) {
      edges.push({
        key: `start-${step.id}`,
        from: { x: pad + terminusWidth, y: midY },
        to: port(step.id, "in"),
        kind: "start",
        fromId: null,
        toId: step.id,
        dimmed: true,
      });
    }
    for (const id of dependencies) {
      edges.push({
        key: `${id}-${step.id}`,
        from: port(id, "out"),
        to: port(step.id, "in"),
        kind: "dependency",
        fromId: id,
        toId: step.id,
        dimmed: step.status === "cancelled",
      });
    }
  }

  const depended = new Set(steps.flatMap((s) => s.dependencies));
  for (const step of steps) {
    if (depended.has(step.id) || step.status === "cancelled") continue;
    if (!positions.has(step.id)) continue;
    edges.push({
      key: `goal-${step.id}`,
      from: port(step.id, "out"),
      to: { x: goalX, y: midY },
      kind: "goal",
      fromId: step.id,
      toId: null,
      dimmed: true,
    });
  }

  return {
    width,
    height,
    nodes,
    edges,
    start: { x: pad, y: midY - GRAPH.terminusHeight / 2, width: terminusWidth },
    goal: { x: goalX, y: midY - GRAPH.terminusHeight / 2, width: terminusWidth },
  };
}

/** The cubic that draws an edge as a left-to-right ribbon. */
export function edgePath(edge: GraphEdge): string {
  const mid = (edge.from.x + edge.to.x) / 2;
  return `M${edge.from.x},${edge.from.y} C${mid},${edge.from.y} ${mid},${edge.to.y} ${edge.to.x},${edge.to.y}`;
}
