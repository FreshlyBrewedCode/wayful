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
import { handle } from "@cli/render";
import { wayfulRoot } from "@cli/root";

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

        if (backend !== "github") {
          if (Option.isSome(repo))
            yield* Effect.fail(new WayfulError({ message: "--repo requires --backend github." }));
          yield* projectStore.initProject({ directory, description: resolvedDescription, backend });
          yield* Console.log("Initialized Wayful project.");
          return;
        }

        if (Option.isSome(repo) && !REPO_PATTERN.test(repo.value))
          yield* Effect.fail(
            new WayfulError({ message: `--repo must be in the form "owner/name".` }),
          );

        const remote = yield* resolveOriginRemote();
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
        });
        yield* Console.log("Initialized Wayful project.");
      }),
    ),
).pipe(Command.withDescription("Initialize a Wayful project"));
