import { readFile, rename, writeFile } from "node:fs/promises";

const VERSION = "0.1.0";
const IDENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type Dict = Record<string, any>;
class CliError extends Error {}
class MapMetadataError extends CliError {}
const fail = (message: string): never => {
  throw new CliError(message);
};
const nonEmpty = (value: any, label: string) =>
  typeof value === "string" && value.trim()
    ? value
    : fail(`${label} is required.`);
function identifier(value: any, label: string, step = false) {
  if (
    typeof value !== "string" ||
    !IDENT.test(value) ||
    (step && /^\d+$/.test(value))
  )
    fail(`${label} must be a lowercase kebab-case identifier.`);
  return value;
}
async function atomic(path: string, text: string) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}
function yaml(value: any) {
  const text = Bun.YAML.stringify(value, null, 2);
  return text.endsWith("\n") ? text : `${text}\n`;
}
function toml(value: Dict) {
  const text = Bun.TOML.stringify(value);
  if (text === undefined) fail("cannot serialize TOML metadata.");
  return text.endsWith("\n") ? text : `${text}\n`;
}
function parseYaml(text: string, where: string) {
  try {
    return Bun.YAML.parse(text);
  } catch {
    fail(`malformed YAML in ${where}.`);
  }
}
function parseToml(text: string, where: string) {
  try {
    return Bun.TOML.parse(text);
  } catch {
    fail(`malformed TOML in ${where}.`);
  }
}
async function frontmatter(
  path: string,
): Promise<{ data: Dict; body: string }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    fail(`cannot read ${path}.`);
  }
  if (!text.startsWith("---\n")) fail(`malformed frontmatter in ${path}.`);
  const end = text.indexOf("\n---", 4);
  if (end < 0) fail(`malformed frontmatter in ${path}.`);
  const data = parseYaml(text.slice(4, end), path);
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail(`malformed frontmatter in ${path}.`);
  return { data, body: text.slice(end + 4).replace(/^\n/, "") };
}
async function writeMd(path: string, data: Dict, body = "") {
  await atomic(path, `---\n${yaml(data)}---\n${body}`);
}
function slots(raw: any, label: string): any[] {
  if (!Array.isArray(raw)) fail(`${label} must be an array.`);
  const seen = new Set<string>();
  return raw.map((slot) => {
    if (!slot || typeof slot !== "object" || Array.isArray(slot))
      fail(`${label} contains an invalid slot.`);
    const name = identifier(slot.name, "slot name");
    const kind = nonEmpty(slot.kind, "slot kind");
    if (slot.description !== undefined)
      nonEmpty(slot.description, "slot description");
    if (seen.has(name)) fail(`${label} repeats slot '${name}'.`);
    seen.add(name);
    return slot.description === undefined
      ? { name, kind }
      : { name, kind, description: slot.description };
  });
}
function version(data: Dict, where: string, allowMissing = false) {
  if (data.format_version === undefined) {
    if (allowMissing) return;
    fail(`missing format version in ${where}.`);
  }
  if (!Number.isInteger(data.format_version))
    fail(`malformed format version in ${where}.`);
  if (data.format_version !== 1)
    fail(`unsupported format version in ${where}.`);
}
function projectMetadata(data: any) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    fail("malformed project metadata.");
  const allowed = new Set(["format_version", "description"]);
  if (
    Object.keys(data).some((key) => !allowed.has(key)) ||
    typeof data.description !== "string"
  )
    fail("malformed project metadata.");
  version(data, "project metadata", true);
}
function usage() {
  return `Wayful filesystem CLI

Usage: wayful [--project DIR] <command> [options]

Commands:
  init       Initialize a Wayful project
  map        Create, inspect, and validate maps
  step       Create and manage map steps
  artifact   Register map artifacts
  goal       Manage map goals
  type       Inspect project step types

Global options:
  --project DIR  Search for a project from DIR (optional)
  --help         Show help
  --version      Show the CLI version

Run \`wayful <command> --help\` for command usage.
`;
}
function groupUsage(group: string) {
  const commands: Record<string, string[]> = {
    map: [
      "create --map NAME --start TEXT --goal TEXT [--goal-body TEXT] [--project DIR]",
      "list [--project DIR] [--json]",
      "validate --map NAME [--project DIR] [--json]",
      "show --map NAME [--project DIR] [--json]",
      "next --map NAME [--project DIR] [--json]",
      "status --map NAME [--project DIR] [--json]",
    ],
    step: [
      "create NAME --type TYPE --description TEXT --map NAME [--project DIR] [--body TEXT] [--required-inputs JSON] [--required-outputs JSON]",
      "show STEP --map NAME [--project DIR] [--json]",
      "update STEP --map NAME [--project DIR] [--description TEXT] [--body TEXT]",
      "block STEP --reason TEXT --map NAME [--project DIR]",
      "unblock STEP --map NAME [--project DIR]",
      "complete STEP --summary TEXT --map NAME [--project DIR]",
      "cancel STEP --reason TEXT --map NAME [--project DIR]",
      "depends STEP --on STEP --map NAME [--project DIR]",
      "input STEP --artifact NAME --map NAME [--project DIR] [--slot NAME]",
      "output STEP --artifact NAME --map NAME [--project DIR] [--slot NAME]",
    ],
    artifact: ["add NAME --kind KIND --ref REF --map NAME [--project DIR]"],
    goal: [
      "list --map NAME [--project DIR] [--json]",
      "add --name NAME --description TEXT --map NAME [--project DIR] [--body TEXT]",
      "satisfy --goal NAME (--artifact NAME | --evidence NAME) [...] --map NAME [--project DIR]",
    ],
    type: [
      "list [--project DIR] [--json]",
      "show NAME [--project DIR] [--json]",
    ],
  };
  return `Usage: wayful ${group} <command> [options]

Commands:
${commands[group].map((command) => `  ${command}`).join("\n")}

Run \`wayful ${group} <command> --help\` for details.
`;
}
function commandUsage(group: string, command?: string) {
  const usages: Record<string, string> = {
    init: `Usage: wayful init [--project DIR] [--description TEXT]

Options:
  --project DIR         Initialize in DIR instead of the current directory
  --description TEXT    Optional project description
  --help                Show help
`,
    "map:create": `Usage: wayful map create --map NAME --start TEXT --goal TEXT [--goal-body TEXT] [--project DIR]

Required options:
  --map NAME            New map name
  --start TEXT          Starting point description
  --goal TEXT           Initial goal description

Options:
  --project DIR         Project directory
  --goal-body TEXT      Optional initial goal Markdown body
  --help                Show help
`,
    "map:list": `Usage: wayful map list [--project DIR] [--json]

Options:
  --project DIR         Project directory
  --json                Render stable JSON output
  --help                Show help
`,
    "map:validate": mapReadUsage("validate"),
    "map:show": mapReadUsage("show"),
    "map:next": mapReadUsage("next"),
    "map:status": mapReadUsage("status"),
    "type:list": `Usage: wayful type list [--project DIR] [--json]

Options:
  --project DIR         Project directory
  --json                Render stable JSON output
  --help                Show help
`,
    "type:show": `Usage: wayful type show NAME [--project DIR] [--json]

Required arguments:
  NAME                  Type name

Options:
  --project DIR         Project directory
  --json                Render stable JSON output
  --help                Show help
`,
    "artifact:add": `Usage: wayful artifact add NAME --kind KIND --ref REF --map NAME [--project DIR]

Required arguments:
  NAME                  Artifact name

Required options:
  --kind KIND           Artifact kind
  --ref REF             Opaque artifact reference
  --map NAME            Map name

Options:
  --project DIR         Project directory
  --help                Show help
`,
    "goal:list": goalReadUsage("list"),
    "goal:add": `Usage: wayful goal add --name NAME --description TEXT --map NAME [--project DIR] [--body TEXT]

Required options:
  --name NAME           Goal name
  --description TEXT    Goal description
  --map NAME            Map name

Options:
  --project DIR         Project directory
  --body TEXT           Optional goal Markdown body
  --help                Show help
`,
    "goal:satisfy": `Usage: wayful goal satisfy --goal NAME (--artifact NAME | --evidence NAME) [...] --map NAME [--project DIR]

Required options:
  --goal NAME           Goal name
  --artifact NAME       Evidence artifact (repeat for additional evidence)
  --evidence NAME       Alias for --artifact
  --map NAME            Map name

Options:
  --project DIR         Project directory
  --help                Show help
`,
  };
  const stepCommands: Record<string, string> = {
    create: "create NAME --type TYPE --description TEXT --map NAME [--project DIR] [--body TEXT] [--required-inputs JSON] [--required-outputs JSON]",
    show: "show STEP --map NAME [--project DIR] [--json]",
    update: "update STEP --map NAME [--project DIR] [--description TEXT] [--body TEXT]",
    block: "block STEP --reason TEXT --map NAME [--project DIR]",
    unblock: "unblock STEP --map NAME [--project DIR]",
    complete: "complete STEP --summary TEXT --map NAME [--project DIR]",
    cancel: "cancel STEP --reason TEXT --map NAME [--project DIR]",
    depends: "depends STEP --on STEP --map NAME [--project DIR]",
    input: "input STEP --artifact NAME --map NAME [--project DIR] [--slot NAME]",
    output: "output STEP --artifact NAME --map NAME [--project DIR] [--slot NAME]",
  };
  if (group === "step" && command) {
    const required: Record<string, string> = {
      create: "  NAME                  Step name\n  --type TYPE           Step type\n  --description TEXT    Result description\n  --map NAME            Map name",
      show: "  STEP                  Step name or numeric ID\n  --map NAME            Map name",
      update: "  STEP                  Step name or numeric ID\n  --map NAME            Map name",
      block: "  STEP                  Step name or numeric ID\n  --reason TEXT         Block reason\n  --map NAME            Map name",
      unblock: "  STEP                  Step name or numeric ID\n  --map NAME            Map name",
      complete: "  STEP                  Step name or numeric ID\n  --summary TEXT        Completion summary\n  --map NAME            Map name",
      cancel: "  STEP                  Step name or numeric ID\n  --reason TEXT         Cancellation reason\n  --map NAME            Map name",
      depends: "  STEP                  Step to update\n  --on STEP             Prerequisite step name or numeric ID\n  --map NAME            Map name",
      input: "  STEP                  Step name or numeric ID\n  --artifact NAME       Existing artifact name\n  --map NAME            Map name",
      output: "  STEP                  Step name or numeric ID\n  --artifact NAME       Existing artifact name\n  --map NAME            Map name",
    };
    const optional = command === "create"
      ? "  --project DIR         Project directory\n  --body TEXT           Optional Markdown body\n  --required-inputs JSON   Replace inherited required input slots\n  --required-outputs JSON  Replace inherited required output slots\n  --help                Show help"
      : `  --project DIR         Project directory${command === "show" ? "\n  --json                Render stable JSON output" : ""}${command === "update" ? "\n  --description TEXT    New step description\n  --body TEXT           Replace the Markdown body" : ""}${["input", "output"].includes(command) ? "\n  --slot NAME           Fulfill a required slot" : ""}\n  --help                Show help`;
    return `Usage: wayful step ${stepCommands[command]}

Required arguments and options:
${required[command]}

Options:
${optional}
`;
  }
  return usages[group === "init" ? "init" : `${group}:${command}`];
}
function mapReadUsage(command: string) {
  return `Usage: wayful map ${command} --map NAME [--project DIR] [--json]

Required options:
  --map NAME            Map name

Options:
  --project DIR         Project directory
  --json                Render stable JSON output
  --help                Show help
`;
}
function goalReadUsage(command: string) {
  return `Usage: wayful goal ${command} --map NAME [--project DIR] [--json]

Required options:
  --map NAME            Map name

Options:
  --project DIR         Project directory
  --json                Render stable JSON output
  --help                Show help
`;
}
function parse(argv: string[]) {
  const flags: Dict = {};
  const position: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith("--")) {
      const key = x.slice(2);
      if (key === "help" || key === "json" || key === "version")
        flags[key] = true;
      else {
        const value = argv[++i];
        if (value === undefined || value.startsWith("--"))
          fail(`--${key} requires a value.`);
        if (flags[key] !== undefined)
          flags[key] = Array.isArray(flags[key])
            ? [...flags[key], value]
            : [flags[key], value];
        else flags[key] = value;
      }
    } else position.push(x);
  }
  return { flags, position };
}
const commandOptions: Record<
  string,
  { options: string[]; positions: number; repeated?: string[] }
> = {
  init: { options: ["project", "description"], positions: 0 },
  "map:create": { options: ["project", "map", "start", "goal", "goal-body"], positions: 0 },
  "map:list": { options: ["project", "json"], positions: 0 },
  "map:validate": { options: ["project", "map", "json"], positions: 0 },
  "map:show": { options: ["project", "map", "json"], positions: 0 },
  "map:next": { options: ["project", "map", "json"], positions: 0 },
  "map:status": { options: ["project", "map", "json"], positions: 0 },
  "type:list": { options: ["project", "json"], positions: 0 },
  "type:show": { options: ["project", "json"], positions: 1 },
  "artifact:add": { options: ["project", "map", "kind", "ref"], positions: 1 },
  "goal:list": { options: ["project", "map", "json"], positions: 0 },
  "goal:add": {
    options: ["project", "map", "name", "description", "body"],
    positions: 0,
  },
  "goal:satisfy": {
    options: ["project", "map", "goal", "artifact", "evidence"],
    positions: 0,
    repeated: ["artifact", "evidence"],
  },
  "step:create": {
    options: [
      "project",
      "map",
      "type",
      "description",
      "body",
      "required-inputs",
      "required-outputs",
    ],
    positions: 1,
  },
  "step:show": { options: ["project", "map", "json"], positions: 1 },
  "step:update": { options: ["project", "map", "description", "body"], positions: 1 },
  "step:block": { options: ["project", "map", "reason"], positions: 1 },
  "step:unblock": { options: ["project", "map"], positions: 1 },
  "step:complete": { options: ["project", "map", "summary"], positions: 1 },
  "step:cancel": { options: ["project", "map", "reason"], positions: 1 },
  "step:depends": { options: ["project", "map", "on"], positions: 1 },
  "step:input": {
    options: ["project", "map", "artifact", "slot"],
    positions: 1,
  },
  "step:output": {
    options: ["project", "map", "artifact", "slot"],
    positions: 1,
  },
};
function validateInvocation(
  group: string,
  command: string | undefined,
  flags: Dict,
  position: string[],
) {
  const contract =
    commandOptions[group === "init" ? "init" : `${group}:${command}`];
  if (!contract)
    fail(
      `unknown ${group === "init" ? "command 'init'" : `${group} command '${command}'`}.`,
    );
  for (const [option, value] of Object.entries(flags)) {
    if (option === "help") continue;
    if (option === "version")
      fail("--version cannot be combined with a command.");
    if (!contract.options.includes(option))
      fail(`unknown or unsupported option '--${option}'.`);
    if (Array.isArray(value) && !contract.repeated?.includes(option))
      fail(`option '--${option}' may only be specified once.`);
  }
  const supplied = position.length - (group === "init" ? 1 : 2);
  if (!flags.help && supplied < contract.positions)
    fail(
      `${group === "init" ? "init" : `${group} ${command}`} requires ${contract.positions} positional argument${contract.positions === 1 ? "" : "s"}.`,
    );
  if (supplied > contract.positions)
    fail(`unexpected positional argument '${position[position.length - 1]}'.`);
}

export {
  CliError,
  commandUsage,
  Dict,
  IDENT,
  MapMetadataError,
  VERSION,
  atomic,
  fail,
  frontmatter,
  groupUsage,
  identifier,
  nonEmpty,
  parse,
  parseToml,
  parseYaml,
  projectMetadata,
  slots,
  toml,
  usage,
  validateInvocation,
  version,
  writeMd,
  yaml,
};
