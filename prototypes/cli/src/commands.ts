import {
  MapMetadataError,
  VERSION,
  commandUsage,
  fail,
  groupUsage,
  parse,
  usage,
  validateInvocation,
} from "./core";
import { assertWritableMapIntegrity, mapContext } from "./model";
import { handleArtifact } from "./commands/artifact";
import { handleGoal } from "./commands/goal";
import { handleInit } from "./commands/init";
import { handleMap, handleMapCreate, handleMapList } from "./commands/map";
import { handleStep } from "./commands/step";
import { handleType } from "./commands/type";

const commandGroups = ["map", "step", "artifact", "goal", "type"];
const mapMutations = new Set([
  "add",
  "create",
  "update",
  "block",
  "unblock",
  "complete",
  "cancel",
  "depends",
  "input",
  "output",
  "satisfy",
]);

export async function run() {
  const { flags, position } = parse(process.argv.slice(2));

  if (flags.version) {
    if (position.length || Object.keys(flags).length !== 1)
      fail("--version cannot be combined with commands or options.");
    console.log(VERSION);
    return;
  }

  const group = position[0];
  if (group === undefined) {
    if (flags.help && Object.keys(flags).length === 1) {
      console.log(usage());
      return;
    }
    if (Object.keys(flags).length) fail("a command is required.");
    console.log(usage());
    return;
  }

  if (group === "init") {
    validateInvocation(group, undefined, flags, position);
    if (flags.help) {
      console.log(commandUsage(group));
      return;
    }
    await handleInit(flags);
    return;
  }

  if (!commandGroups.includes(group)) fail(`unknown command '${group}'.`);
  if (position[1] === undefined) {
    for (const option of Object.keys(flags))
      if (!["help", "project", "map"].includes(option))
        fail(`unknown or unsupported option '--${option}'.`);
    console.log(groupUsage(group));
    return;
  }

  const command = position[1];
  validateInvocation(group, command, flags, position);
  if (flags.help) {
    console.log(commandUsage(group, command));
    return;
  }

  if (group === "type") return handleType(command, flags, position);
  if (group === "map" && command === "create") return handleMapCreate(flags);
  if (group === "map" && command === "list") return handleMapList(flags);

  let m: any;
  try {
    m = await mapContext(flags);
  } catch (error) {
    if (
      group === "map" &&
      command === "validate" &&
      error instanceof MapMetadataError
    ) {
      if (flags.json)
        console.log(
          JSON.stringify({ valid: false, errors: [error.message] }, null, 2),
        );
      else console.error(`wayful: invalid map: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (mapMutations.has(command) && group !== "map")
    await assertWritableMapIntegrity(m);

  if (group === "map") return handleMap(command, flags, m);
  if (group === "artifact") return handleArtifact(command, flags, position, m);
  if (group === "goal") return handleGoal(command, flags, m);
  return handleStep(command, flags, position, m);
}
