import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ProjectStore } from "@backend/ProjectStore";
import { liftSync } from "@backend/filesystem/documents";
import { REPO_PATTERN } from "@backend/filesystem/decode";
import { ensureLabels, verifyAccess } from "@backend/github/api";
import { GithubCredentials } from "@backend/github/credentials";
import { WAYFUL_LABELS } from "@backend/github/labels";
import { resolveOriginRemote } from "@backend/github/remote";
import { WayfulError } from "@domain/errors";
import { nonEmpty } from "@domain/identifier";
import type { ProjectBackend } from "@domain/model";
import { fail } from "@/scope";
import { handle } from "@cli/render";
import { wayfulRoot } from "@cli/root";

const EXISTING_PROJECT_MESSAGE = "Wayful state already exists; refusing to overwrite it.";

/**
 * The human report `wayful init` prints, naming the backend it bound the
 * project to and, for github, the repository and host.
 */
export function initializedMessage(options: {
  readonly directory: string;
  readonly backend: ProjectBackend;
  readonly repo?: string;
  readonly host?: string;
}): string {
  const details = [`backend: ${options.backend}`];
  if (options.repo !== undefined) details.push(`repository: ${options.repo}`);
  if (options.host !== undefined) details.push(`host: ${options.host}`);
  return `Initialized Wayful project (${details.join(", ")}) in ${options.directory}.`;
}

export const initCommand = Command.make(
  "init",
  {
    description: Flag.string("description").pipe(
      Flag.withMetavar("TEXT"),
      Flag.withDescription("Optional project description"),
      Flag.optional,
    ),
    backend: Flag.choice("backend", ["filesystem", "github"] as const).pipe(
      Flag.withDefault("filesystem"),
      Flag.withDescription("Project backend"),
    ),
    repo: Flag.string("repo").pipe(
      Flag.withMetavar("OWNER/NAME"),
      Flag.withDescription("Repository for the github backend; defaults to the git remote"),
      Flag.optional,
    ),
  },
  ({ description, backend, repo }) =>
    handle(
      false,
      Effect.gen(function* () {
        const root = yield* wayfulRoot;
        const projectStore = yield* ProjectStore;
        const directory = Option.getOrElse(root.project, () => process.cwd());
        const resolvedDescription = yield* Option.match(description, {
          onNone: () => Effect.succeed(""),
          onSome: (value) => liftSync(() => nonEmpty(value, "project description")),
        });

        if (backend !== "github" && Option.isSome(repo))
          return yield* new WayfulError({ message: "--repo requires --backend github." });
        if (backend === "github" && Option.isSome(repo) && !REPO_PATTERN.test(repo.value))
          return yield* new WayfulError({
            message: `--repo must be in the form "owner/name".`,
          });

        // Checked before any remote work: a repeat init must leave the remote
        // untouched rather than verifying access and creating labels first.
        if (yield* projectStore.projectExists(directory))
          return yield* fail(EXISTING_PROJECT_MESSAGE);

        if (backend !== "github") {
          yield* projectStore.initProject({ directory, description: resolvedDescription, backend });
          yield* Console.log(initializedMessage({ directory, backend }));
          return;
        }

        // The remote is read in the directory being initialised, not the
        // process working directory, so the recorded host matches the project.
        const remote = yield* resolveOriginRemote(directory);
        const host = Option.match(remote, { onNone: () => "github.com", onSome: (r) => r.host });
        const ownerName = yield* Option.match(repo, {
          onSome: (value) => Effect.succeed(value),
          onNone: () =>
            Option.match(remote, {
              onSome: (r) => Effect.succeed(`${r.owner}/${r.repo}`),
              onNone: () =>
                Effect.fail(
                  new WayfulError({ message: "no git remote found; pass --repo owner/name." }),
                ),
            }),
        });
        const [owner, name] = ownerName.split("/");
        const ref = { host, owner: owner!, repo: name! };

        const credentials = yield* GithubCredentials;
        const token = yield* credentials.token(host);
        yield* verifyAccess(ref, token);
        yield* ensureLabels(ref, token, WAYFUL_LABELS);

        yield* projectStore.initProject({
          directory,
          description: resolvedDescription,
          backend,
          repo: ownerName,
          host,
        });
        yield* Console.log(initializedMessage({ directory, backend, repo: ownerName, host }));
      }),
    ),
).pipe(Command.withDescription("Initialize a Wayful project"));
