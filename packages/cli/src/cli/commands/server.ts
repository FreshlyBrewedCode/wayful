import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { resolve } from "node:path";

import { fail } from "../../context";
import { clientDirectory } from "../../server/client";
import { startServer, type RunningServer } from "../../server/http";
import { handle } from "../render";
import { wayfulRoot } from "../root";

const portFlag = Flag.integer("port").pipe(
  Flag.withMetavar("PORT"),
  Flag.withDescription("Port to listen on; 0 binds an ephemeral one"),
  Flag.withDefault(7830),
);

const hostFlag = Flag.string("host").pipe(
  Flag.withMetavar("ADDR"),
  Flag.withDescription("Address to bind"),
  Flag.withDefault("127.0.0.1"),
);

/**
 * `--project`, then `WAYFUL_PROJECT`, then the working directory — the same
 * precedence every other command uses, resolved once so the server reports a
 * stable absolute path no matter where it was launched from.
 */
function projectHint(flag: Option.Option<string>): string {
  return resolve(Option.getOrElse(flag, () => process.env.WAYFUL_PROJECT ?? process.cwd()));
}

function banner(command: string, server: RunningServer, client: string | undefined): string {
  const absent = server.found ? "" : "  (no .wayful here)";
  return [
    `wayful ${command}`,
    `  project : ${server.root}${absent}`,
    ...(client ? [`  client  : ${client}`] : []),
    `  local   : ${server.url}`,
  ].join("\n");
}

/**
 * Runs until interrupted. The banner is printed after binding so it can report
 * the port actually taken, which is the only way a caller learns it when
 * `--port 0` was asked for.
 */
function serveUntilInterrupted(
  command: string,
  options: {
    project: Option.Option<string>;
    port: number;
    host: string;
    client: string | undefined;
  },
) {
  return handle(
    false,
    Effect.gen(function* () {
      const server = yield* startServer({
        project: projectHint(options.project),
        host: options.host,
        port: options.port,
        client: options.client,
      });
      yield* Console.log(banner(command, server, options.client));
      yield* Effect.ensuring(
        Effect.never,
        Effect.sync(() => server.stop()),
      );
    }),
  );
}

export const serveCommand = Command.make(
  "serve",
  { port: portFlag, host: hostFlag },
  ({ port, host }) =>
    Effect.gen(function* () {
      const root = yield* wayfulRoot;
      yield* serveUntilInterrupted("serve", {
        project: root.project,
        port,
        host,
        client: undefined,
      });
    }),
).pipe(Command.withDescription("Serve the read-only viewer API without a client"));

export const uiCommand = Command.make("ui", { port: portFlag, host: hostFlag }, ({ port, host }) =>
  Effect.gen(function* () {
    const root = yield* wayfulRoot;
    const client = clientDirectory();
    if (!client)
      return yield* handle(
        false,
        fail(
          "no built viewer client found; run 'bun run build' in packages/cli, or set WAYFUL_UI_DIST.",
        ),
      );
    yield* serveUntilInterrupted("ui", { project: root.project, port, host, client });
  }),
).pipe(Command.withDescription("Serve the viewer API and the bundled viewer client"));
