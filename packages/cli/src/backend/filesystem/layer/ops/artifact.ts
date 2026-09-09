import { Effect, FileSystem, Path } from "effect";

import { WayfulError } from "../../../../domain/errors";
import { CURRENT_FORMAT_VERSION, type NewArtifactRecord } from "../../../../domain/model";
import type { MapHandle } from "../../../Backend";
import { decodeArtifact } from "../../decode";
import {
  liftSync,
  nowISO,
  parseYaml,
  readTextFile,
  stringifyYaml,
  writeAtomic,
} from "../../documents";
import { artifactFile, artifactsDir } from "../../paths";
import { accessError, collect, fail } from "../records";

export function makeArtifactOps(fs: FileSystem.FileSystem, path: Path.Path) {
  return {
    listArtifacts: (map: MapHandle) =>
      Effect.gen(function* () {
        const dir = artifactsDir(path, map.dir);
        const files = yield* fs
          .readDirectory(dir)
          .pipe(Effect.mapError(() => new WayfulError({ message: "cannot read artifacts." })));
        const filenames = files.filter((file) => /\.ya?ml$/.test(file));
        const result = yield* collect(
          filenames,
          (filename) => filename,
          (filename) =>
            Effect.gen(function* () {
              const file = path.join(dir, filename);
              const text = yield* readTextFile(fs, file, `cannot read ${file}.`);
              const data = yield* liftSync(() => parseYaml(text, file));
              return yield* liftSync(() => decodeArtifact(filename, data));
            }),
        );
        return {
          records: result.records.toSorted((a, b) => a.name.localeCompare(b.name)),
          errors: result.errors,
        };
      }),

    createArtifact: (map: MapHandle, artifact: NewArtifactRecord) =>
      Effect.gen(function* () {
        const yamlFile = artifactFile(path, map.dir, artifact.id, artifact.name, "yaml");
        const ymlFile = artifactFile(path, map.dir, artifact.id, artifact.name, "yml");
        const yamlExists = yield* fs.exists(yamlFile).pipe(Effect.mapError(accessError));
        const ymlExists = yield* fs.exists(ymlFile).pipe(Effect.mapError(accessError));
        if (yamlExists || ymlExists) yield* fail(`artifact '${artifact.name}' already exists.`);
        const now = yield* nowISO();
        yield* writeAtomic(
          fs,
          yamlFile,
          stringifyYaml({
            format_version: CURRENT_FORMAT_VERSION,
            id: artifact.id,
            name: artifact.name,
            kind: artifact.kind,
            ref: artifact.ref,
            created_at: now,
            updated_at: now,
          }),
        );
      }),
  };
}
