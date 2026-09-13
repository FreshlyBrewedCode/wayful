import { Console, DateTime, Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";

import { diagnoseGithub } from "@backend/github/doctor";
import type { RateLimit } from "@backend/github/http";
import { ProjectStore } from "@backend/ProjectStore";
import { resolveProject, strict } from "@/scope";
import { handle } from "@cli/render";
import { wayfulRoot } from "@cli/root";

const formatReset = (epochSeconds: number): string =>
  epochSeconds > 0
    ? DateTime.formatIso(DateTime.makeUnsafe(epochSeconds * 1000))
    : "the next reset window";

/** The one-line rate-limit budget, or a note that the check did not report one. */
export function rateLimitLine(rateLimit: Option.Option<RateLimit>): string {
  if (Option.isNone(rateLimit)) return "Rate limit: not reported by the access check";
  const budget = rateLimit.value;
  return `Rate limit: ${budget.remaining}/${budget.limit} ${budget.resource} remaining (resets at ${formatReset(budget.reset)})`;
}

export const doctorCommand = Command.make("doctor", {}, () =>
  handle(
    false,
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      const projectStore = yield* ProjectStore;
      const project = yield* resolveProject(root.project);
      yield* Console.log(`Project: ${project.root}`);
      yield* Console.log(`Backend: ${project.backend}`);

      if (project.backend !== "github") {
        yield* Console.log("GitHub: not applicable (filesystem backend)");
        return;
      }

      const types = yield* strict(yield* projectStore.listTypes(project));
      const diagnosis = yield* diagnoseGithub(
        project,
        types.map((type) => type.name),
      );
      yield* Console.log(`Repository: ${diagnosis.repository}`);
      yield* Console.log(`Host: ${diagnosis.host}`);
      yield* Console.log(`Credential: ${diagnosis.credential}`);
      yield* Console.log(`Labels: ${diagnosis.labels.join(", ")}`);
      yield* Console.log(rateLimitLine(diagnosis.rateLimit));
    }),
  ),
).pipe(
  Command.withDescription(
    "Diagnose a project's backend, repository, credential, labels, and budget",
  ),
);
