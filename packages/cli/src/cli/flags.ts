import { Flag } from "effect/unstable/cli";

// `--project`/`--map` resolve against WAYFUL_PROJECT/WAYFUL_MAP with the flag
// taking precedence, replicated manually in cli/scope.ts so the exact
// "map context is required; pass --map or set WAYFUL_MAP." message survives
// rather than a framework-generated missing-option error.
export const projectFlag = Flag.string("project").pipe(
  Flag.withMetavar("DIR"),
  Flag.withDescription("Project directory"),
  Flag.optional,
);

export const mapFlag = Flag.string("map").pipe(
  Flag.withMetavar("NAME"),
  Flag.withDescription("Map name"),
  Flag.optional,
);

export const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Render stable JSON output"),
  Flag.withDefault(false),
);
