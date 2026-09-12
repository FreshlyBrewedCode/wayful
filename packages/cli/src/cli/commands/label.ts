import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ProjectStore } from "../../backend/ProjectStore";
import { syncLabels } from "../../backend/github/sync";
import { fail, resolveProject, strict } from "../../scope";
import { handle } from "../render";
import { wayfulRoot } from "../root";

const labelSyncCommand = Command.make("sync", {}, () =>
  handle(
    false,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const projectStore = yield* ProjectStore;
      const project = yield* resolveProject(root.project);
      if (project.backend !== "github") yield* fail("label sync requires the github backend.");
      const types = yield* strict(yield* projectStore.listTypes(project));
      const names = yield* syncLabels(
        project,
        types.map((type) => type.name),
      );
      yield* Console.log(`Synced ${names.length} wayful labels.`);
    }),
  ),
).pipe(Command.withDescription("Create any missing wayful labels, including one per type file"));

export const labelCommand = Command.make("label").pipe(
  Command.withDescription("Manage the wayful label set on the GitHub repository"),
  Command.withSubcommands([labelSyncCommand]),
);
