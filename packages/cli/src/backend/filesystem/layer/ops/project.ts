import { Effect, FileSystem, Option, Path } from "effect";

import { WayfulError } from "@domain/errors";
import { CURRENT_FORMAT_VERSION, type ProjectBackend } from "@domain/model";
import {
  buildMarkdown,
  liftSync,
  nowISO,
  parseToml,
  readTextFile,
  stringifyToml,
  writeAtomic,
} from "@backend/filesystem/documents";
import { decodeProjectMetadata } from "@backend/filesystem/decode";
import { projectFile, typeFile, typesDir } from "@backend/filesystem/paths";
import { accessError, fail } from "@backend/filesystem/layer/records";

export function makeProjectOps(fs: FileSystem.FileSystem, path: Path.Path) {
  const discoverProjectRoot = (start: string): Effect.Effect<string, WayfulError> =>
    Effect.gen(function* () {
      let current = path.resolve(start);
      while (true) {
        const exists = yield* fs
          .exists(projectFile(path, current))
          .pipe(Effect.mapError(accessError));
        if (exists) return current;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return yield* fail("no Wayful project found; run 'wayful init' first.");
    });

  return {
    initProject: ({
      directory,
      description,
      backend = "filesystem",
      repo,
    }: {
      readonly directory: string;
      readonly description: string;
      readonly backend?: ProjectBackend;
      readonly repo?: string;
    }) =>
      Effect.gen(function* () {
        const root = path.resolve(directory);
        const wayfulDir = path.join(root, ".wayful");
        const exists = yield* fs.exists(wayfulDir).pipe(Effect.mapError(accessError));
        if (exists) yield* fail("Wayful state already exists; refusing to overwrite it.");
        const onCreateError = new WayfulError({ message: `cannot create ${root}.` });
        yield* fs
          .makeDirectory(typesDir(path, root), { recursive: true })
          .pipe(Effect.mapError(() => onCreateError));
        const now = yield* nowISO();
        yield* writeAtomic(
          fs,
          projectFile(path, root),
          stringifyToml({
            format_version: CURRENT_FORMAT_VERSION,
            description,
            backend,
            ...(repo !== undefined ? { repo } : {}),
            created_at: now,
            updated_at: now,
          }),
        );
        yield* writeAtomic(
          fs,
          typeFile(path, root, "task"),
          buildMarkdown({
            format_version: CURRENT_FORMAT_VERSION,
            name: "task",
            description: "A general-purpose work step.",
            required_inputs: [],
            required_outputs: [],
          }),
        );
      }),

    openProject: (hint: Option.Option<string>) =>
      Effect.gen(function* () {
        const start = Option.getOrElse(hint, () => process.cwd());
        const root = yield* discoverProjectRoot(start);
        const file = projectFile(path, root);
        const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
        const data = yield* liftSync(() => parseToml(text, file));
        const metadata = yield* liftSync(() => decodeProjectMetadata(data));
        return {
          root,
          description: metadata.description,
          backend: metadata.backend,
          repo: metadata.repo,
        };
      }),
  };
}
