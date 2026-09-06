import { describe, expect, test } from "bun:test";

import { GRAPH, assignColumns, layoutGraph } from "@/lib/graph-layout";
import { step } from "./fixtures";

const ids = (columns: ReturnType<typeof assignColumns>) =>
  columns.map((column) => column.map((s) => s.id));

describe("assignColumns", () => {
  test("a chain occupies one column per link", () => {
    const steps = [step(1), step(2, { dependencies: [1] }), step(3, { dependencies: [2] })];
    expect(ids(assignColumns(steps))).toEqual([[1], [2], [3]]);
  });

  test("fan-out puts siblings in the same column", () => {
    const steps = [step(1), step(2, { dependencies: [1] }), step(3, { dependencies: [1] })];
    expect(ids(assignColumns(steps))).toEqual([[1], [2, 3]]);
  });

  test("fan-in places the join one past its deepest prerequisite", () => {
    const steps = [
      step(1),
      step(2, { dependencies: [1] }),
      step(3),
      step(4, { dependencies: [2, 3] }),
    ];
    expect(ids(assignColumns(steps))).toEqual([[1, 3], [2], [4]]);
  });

  test("isolated steps share the first column", () => {
    expect(ids(assignColumns([step(7), step(2), step(5)]))).toEqual([[2, 5, 7]]);
  });

  test("columns are ordered by step ID", () => {
    const steps = [step(9, { dependencies: [1] }), step(1), step(3, { dependencies: [1] })];
    expect(ids(assignColumns(steps))).toEqual([[1], [3, 9]]);
  });

  test("a dependency that is not visible does not push the step right", () => {
    // Hiding cancelled steps removes them from the input; dependents must not
    // vanish or drift because of it.
    expect(ids(assignColumns([step(2, { dependencies: [1] })]))).toEqual([[2]]);
  });

  test("a dependency cycle degrades to depth 0 instead of recursing forever", () => {
    const steps = [step(1, { dependencies: [2] }), step(2, { dependencies: [1] })];
    const columns = assignColumns(steps);
    expect(columns.length).toBeGreaterThan(0);
    expect(
      columns
        .flat()
        .map((s) => s.id)
        .toSorted(),
    ).toEqual([1, 2]);
  });

  test("an empty map has no columns", () => {
    expect(assignColumns([])).toEqual([]);
  });
});

describe("layoutGraph", () => {
  test("places the start terminus left of the first column and the goal post right of the last", () => {
    const layout = layoutGraph([step(1), step(2, { dependencies: [1] })]);

    expect(layout.start.x).toBe(GRAPH.pad);
    expect(layout.goal.x).toBeGreaterThan(layout.nodes[1]!.x);
    expect(layout.width).toBeGreaterThan(layout.goal.x + GRAPH.terminusWidth);
  });

  test("columns are evenly spaced and each column is vertically centred", () => {
    const layout = layoutGraph([
      step(1),
      step(2, { dependencies: [1] }),
      step(3, { dependencies: [1] }),
    ]);
    const node = (id: number) => layout.nodes.find((n) => n.step.id === id)!;

    expect(node(2).x - node(1).x).toBe(GRAPH.nodeWidth + GRAPH.columnGap);
    expect(node(2).x).toBe(node(3).x);
    // The single-node column sits at the midpoint of the two-node column.
    expect(node(1).y + GRAPH.nodeHeight / 2).toBeCloseTo(
      (node(2).y + node(3).y + GRAPH.nodeHeight) / 2,
    );
  });

  test("a step with no visible dependencies is joined to the start terminus", () => {
    const layout = layoutGraph([step(1), step(2, { dependencies: [1] })]);
    const fromStart = layout.edges.filter((e) => e.kind === "start");

    expect(fromStart).toHaveLength(1);
    expect(fromStart[0]!.toId).toBe(1);
    expect(fromStart[0]!.dimmed).toBe(true);
  });

  test("a step nothing depends on is joined to the goal terminus", () => {
    const layout = layoutGraph([step(1), step(2, { dependencies: [1] })]);
    const toGoal = layout.edges.filter((e) => e.kind === "goal");

    expect(toGoal.map((e) => e.fromId)).toEqual([2]);
  });

  test("cancelled steps are drawn in place but excluded from the goal terminus", () => {
    const steps = [step(1), step(2, { status: "cancelled" })];
    const layout = layoutGraph(steps);

    expect(layout.nodes.map((n) => n.step.id)).toEqual([1, 2]);
    expect(layout.edges.filter((e) => e.kind === "goal").map((e) => e.fromId)).toEqual([1]);
  });

  test("dependency edges run between the two steps they connect", () => {
    const layout = layoutGraph([step(1), step(2, { dependencies: [1] })]);
    const edge = layout.edges.find((e) => e.kind === "dependency")!;

    expect(edge.fromId).toBe(1);
    expect(edge.toId).toBe(2);
    expect(edge.from.x).toBeLessThan(edge.to.x);
  });

  test("an edge into a cancelled step is dimmed", () => {
    const layout = layoutGraph([step(1), step(2, { status: "cancelled", dependencies: [1] })]);
    const edge = layout.edges.find((e) => e.kind === "dependency")!;

    expect(edge.dimmed).toBe(true);
  });

  test("an empty step list still lays out both termini", () => {
    const layout = layoutGraph([]);

    expect(layout.nodes).toEqual([]);
    expect(layout.goal.x).toBeGreaterThan(layout.start.x);
    expect(layout.height).toBeGreaterThan(0);
  });
});
