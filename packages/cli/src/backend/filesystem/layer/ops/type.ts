import { Effect, FileSystem, Path } from "effect";

import { WayfulError } from "@domain/errors";
import { identifier } from "@domain/identifier";
import type { TypeDefinition } from "@domain/model";
import type { ProjectHandle } from "@backend/ProjectStore";
import { decodeType } from "@backend/filesystem/decode";
import { liftSync, parseFrontmatter, readTextFile } from "@backend/filesystem/documents";
import { typeFile, typesDir } from "@backend/filesystem/paths";
import { accessError, collect, fail } from "@backend/filesystem/layer/records";

export function makeTypeOps(fs: FileSystem.FileSystem, path: Path.Path) {
  const readType = (
    project: ProjectHandle,
    name: string,
  ): Effect.Effect<TypeDefinition, WayfulError> =>
    Effect.gen(function* () {
      yield* liftSync(() => identifier(name, "type name"));
      const file = typeFile(path, project.root, name);
      const exists = yield* fs.exists(file).pipe(Effect.mapError(accessError));
      if (!exists) return yield* fail(`type '${name}' does not exist.`);
      const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
      const { data, body } = yield* liftSync(() => parseFrontmatter(text, file));
      return yield* liftSync(() => decodeType(name, data, body));
    });

  return {
    listTypes: (project: ProjectHandle) =>
      Effect.gen(function* () {
        const dir = typesDir(path, project.root);
        const files = yield* fs
          .readDirectory(dir)
          .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read project types." })));
        const names = files
          .filter((file) => file.endsWith(".md"))
          .map((file) => file.slice(0, -3))
          .toSorted();
        return yield* collect(
          names,
          (name) => `${name}.md`,
          (name) => readType(project, name),
        );
      }),

    getType: (project: ProjectHandle, name: string) => readType(project, name),
  };
}
