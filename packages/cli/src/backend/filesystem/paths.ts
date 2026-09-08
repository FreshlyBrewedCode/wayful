import type { Path } from "effect";

export const projectFile = (path: Path.Path, root: string) =>
  path.join(root, ".wayful", "project.toml");

export const typesDir = (path: Path.Path, root: string) => path.join(root, ".wayful", "types");

export const typeFile = (path: Path.Path, root: string, name: string) =>
  path.join(typesDir(path, root), `${name}.md`);

export const mapsDir = (path: Path.Path, root: string) => path.join(root, ".wayful", "maps");

export const mapDir = (path: Path.Path, root: string, name: string) =>
  path.join(mapsDir(path, root), name);

export const mapFile = (path: Path.Path, mapDirectory: string) =>
  path.join(mapDirectory, "map.toml");

export const stepsDir = (path: Path.Path, mapDirectory: string) => path.join(mapDirectory, "steps");

export const stepFile = (path: Path.Path, mapDirectory: string, id: number, name: string) =>
  path.join(stepsDir(path, mapDirectory), `${id}-${name}.md`);

export const artifactsDir = (path: Path.Path, mapDirectory: string) =>
  path.join(mapDirectory, "artifacts");

export const artifactFile = (
  path: Path.Path,
  mapDirectory: string,
  id: number,
  name: string,
  extension: "yaml" | "yml" = "yaml",
) => path.join(artifactsDir(path, mapDirectory), `${id}-${name}.${extension}`);

export const goalsDir = (path: Path.Path, mapDirectory: string) => path.join(mapDirectory, "goals");

export const goalFile = (path: Path.Path, mapDirectory: string, name: string) =>
  path.join(goalsDir(path, mapDirectory), `${name}.md`);
