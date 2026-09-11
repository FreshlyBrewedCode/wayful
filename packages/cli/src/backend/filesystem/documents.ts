import { Effect, type FileSystem } from "effect";

import { WayfulError } from "../../domain/errors";

export { liftSync, nowISO } from "../effect";

export function stringifyYaml(value: unknown): string {
  const text = Bun.YAML.stringify(value, null, 2);
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function stringifyToml(value: Record<string, unknown>): string {
  const text = Bun.TOML.stringify(value);
  if (text === undefined) throw new WayfulError({ message: "cannot serialize TOML metadata." });
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function parseYaml(text: string, where: string): unknown {
  try {
    return Bun.YAML.parse(text);
  } catch {
    throw new WayfulError({ message: `malformed YAML in ${where}.` });
  }
}

export function parseToml(text: string, where: string): unknown {
  try {
    return Bun.TOML.parse(text);
  } catch {
    throw new WayfulError({ message: `malformed TOML in ${where}.` });
  }
}

export function parseFrontmatter(
  text: string,
  where: string,
): { data: Record<string, unknown>; body: string } {
  if (!text.startsWith("---\n"))
    throw new WayfulError({ message: `malformed frontmatter in ${where}.` });
  const end = text.indexOf("\n---", 4);
  if (end < 0) throw new WayfulError({ message: `malformed frontmatter in ${where}.` });
  const data = parseYaml(text.slice(4, end), where);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new WayfulError({ message: `malformed frontmatter in ${where}.` });
  return { data: data as Record<string, unknown>, body: text.slice(end + 4).replace(/^\n/, "") };
}

export function buildMarkdown(data: Record<string, unknown>, body = ""): string {
  return `---\n${stringifyYaml(data)}---\n${body}`;
}

export function readTextFile(
  fs: FileSystem.FileSystem,
  path: string,
  onError: string,
): Effect.Effect<string, WayfulError> {
  return fs.readFileString(path).pipe(Effect.mapError(() => new WayfulError({ message: onError })));
}

export function writeAtomic(
  fs: FileSystem.FileSystem,
  path: string,
  text: string,
): Effect.Effect<void, WayfulError> {
  return Effect.gen(function* () {
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onError = new WayfulError({ message: `cannot write ${path}.` });
    yield* fs.writeFileString(tmp, text).pipe(Effect.mapError(() => onError));
    yield* fs.rename(tmp, path).pipe(Effect.mapError(() => onError));
  });
}
