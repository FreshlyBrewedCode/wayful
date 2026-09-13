import { Config, ConfigProvider, Context, Effect, Layer, Option, Redacted, Ref } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { WayfulError } from "@domain/errors";

const MISSING_CREDENTIALS_MESSAGE = "run 'gh auth login', or set GH_TOKEN";

/** An environment variable the credential chain consults, in precedence order. */
export type GithubCredentialEnvVar = "WAYFUL_GITHUB_TOKEN" | "GH_TOKEN" | "GITHUB_TOKEN";

export const GITHUB_TOKEN_ENV_VARS: readonly GithubCredentialEnvVar[] = [
  "WAYFUL_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
];

/** Where a resolved token came from, for `wayful doctor` to report. */
export type GithubCredentialSource = GithubCredentialEnvVar | "gh auth token";

export interface ResolvedCredential {
  readonly token: Redacted.Redacted<string>;
  readonly source: GithubCredentialSource;
}

const envToken = (name: string) =>
  Config.option(Config.redacted(name))
    .parse(ConfigProvider.fromEnv())
    .pipe(Effect.orElseSucceed(Option.none));

export class GithubCredentials extends Context.Service<
  GithubCredentials,
  {
    /**
     * Resolves a bearer token for `host` alongside the place it came from;
     * never reads `~/.config/gh/hosts.yml` directly.
     */
    readonly resolve: (host: string) => Effect.Effect<ResolvedCredential, WayfulError>;
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

    const resolve = (host: string): Effect.Effect<ResolvedCredential, WayfulError> =>
      Effect.gen(function* () {
        for (const name of GITHUB_TOKEN_ENV_VARS) {
          const value = yield* envToken(name);
          if (Option.isSome(value)) return { token: value.value, source: name };
        }
        const fromCli = yield* fromGhCli(host);
        if (Option.isSome(fromCli)) return { token: fromCli.value, source: "gh auth token" };
        return yield* new WayfulError({ message: MISSING_CREDENTIALS_MESSAGE });
      });

    const token = (host: string) =>
      resolve(host).pipe(Effect.map((credential) => credential.token));

    return GithubCredentials.of({ resolve, token });
  }),
);
