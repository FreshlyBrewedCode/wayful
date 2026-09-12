import { Context, Effect, Layer, Option, Redacted, Ref } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "@domain/errors";

const MISSING_CREDENTIALS_MESSAGE = "run 'gh auth login', or set GH_TOKEN";

function envToken(name: string): Option.Option<Redacted.Redacted<string>> {
  const value = process.env[name];
  return value ? Option.some(Redacted.make(value)) : Option.none();
}

export class GithubCredentials extends Context.Service<
  GithubCredentials,
  {
    /** Resolves a bearer token for `host`; never reads `~/.config/gh/hosts.yml` directly. */
    readonly token: (host: string) => Effect.Effect<Redacted.Redacted<string>, WayfulError>;
  }
>()("wayful/GithubCredentials") {}

/**
 * Resolves tokens via `WAYFUL_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` >
 * `gh auth token --hostname <host>`, caching each host's resolution (success
 * or absence) so the `gh` subprocess spawns at most once per host per
 * process.
 */
export const GithubCredentialsLayer = Layer.effect(
  GithubCredentials,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cache = yield* Ref.make(new Map<string, Option.Option<Redacted.Redacted<string>>>());

    const fromGhCli = (host: string) =>
      Effect.gen(function* () {
        const cached = yield* Ref.get(cache);
        const hit = cached.get(host);
        if (hit !== undefined) return hit;
        const output = yield* spawner
          .string(ChildProcess.make("gh", ["auth", "token", "--hostname", host]))
          .pipe(Effect.orElseSucceed(() => ""));
        const trimmed = output.trim();
        const resolved = trimmed ? Option.some(Redacted.make(trimmed)) : Option.none();
        yield* Ref.update(cache, (map) => new Map(map).set(host, resolved));
        return resolved;
      });

    const token = (host: string) =>
      Effect.gen(function* () {
        const fromEnv = Option.firstSomeOf([
          envToken("WAYFUL_GITHUB_TOKEN"),
          envToken("GH_TOKEN"),
          envToken("GITHUB_TOKEN"),
        ]);
        if (Option.isSome(fromEnv)) return fromEnv.value;
        const fromCli = yield* fromGhCli(host);
        if (Option.isSome(fromCli)) return fromCli.value;
        return yield* Effect.fail(new WayfulError({ message: MISSING_CREDENTIALS_MESSAGE }));
      });

    return GithubCredentials.of({ token });
  }),
);
