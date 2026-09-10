import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { Overview, StepDetail } from "@/lib/wayful";
import { detail, step } from "./fixtures";
import { type Backend, renderApp } from "./harness";

const STEPS = [
  step(1, { name: "survey", status: "complete", completion_summary: "done" }),
  step(2, { name: "layer-graph", dependencies: [1] }),
  step(3, { name: "detail-panel", dependencies: [2] }),
  step(4, { name: "live-reload", status: "blocked", block_reason: "waiting on a decision" }),
  step(5, { name: "embed-in-cli", status: "cancelled", cancellation_reason: "throwaway" }),
];

const overview = (maps: Overview["maps"]): Overview => ({
  project: { root: "/tmp/demo", description: "A demo project" },
  maps,
  types: [
    {
      name: "task",
      description: "Do a thing",
      required_inputs: [],
      required_outputs: [],
      instructions: "",
    },
  ],
});

function backend(): Backend {
  const demo = detail(STEPS, [2]);
  const empty = detail([]);
  empty.map.name = "fresh-map";
  return {
    overview: overview([
      { name: "demo", start: "Somewhere", status: demo.status },
      { name: "fresh-map", start: "Nothing charted yet", status: empty.status },
      { name: "broken", start: "?", status: null },
    ]),
    maps: {
      demo,
      "fresh-map": empty,
      broken: { error: "wayful: malformed map metadata." },
    },
    steps: {
      2: {
        ...STEPS[1]!,
        body: "Longest-path layering.",
        instructions: "Do the task.",
      } as StepDetail,
    },
  };
}

describe("the viewer", () => {
  test("opens on the first map and lists every map with its progress", async () => {
    renderApp("/", backend());

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("demo"),
    );
    const rail = screen.getAllByRole("navigation", { name: "Maps" })[0]!;
    expect(within(rail).getByText("fresh-map")).toBeInTheDocument();
    expect(within(rail).getByText("broken")).toBeInTheDocument();
  });

  test("draws every step, colour-coded, with `map next` marked as ready", async () => {
    renderApp("/maps/demo", backend());

    const graph = await screen.findByRole("region", { name: "Steps" });
    const statusOf = (name: string) =>
      within(graph).getByText(name).closest("[data-status]")!.getAttribute("data-status");

    await waitFor(() => expect(within(graph).getByText("layer-graph")).toBeInTheDocument());
    expect(statusOf("layer-graph")).toBe("ready");
    expect(statusOf("survey")).toBe("complete");
    expect(statusOf("detail-panel")).toBe("pending");
    expect(statusOf("live-reload")).toBe("blocked");
    expect(statusOf("embed-in-cli")).toBe("cancelled");
  });

  test("draws cancelled steps in place, and hides them on request", async () => {
    const { router } = renderApp("/maps/demo", backend());
    const graph = await screen.findByRole("region", { name: "Steps" });

    await waitFor(() => expect(within(graph).getByText("embed-in-cli")).toBeInTheDocument());
    await router.navigate({
      to: "/maps/$mapName",
      params: { mapName: "demo" },
      search: { cancelled: false },
    });
    await waitFor(() => expect(within(graph).queryByText("embed-in-cli")).not.toBeInTheDocument());
  });

  test("shows the map's blockers with their reasons", async () => {
    renderApp("/maps/demo", backend());

    await waitFor(() => expect(screen.getByText(/waiting on a decision/)).toBeInTheDocument());
  });

  test("shows the map overview, with validate findings in full, when nothing is selected", async () => {
    renderApp("/maps/demo", backend());

    await waitFor(() => expect(screen.getByText("Map overview")).toBeInTheDocument());
    expect(screen.getByText("goal 'initial-goal' is not satisfied.")).toBeInTheDocument();
  });

  test("selecting a step is a URL change that opens its detail", async () => {
    renderApp("/maps/demo?step=2", backend());

    await waitFor(() => expect(screen.getByText("Longest-path layering.")).toBeInTheDocument());
    expect(screen.getByText("Do the task.")).toBeInTheDocument();
  });

  test("says so plainly when a map has no steps", async () => {
    renderApp("/maps/fresh-map", backend());

    await waitFor(() => expect(screen.getByText("Nothing charted yet")).toBeInTheDocument());
  });

  test("reports the CLI's own error for a map it cannot read", async () => {
    renderApp("/maps/broken", backend());

    await waitFor(() =>
      expect(screen.getByText("wayful: malformed map metadata.")).toBeInTheDocument(),
    );
  });

  test("collapses the maps rail, then restores it from the floating button", async () => {
    renderApp("/maps/demo", backend());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
    expect(screen.getByRole("navigation", { name: "Maps" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse maps rail" }));
    expect(screen.queryByRole("navigation", { name: "Maps" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show maps rail" }));
    expect(screen.getByRole("navigation", { name: "Maps" })).toBeInTheDocument();
  });

  test("collapses the step detail panel without losing the selected step", async () => {
    renderApp("/maps/demo?step=2", backend());
    await waitFor(() => expect(screen.getByText("Longest-path layering.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Collapse step detail" }));
    expect(screen.queryByText("Longest-path layering.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show map overview" }));
    await waitFor(() => expect(screen.getByText("Longest-path layering.")).toBeInTheDocument());
  });

  test("shows a step's slot-bound and supplementary input attachments by ref and kind", async () => {
    const consumer = step(1, {
      name: "consumer",
      required_inputs: [{ name: "brief-slot", kind: "document" }],
      inputs: [
        { slot: "brief-slot", ref: "docs/brief.md" },
        { ref: "docs/notes.md", kind: "note" },
      ],
    });
    const demo = detail([consumer]);
    renderApp("/maps/demo?step=1", {
      overview: overview([{ name: "demo", start: "Somewhere", status: demo.status }]),
      maps: { demo },
      steps: { 1: { ...consumer, body: "", instructions: "" } as StepDetail },
    });

    await waitFor(() => expect(screen.getByText("brief-slot")).toBeInTheDocument());
    expect(screen.getByText("docs/brief.md")).toBeInTheDocument();
    expect(screen.getByText("docs/notes.md")).toBeInTheDocument();
    expect(screen.getByText("note")).toBeInTheDocument();
  });

  test("shows each step's output refs in list view", async () => {
    const producer = step(1, {
      name: "producer",
      outputs: [{ slot: "result-slot", ref: "path/result" }],
    });
    const demo = detail([producer]);
    renderApp("/maps/demo?view=list", {
      overview: overview([{ name: "demo", start: "Somewhere", status: demo.status }]),
      maps: { demo },
    });

    await waitFor(() => expect(screen.getByText("path/result")).toBeInTheDocument());
  });
});
