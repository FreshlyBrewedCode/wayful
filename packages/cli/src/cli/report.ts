import { Console, Effect, Schema } from "effect";

const errorOutputJson = Schema.fromJsonString(Schema.Struct({ error: Schema.String }));

/**
 * The `wayful: `/`--json`/exit-code contract every command failure reports
 * through — parse-stage usage mistakes in `main.ts` and domain/backend
 * failures in `render.ts`'s `handle()` alike, so a caller never has to
 * special-case which stage rejected it. `usageHint`, when given, is its own
 * `wayful: `-prefixed stderr line (e.g. "See '<path> --help'.") but never
 * folds into the `--json` body, so a caller parsing `{"error": ...}` only
 * ever sees the diagnosis, not a human-facing next-step pointer.
 */
export function report(options: {
  readonly json: boolean;
  readonly message: string;
  readonly usageHint?: string;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Console.error(`wayful: ${options.message}`);
    if (options.usageHint) yield* Console.error(`wayful: ${options.usageHint}`);
    if (options.json)
      yield* Console.log(
        yield* Schema.encodeEffect(errorOutputJson)({ error: options.message }).pipe(Effect.orDie),
      );
    process.exitCode = 2;
  });
}
