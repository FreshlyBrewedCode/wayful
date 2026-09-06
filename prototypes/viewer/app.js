// PROTOTYPE — throwaway client for the Wayful viewer.
//
// Everything rendered here comes from the CLI's own `--json` output. The one
// thing the client computes is *layout*: which column a step sits in, derived
// from dependency depth. Status, readiness and validity are the CLI's answers,
// never re-derived.

const $ = (id) => document.getElementById(id);

const state = {
  overview: null,
  mapName: null,
  detail: null, // { map, status, next, validation }
  selected: null, // step id
  view: "graph",
  showCancelled: true,
  // Graph viewport. `key` ties the transform to what is currently drawn, so a
  // re-render keeps the user's pan but a different map starts fitted.
  transform: { key: null, mode: "fit", scale: 1, x: 0, y: 0 },
  viewport: null,
};

// --------------------------------------------------------------- primitives

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
};

const fill = (node, children) => {
  node.replaceChildren(...[].concat(children).filter(Boolean));
  return node;
};

/** A step's visual status. `ready` is a pending step the CLI put in `map next`. */
const statusOf = (step, next) =>
  step.status === "pending" && next.includes(step.id) ? "ready" : step.status;

const LABELS = {
  ready: "ready",
  pending: "pending",
  blocked: "blocked",
  complete: "complete",
  cancelled: "cancelled",
};

const pill = (status) =>
  el("span", { class: `status-pill s-${status}`, text: LABELS[status] });

// -------------------------------------------------------------------- fetch

async function load(path) {
  const response = await fetch(path);
  return response.json();
}

async function refresh({ keepSelection = true } = {}) {
  state.overview = await load("/api/overview");
  const names = state.overview.maps.map((m) => m.name);
  if (!state.mapName || !names.includes(state.mapName)) {
    state.mapName = names[0] ?? null;
  }
  renderChrome();
  if (state.mapName) await loadMap(state.mapName, { keepSelection });
  else fill($("view"), emptyState("No maps yet", "This project has no maps. Create one with `wayful map create`."));
}

async function loadMap(name, { keepSelection = false } = {}) {
  state.mapName = name;
  state.detail = await load(`/api/map?name=${encodeURIComponent(name)}`);
  if (!keepSelection) state.selected = null;
  else if (!state.detail.map?.steps?.some((s) => s.id === state.selected)) {
    state.selected = null;
  }
  renderChrome();
  renderMap();
  if (state.selected !== null) openStep(state.selected, { focus: false });
  else closeDetail();
}

// ------------------------------------------------------------------ chrome

function renderChrome() {
  const overview = state.overview;
  if (!overview) return;

  $("project-name").textContent = overview.project.root.split("/").pop() || "project";
  $("project-description").textContent =
    overview.project.description || overview.project.error || overview.project.root;

  fill(
    $("map-list"),
    overview.maps.map((map) => {
      const counts = map.status?.steps ?? {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const seg = (kind) =>
        counts[kind]
          ? el("i", { class: `m-${kind}`, style: `width:${(counts[kind] / total) * 100}%` })
          : null;
      return el("li", {}, [
        el(
          "button",
          {
            class: "map-card",
            "aria-current": String(map.name === state.mapName),
            onclick: () => {
              loadMap(map.name);
              closeRail();
            },
          },
          [
            el("span", { class: "name", text: map.name }),
            el("span", { class: "start", text: map.start }),
            total
              ? el("span", { class: "meter" }, [seg("complete"), seg("blocked"), seg("pending")])
              : null,
            el("span", { class: "counts" }, [
              el("span", {}, [
                el("b", { text: `${map.status?.goals?.satisfied ?? 0}/${map.status?.goals?.total ?? 0}` }),
                document.createTextNode(" goals"),
              ]),
              el("span", {}, [el("b", { text: String(total) }), document.createTextNode(" steps")]),
              counts.blocked
                ? el("span", { style: "color:var(--s-blocked)" }, [
                    el("b", { style: "color:var(--s-blocked)", text: String(counts.blocked) }),
                    document.createTextNode(" blocked"),
                  ])
                : null,
            ]),
          ],
        ),
      ]);
    }),
  );

  fill(
    $("type-list"),
    overview.types.map((type) => el("li", { text: type.name, title: type.description })),
  );
}

// ---------------------------------------------------------------- map header

function renderMapHead() {
  const { map, status, validation } = state.detail;
  const artifactsByName = new Map(map.artifacts.map((a) => [a.name, a]));

  // Goal bodies live in the tooltip: the header is a summary, not a document.
  const goalRow = el(
    "div",
    { class: "goal-row" },
    map.goals.map((goal) =>
      el(
        "div",
        {
          class: "goal",
          "data-satisfied": String(goal.evidence.length > 0),
          title: goal.body ? `${goal.name}\n\n${goal.body}` : goal.name,
        },
        [
          el("span", { class: "tick", text: goal.evidence.length ? "✓" : "" }),
          el("div", {}, [
            el("div", { class: "g-desc" }, [
              document.createTextNode(goal.description),
              el("span", { class: "g-name", text: goal.name }),
            ]),
            goal.evidence.length
              ? el(
                  "div",
                  { class: "g-evidence" },
                  goal.evidence.map((name) =>
                    artifactChip(name, artifactsByName.get(name)),
                  ),
                )
              : null,
          ]),
        ],
      ),
    ),
  );

  const blockers = status?.blockers ?? [];
  const counts = status?.steps ?? {};

  // On a phone the start/goals/artifacts block would fill the whole first
  // screen, so it collapses behind a summary and the map itself stays visible.
  const details = el("details", { class: "head-details", open: !isPhone() }, [
    el("summary", {}, [
      el("span", { class: "sum-start", text: map.start }),
      el("span", { class: "chips" }, [
        el("span", {
          class: "chip",
          text: `${status?.goals?.satisfied ?? 0}/${status?.goals?.total ?? 0} goals`,
        }),
        el("span", { class: "chip", text: `${counts.complete ?? 0}/${
          (counts.complete ?? 0) + (counts.pending ?? 0) + (counts.blocked ?? 0)
        } steps done` }),
        blockers.length
          ? el("span", { class: "chip s-blocked", style: "color:var(--s)", text: `${blockers.length} blocked` })
          : null,
      ]),
    ]),
  ]);

  fill($("map-head"), [
    el("div", { class: "map-title" }, [
      el("h1", { text: map.name }),
      el("span", {
        class: "verdict",
        "data-valid": String(Boolean(validation?.valid)),
        text: validation?.valid ? "map valid" : `${validation?.errors?.length ?? 0} open findings`,
        title: (validation?.errors ?? []).join("\n"),
      }),
    ]),
    details,
  ]);

  details.append(
    ...[
    el("div", { class: "journey" }, [
      el("div", { class: "waypoint" }, [
        el("h3", { text: "Start" }),
        el("p", { text: map.start }),
      ]),
      el("div", { class: "arrow" }, [arrowIcon()]),
      el("div", { class: "waypoint" }, [
        el("h3", { text: `Goals · ${status?.goals?.satisfied ?? 0} of ${status?.goals?.total ?? 0} satisfied` }),
        goalRow,
      ]),
    ]),
    blockers.length
      ? el("div", { class: "blockers" }, [
          el("h3", { text: `${blockers.length} blocker${blockers.length > 1 ? "s" : ""}` }),
          el(
            "ul",
            {},
            blockers.map((b) =>
              el("li", {}, [
                el("button", {
                  class: "dep-link",
                  text: `${b.id} ${b.name}`,
                  onclick: () => openStep(b.id),
                }),
                document.createTextNode(` — ${b.reason ?? "no reason recorded"}`),
              ]),
            ),
          ),
        ])
      : null,
    map.artifacts.length
      ? el("div", { class: "chips artifact-row" }, [
          el("span", { class: "chip", text: `${map.artifacts.length} artifacts` }),
          ...map.artifacts.map((a) => artifactChip(a.name, a)),
        ])
      : null,
    ].filter(Boolean),
  );
}

const isPhone = () => window.matchMedia("(max-width: 720px)").matches;

function artifactChip(name, artifact) {
  const label = artifact ? `${name} · ${artifact.kind}` : `${name} (missing)`;
  return el("span", {
    class: "chip art",
    text: label,
    title: artifact ? artifact.ref : "artifact not registered on this map",
    onclick: () => artifact && alert(`${artifact.name}\nkind: ${artifact.kind}\nref:  ${artifact.ref}`),
  });
}

const arrowIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 12h17m0 0-6-6m6 6-6 6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
};

// ------------------------------------------------------------------- render

function renderMap() {
  if (!state.detail) return;
  if (state.detail.error) {
    fill($("view"), emptyState("Cannot read this map", state.detail.error));
    return;
  }
  renderMapHead();
  const steps = visibleSteps();
  if (!steps.length) {
    fill(
      $("view"),
      emptyState(
        "Nothing charted yet",
        state.detail.map.steps.length
          ? "Every step on this map is cancelled. Turn cancelled steps back on to see them."
          : "This map has a start and a destination but no steps. That is a legitimate state — the path is still fog.",
      ),
    );
    return;
  }
  if (state.view === "graph") renderGraph(steps);
  else if (state.view === "board") renderBoard(steps);
  else renderList(steps);
}

const visibleSteps = () =>
  (state.detail?.map?.steps ?? []).filter(
    (s) => state.showCancelled || s.status !== "cancelled",
  );

function emptyState(title, body) {
  return el("div", { class: "empty-state" }, [
    el("strong", { text: title }),
    el("p", { text: body }),
  ]);
}

// -------------------------------------------------------------- graph view

const NODE_W = 218;
const NODE_H = 108;
const COL_GAP = 78;
const ROW_GAP = 18;
const TERM_W = 168;
const PAD = 22;

/** Longest-path layering: a step sits one column right of its deepest prerequisite. */
function layer(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const depth = new Map();
  const walk = (step, seen = new Set()) => {
    if (depth.has(step.id)) return depth.get(step.id);
    if (seen.has(step.id)) return 0; // the CLI rejects cycles; be defensive anyway
    seen.add(step.id);
    const deps = step.dependencies.map((id) => byId.get(id)).filter(Boolean);
    const value = deps.length ? Math.max(...deps.map((d) => walk(d, seen))) + 1 : 0;
    depth.set(step.id, value);
    return value;
  };
  steps.forEach((s) => walk(s));
  const columns = [];
  for (const step of steps) {
    const d = depth.get(step.id) ?? 0;
    (columns[d] ??= []).push(step);
  }
  columns.forEach((column) => column.sort((a, b) => a.id - b.id));
  return columns;
}

function renderGraph(steps) {
  const { next } = state.detail;
  const columns = layer(steps);
  const positions = new Map();

  const rows = Math.max(1, ...columns.map((c) => c.length));
  const band = rows * NODE_H + (rows - 1) * ROW_GAP;
  const height = band + PAD * 2;
  const width =
    PAD * 2 + TERM_W + COL_GAP + columns.length * (NODE_W + COL_GAP) + TERM_W;
  const midY = PAD + band / 2;

  const canvas = el("div", {
    class: "graph-canvas",
    style: `width:${width}px;height:${height}px`,
  });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "edges");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  canvas.append(svg);

  const columnX = (index) => PAD + TERM_W + COL_GAP + index * (NODE_W + COL_GAP);
  const centred = (count, index) => {
    const span = count * NODE_H + (count - 1) * ROW_GAP;
    return PAD + (band - span) / 2 + index * (NODE_H + ROW_GAP);
  };

  // Start terminus.
  canvas.append(
    el(
      "div",
      {
        class: "terminus",
        style: `left:${PAD}px;top:${midY - 44}px;width:${TERM_W}px`,
      },
      [
        el("h4", { text: "Start" }),
        el("p", { text: state.detail.map.start }),
      ],
    ),
  );

  columns.forEach((column, columnIndex) => {
    column.forEach((step, rowIndex) => {
      const x = columnX(columnIndex);
      const y = centred(column.length, rowIndex);
      positions.set(step.id, { x, y });
      canvas.append(nodeFor(step, next, `left:${x}px;top:${y}px;width:${NODE_W}px;min-height:${NODE_H}px`));
    });
  });

  // Goal terminus.
  const goals = state.detail.map.goals;
  const satisfied = goals.filter((g) => g.evidence.length).length;
  canvas.append(
    el(
      "div",
      {
        class: "terminus goal-post",
        style: `left:${columnX(columns.length)}px;top:${midY - 44}px;width:${TERM_W}px`,
      },
      [
        el("h4", { text: `Goals ${satisfied}/${goals.length}` }),
        ...goals.map((g) =>
          el("p", { text: `${g.evidence.length ? "✓" : "○"} ${g.description}` }),
        ),
      ],
    ),
  );

  // Edges, drawn after positions are known.
  const line = (x1, y1, x2, y2, className) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const mid = (x1 + x2) / 2;
    path.setAttribute("d", `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`);
    path.setAttribute("class", className);
    svg.append(path);
  };

  for (const step of steps) {
    const to = positions.get(step.id);
    if (!to) continue;
    const dependencies = step.dependencies.filter((id) => positions.has(id));
    if (!dependencies.length) {
      line(PAD + TERM_W, midY, to.x, to.y + NODE_H / 2, "edge dim");
    }
    for (const id of dependencies) {
      const from = positions.get(id);
      const hot = state.selected === step.id || state.selected === id;
      line(
        from.x + NODE_W,
        from.y + NODE_H / 2,
        to.x,
        to.y + NODE_H / 2,
        `edge${hot ? " hot" : ""}${step.status === "cancelled" ? " dim" : ""}`,
      );
    }
  }
  // Steps nothing depends on point at the goal post.
  const depended = new Set(steps.flatMap((s) => s.dependencies));
  for (const step of steps) {
    if (depended.has(step.id) || step.status === "cancelled") continue;
    const from = positions.get(step.id);
    line(from.x + NODE_W, from.y + NODE_H / 2, columnX(columns.length), midY, "edge dim");
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const wrap = el("div", { class: "graph-wrap" }, canvas);
  wrap.append(zoomHud());
  fill($("view"), wrap);
  attachViewport(wrap, canvas, width, height);
}

// ------------------------------------------------------------ graph viewport
//
// The canvas fills its column and is moved by a transform rather than by
// scrolling, so wheel-zoom, drag-pan and pinch all act on one source of truth.

const MIN_SCALE = 0.15;
const MAX_SCALE = 2.5;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function zoomHud() {
  const button = (label, title, onclick) =>
    el("button", { class: "hud-button", title, "aria-label": title, text: label, onclick });
  return el("div", { class: "graph-hud" }, [
    button("−", "Zoom out", () => nudgeZoom(1 / 1.25)),
    el("button", {
      class: "hud-button hud-level",
      id: "zoom-level",
      title: "Reset to 100%",
      "aria-label": "Reset zoom to 100%",
      text: "100%",
      onclick: () => setZoom(1),
    }),
    button("+", "Zoom in", () => nudgeZoom(1.25)),
    el("button", {
      class: "hud-button hud-fit",
      title: "Fit map to view",
      "aria-label": "Fit map to view",
      text: "Fit",
      onclick: () => state.viewport?.fit(),
    }),
  ]);
}

const nudgeZoom = (factor) => state.viewport?.zoomBy(factor);
const setZoom = (scale) => state.viewport?.zoomTo(scale);

function attachViewport(wrap, canvas, width, height) {
  // Re-rendering (selecting a step, a live-reload push) must not throw away
  // where the user has panned to. The transform is keyed to what is on screen.
  const key = `${state.mapName}:${state.showCancelled}:${width}x${height}`;
  const t = state.transform;
  if (t.key !== key) {
    t.key = key;
    t.mode = "auto";
  }

  const paint = () => {
    canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
    const level = document.getElementById("zoom-level");
    if (level) level.textContent = `${Math.round(t.scale * 100)}%`;
  };

  /** Keep at least a corner of the map on screen, whatever the user drags. */
  const constrain = () => {
    const margin = 90;
    t.x = clamp(t.x, -(width * t.scale) + margin, wrap.clientWidth - margin);
    t.y = clamp(t.y, -(height * t.scale) + margin, wrap.clientHeight - margin);
  };

  // Two flavours of "reset". `auto` is the opening view: centred, and never so
  // small that the labels stop being words — panning covers the rest. `fit` is
  // the explicit bird's-eye and is honest about showing everything.
  const LEGIBLE = 0.55;
  const refit = (floor = MIN_SCALE) => {
    const availableW = wrap.clientWidth;
    const availableH = wrap.clientHeight;
    if (!availableW || !availableH) return;
    t.scale = clamp(
      Math.min(availableW / (width + 24), availableH / (height + 24), 1),
      floor,
      MAX_SCALE,
    );
    t.x = (availableW - width * t.scale) / 2;
    t.y = (availableH - height * t.scale) / 2;
    paint();
  };
  const reset = () => refit(t.mode === "auto" ? LEGIBLE : MIN_SCALE);

  /** Zoom about a viewport point so whatever is under it stays put. */
  const zoomAbout = (nextScale, px, py) => {
    const next = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (next === t.scale) return;
    t.x = px - (px - t.x) * (next / t.scale);
    t.y = py - (py - t.y) * (next / t.scale);
    t.scale = next;
    t.mode = "manual";
    constrain();
    paint();
  };

  const centre = () => [wrap.clientWidth / 2, wrap.clientHeight / 2];

  state.viewport = {
    fit: () => {
      t.mode = "fit";
      reset();
    },
    zoomBy: (factor) => zoomAbout(t.scale * factor, ...centre()),
    zoomTo: (scale) => zoomAbout(scale, ...centre()),
  };

  if (t.mode === "manual") paint();
  else reset();

  // --- wheel: zoom at the cursor. Trackpad two-finger pans, ctrl/⌘ zooms.
  wrap.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey || event.deltaX === 0) {
        zoomAbout(t.scale * Math.exp(-event.deltaY * 0.0018), px, py);
      } else {
        t.x -= event.deltaX;
        t.y -= event.deltaY;
        t.mode = "manual";
        constrain();
        paint();
      }
    },
    { passive: false },
  );

  // --- pointers: one drags, two pinch.
  const pointers = new Map();
  let pinch = null;
  let moved = 0;

  wrap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (event.target.closest(".graph-hud")) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved = 0;
    if (pointers.size === 2) pinch = pinchState();
    wrap.setPointerCapture(event.pointerId);
    wrap.dataset.grabbing = "true";
  });

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    const rect = wrap.getBoundingClientRect();
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      scale: t.scale,
      px: (a.x + b.x) / 2 - rect.left,
      py: (a.y + b.y) / 2 - rect.top,
    };
  };

  wrap.addEventListener("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved += Math.abs(dx) + Math.abs(dy);

    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAbout((distance / pinch.distance) * pinch.scale, pinch.px, pinch.py);
      return;
    }
    t.x += dx;
    t.y += dy;
    t.mode = "manual";
    constrain();
    paint();
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      delete wrap.dataset.grabbing;
      // A drag that ended on a node must not also select it.
      if (moved > 6) {
        wrap.dataset.dragged = "true";
        setTimeout(() => delete wrap.dataset.dragged, 0);
      }
    }
  };
  wrap.addEventListener("pointerup", release);
  wrap.addEventListener("pointercancel", release);

  // --- keyboard users tab through nodes; bring the focused one into view.
  wrap.addEventListener("focusin", (event) => {
    const node = event.target.closest(".node");
    if (!node) return;
    const nodeLeft = parseFloat(node.style.left);
    const nodeTop = parseFloat(node.style.top);
    const x = nodeLeft * t.scale + t.x;
    const y = nodeTop * t.scale + t.y;
    const w = NODE_W * t.scale;
    const h = NODE_H * t.scale;
    const pad = 24;
    t.x += Math.max(0, pad - x) - Math.max(0, x + w + pad - wrap.clientWidth);
    t.y += Math.max(0, pad - y) - Math.max(0, y + h + pad - wrap.clientHeight);
    t.mode = "manual";
    paint();
  });

  if (renderGraph.observer) renderGraph.observer.disconnect();
  renderGraph.observer = new ResizeObserver(() => {
    if (t.mode === "manual") {
      constrain();
      paint();
    } else reset();
  });
  renderGraph.observer.observe(wrap);
}

function nodeFor(step, next, style) {
  const status = statusOf(step, next);
  return el(
    "button",
    {
      class: `node s-${status}`,
      style,
      "aria-current": String(state.selected === step.id),
      // Ignore the click that ends a pan.
      onclick: (event) => {
        if (event.currentTarget.closest(".graph-wrap")?.dataset.dragged) return;
        openStep(step.id);
      },
    },
    [
      el("span", { class: "n-top" }, [
        el("span", { class: "n-id", text: `#${step.id}` }),
        el("span", { class: "n-name", text: step.name }),
      ]),
      el("span", { class: "n-desc", text: step.description }),
      el("span", { class: "n-foot" }, [
        pill(status),
        el("span", { class: "n-type", text: step.type }),
        status === "ready" ? el("span", { class: "ready-flag", text: "▶ next" }) : null,
      ]),
    ],
  );
}

// -------------------------------------------------------------- board view

const COLUMN_ORDER = ["ready", "pending", "blocked", "complete", "cancelled"];

function renderBoard(steps) {
  const { next } = state.detail;
  const groups = Object.fromEntries(COLUMN_ORDER.map((k) => [k, []]));
  for (const step of steps) groups[statusOf(step, next)].push(step);

  fill(
    $("view"),
    el(
      "div",
      { class: "board" },
      COLUMN_ORDER.filter((key) => key !== "cancelled" || groups[key].length).map((key) =>
        el("div", { class: `column s-${key}` }, [
          el("h3", {}, [
            document.createTextNode(LABELS[key]),
            el("em", { text: String(groups[key].length) }),
          ]),
          ...(groups[key].length
            ? groups[key].map((step) =>
                el(
                  "button",
                  {
                    class: `card s-${statusOf(step, next)}`,
                    "aria-current": String(state.selected === step.id),
                    onclick: () => openStep(step.id),
                  },
                  [
                    el("span", { class: "n-top" }, [
                      el("span", { class: "n-id", text: `#${step.id}` }),
                      el("span", { class: "n-name", text: step.name }),
                    ]),
                    el("span", { class: "n-desc", text: step.description }),
                    el("span", { class: "n-foot" }, [el("span", { class: "n-type", text: step.type })]),
                  ],
                ),
              )
            : [el("div", { class: "empty", text: "none" })]),
        ]),
      ),
    ),
  );
}

// --------------------------------------------------------------- list view

function renderList(steps) {
  const { next } = state.detail;
  const head = el("tr", {}, [
    el("th", { class: "mono", text: "#" }),
    el("th", { text: "Step" }),
    el("th", { text: "Type" }),
    el("th", { text: "Status" }),
    el("th", { text: "Depends on" }),
    el("th", { text: "Outputs" }),
  ]);
  const rows = steps.map((step) => {
    const status = statusOf(step, next);
    return el(
      "tr",
      {
        class: `s-${status}`,
        tabindex: "0",
        "aria-current": String(state.selected === step.id),
        onclick: () => openStep(step.id),
        onkeydown: (event) => event.key === "Enter" && openStep(step.id),
      },
      [
        el("td", { class: "mono", text: String(step.id) }),
        el("td", {}, [
          el("div", { class: "mono", text: step.name }),
          el("div", { style: "color:var(--ink-dim)", text: step.description }),
        ]),
        el("td", { class: "mono", text: step.type }),
        el("td", {}, [pill(status)]),
        el("td", { class: "mono", text: step.dependencies.join(", ") || "—" }),
        el("td", { class: "mono", text: step.outputs.map((o) => o.artifact).join(", ") || "—" }),
      ],
    );
  });
  fill(
    $("view"),
    el("div", { class: "table-wrap" }, [
      el("table", {}, [el("thead", {}, head), el("tbody", {}, rows)]),
    ]),
  );
}

// ------------------------------------------------------------------ detail

async function openStep(id, { focus = true } = {}) {
  state.selected = id;
  renderMap();
  const detail = $("detail");
  detail.dataset.open = "true";
  if (window.matchMedia("(max-width: 1200px)").matches) showScrim(closeDetail);
  fill($("detail-body"), el("p", { class: "placeholder", text: "loading…" }));

  const step = await load(
    `/api/step?map=${encodeURIComponent(state.mapName)}&ref=${id}`,
  );
  if (state.selected !== id) return;
  renderDetail(step);
  if (focus) detail.querySelector("h2")?.scrollIntoView({ block: "nearest" });
}

function closeDetail() {
  state.selected = null;
  $("detail").dataset.open = "false";
  hideScrim();
  renderOverviewPane();
  renderMap();
}

/** With no step selected the pane earns its width by showing the map's health. */
function renderOverviewPane() {
  const detail = state.detail;
  if (!detail?.map) {
    fill(
      $("detail-body"),
      el("p", { class: "placeholder", text: "Select a step to see its body, contract and type instructions." }),
    );
    return;
  }
  const { map, status, next, validation } = detail;
  const counts = status?.steps ?? {};
  const nextSteps = map.steps.filter((s) => next.includes(s.id));

  fill($("detail-body"), [
    el("h2", { text: "Map overview" }),
    el("p", {
      style: "margin:6px 0 0;color:var(--ink-dim);font-size:12.5px",
      text: "Select a step for its body, contract and type instructions.",
    }),

    el("div", { class: "detail-section" }, [
      el("h3", { text: "Steps" }),
      el(
        "div",
        { class: "chips" },
        ["complete", "pending", "blocked", "cancelled"].map((key) =>
          el("span", { class: `chip s-${key}` }, [
            el("span", { class: "dot", style: "color:var(--s)" }),
            document.createTextNode(`${counts[key] ?? 0} ${key}`),
          ]),
        ),
      ),
    ]),

    el("div", { class: "detail-section" }, [
      el("h3", { text: `Actionable now · ${nextSteps.length}` }),
      ...(nextSteps.length
        ? nextSteps.map((step) =>
            el(
              "button",
              { class: "card s-ready", onclick: () => openStep(step.id) },
              [
                el("span", { class: "n-top" }, [
                  el("span", { class: "n-id", text: `#${step.id}` }),
                  el("span", { class: "n-name", text: step.name }),
                ]),
                el("span", { class: "n-desc", text: step.description }),
              ],
            ),
          )
        : [
            el("div", {
              class: "prose empty",
              text: "Nothing is actionable — every pending step is waiting on a dependency, an input artifact, or a blocker.",
            }),
          ]),
    ]),

    el("div", { class: "detail-section" }, [
      el("h3", { text: validation?.valid ? "Validation" : `Open findings · ${validation?.errors?.length ?? 0}` }),
      validation?.valid
        ? el("div", { class: "prose", text: "wayful map validate reports this map as complete and consistent." })
        : el(
            "ul",
            { class: "findings" },
            (validation?.errors ?? []).map((error) => el("li", { text: error })),
          ),
    ]),
  ]);
}

function renderDetail(step) {
  if (step.error) {
    fill($("detail-body"), el("p", { class: "placeholder", text: step.error }));
    return;
  }
  const { map, next } = state.detail;
  const artifactsByName = new Map(map.artifacts.map((a) => [a.name, a]));
  const stepsById = new Map(map.steps.map((s) => [s.id, s]));
  const status = statusOf(step, next);

  const slotList = (direction) => {
    const required = step[direction === "inputs" ? "required_inputs" : "required_outputs"] ?? [];
    const attached = step[direction] ?? [];
    const bound = required.map((slot) => {
      const hit = attached.find((a) => a.slot === slot.name);
      return el("div", { class: "slot", "data-filled": String(Boolean(hit)) }, [
        el("div", { class: "s-head" }, [
          el("span", { class: "s-name", text: slot.name }),
          el("span", { class: "s-kind", text: slot.kind }),
        ]),
        slot.description ? el("div", { class: "s-desc", text: slot.description }) : null,
        el("div", { class: "s-fill" }, [
          hit
            ? artifactChip(hit.artifact, artifactsByName.get(hit.artifact))
            : el("span", { style: "color:var(--s-ready)", text: "unfilled" }),
        ]),
      ]);
    });
    const extra = attached
      .filter((a) => a.slot === undefined)
      .map((a) => artifactChip(a.artifact, artifactsByName.get(a.artifact)));
    if (!bound.length && !extra.length) return null;
    return el("div", { class: "detail-section" }, [
      el("h3", { text: direction === "inputs" ? "Inputs" : "Outputs" }),
      ...bound,
      extra.length ? el("div", { class: "chips" }, extra) : null,
    ]);
  };

  const reason =
    step.block_reason ?? step.cancellation_reason ?? step.completion_summary ?? null;
  const reasonLabel = step.block_reason
    ? "Blocked because"
    : step.cancellation_reason
      ? "Cancelled because"
      : step.completion_summary
        ? "Completed with"
        : null;

  fill($("detail-body"), [
    el("button", { class: "icon-button detail-close", onclick: closeDetail }, [
      (() => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 20 20");
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", "M5 5l10 10M15 5L5 15");
        p.setAttribute("stroke-linecap", "round");
        svg.append(p);
        return svg;
      })(),
    ]),
    el("div", { class: "n-top", style: "gap:8px;margin-bottom:6px" }, [
      el("span", { class: "n-id", text: `#${step.id}` }),
      pill(status),
    ]),
    el("h2", { text: step.name }),
    el("p", { style: "margin:6px 0 0;color:var(--ink-dim)", text: step.description }),

    reason
      ? el("div", { class: "detail-section" }, [
          el("h3", { text: reasonLabel }),
          el("div", { class: "prose", text: reason }),
        ])
      : null,

    el("div", { class: "detail-section" }, [
      el("h3", { text: "Body" }),
      el("div", { class: `prose${step.body ? "" : " empty"}`, text: step.body || "(empty)" }),
    ]),

    slotList("inputs"),
    slotList("outputs"),

    el("div", { class: "detail-section" }, [
      el("h3", { text: "Graph" }),
      el("dl", { class: "kv" }, [
        el("dt", { text: "type" }),
        el("dd", { text: step.type }),
        el("dt", { text: "depends on" }),
        el(
          "dd",
          {},
          step.dependencies.length
            ? step.dependencies.flatMap((id, i) => [
                i ? document.createTextNode(", ") : null,
                el("button", {
                  class: "dep-link",
                  text: `${id} ${stepsById.get(id)?.name ?? "?"}`,
                  onclick: () => openStep(id),
                }),
              ])
            : [document.createTextNode("—")],
        ),
        el("dt", { text: "unblocks" }),
        el(
          "dd",
          {},
          (() => {
            const dependents = map.steps.filter((s) => s.dependencies.includes(step.id));
            return dependents.length
              ? dependents.flatMap((s, i) => [
                  i ? document.createTextNode(", ") : null,
                  el("button", {
                    class: "dep-link",
                    text: `${s.id} ${s.name}`,
                    onclick: () => openStep(s.id),
                  }),
                ])
              : [document.createTextNode("—")];
          })(),
        ),
      ]),
    ]),

    el("div", { class: "detail-section" }, [
      el("h3", { text: `Type instructions · ${step.type}` }),
      el("div", {
        class: `prose${step.instructions ? "" : " empty"}`,
        text: step.instructions || "(empty)",
      }),
    ]),
  ]);
}

// ------------------------------------------------------------ rail / scrim

let scrimHandler = null;

function showScrim(onDismiss) {
  const scrim = $("scrim");
  scrim.hidden = false;
  scrimHandler = onDismiss;
}
function hideScrim() {
  $("scrim").hidden = true;
  scrimHandler = null;
}
$("scrim").addEventListener("click", () => scrimHandler?.());

const openRail = () => {
  $("rail").dataset.open = "true";
  $("rail-toggle").setAttribute("aria-expanded", "true");
  showScrim(closeRail);
};
const closeRail = () => {
  $("rail").dataset.open = "false";
  $("rail-toggle").setAttribute("aria-expanded", "false");
  hideScrim();
};

$("rail-toggle").addEventListener("click", () =>
  $("rail").dataset.open === "true" ? closeRail() : openRail(),
);
$("rail-close").addEventListener("click", closeRail);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if ($("rail").dataset.open === "true") closeRail();
  else if ($("detail").dataset.open === "true") closeDetail();
});

// ------------------------------------------------------------------ controls

for (const button of document.querySelectorAll('[role="tab"]')) {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    for (const other of document.querySelectorAll('[role="tab"]')) {
      other.setAttribute("aria-selected", String(other === button));
    }
    renderMap();
  });
}

$("show-cancelled").addEventListener("change", (event) => {
  state.showCancelled = event.target.checked;
  renderMap();
});

const THEME_KEY = "wayful-viewer-theme";
const setTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
};
$("theme-toggle").addEventListener("click", () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"),
);
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) setTheme(saved);
  else if (window.matchMedia("(prefers-color-scheme: light)").matches) setTheme("light");
} catch {}

// ---------------------------------------------------------------- live feed

function connect() {
  const source = new EventSource("/api/events");
  const live = $("live");
  source.onopen = () => {
    live.dataset.state = "on";
    $("live-label").textContent = "live";
  };
  source.onerror = () => {
    live.dataset.state = "off";
    $("live-label").textContent = "offline";
  };
  source.onmessage = (event) => {
    if (event.data !== "changed") return;
    live.dataset.state = "pulse";
    $("live-label").textContent = "updating";
    clearTimeout(connect.timer);
    connect.timer = setTimeout(async () => {
      await refresh({ keepSelection: true });
      live.dataset.state = "on";
      $("live-label").textContent = "live";
    }, 150);
  };
}

// -------------------------------------------------------------------- start

// A seven-step dependency graph is unreadable on a 390px screen. The board is
// the honest default there; Graph is still one tap away.
if (isPhone()) {
  state.view = "board";
  for (const button of document.querySelectorAll('[role="tab"]')) {
    button.setAttribute("aria-selected", String(button.dataset.view === "board"));
  }
}

closeDetail();
refresh().then(connect);
