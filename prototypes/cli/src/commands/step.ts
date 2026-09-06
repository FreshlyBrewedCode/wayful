import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  atomic,
  fail,
  identifier,
  nonEmpty,
  slots,
  toml,
  writeMd,
} from "../core";
import {
  allSteps,
  artifacts,
  attachmentOK,
  render,
  saveStep,
  step,
  typeDef,
} from "../model";

export async function handleStep(
  command: string,
  flags: Record<string, any>,
  position: string[],
  m: any,
) {
  if (command === "create") {
    const name = identifier(
      position[2] ?? fail("step name is required."),
      "step name",
      true,
    );
    const type = identifier(flags.type, "step type");
    const description = nonEmpty(flags.description, "step description");
    const steps = await allSteps(m);
    if (steps.some((candidate) => candidate.name === name))
      fail(`step '${name}' already exists.`);

    const highestStepID = steps.reduce(
      (highest, candidate) => Math.max(highest, candidate.id),
      0,
    );
    const id = m.data.step_id_counter;
    if (id <= highestStepID)
      fail("map step_id_counter must be greater than every existing step ID.");

    const typeDefinition = await typeDef(m.root, type);
    if (m.data.allowed_step_types && !m.data.allowed_step_types.includes(type))
      fail(`type '${type}' is not allowed by this map.`);

    const override = (flag: string, inherited: any[]) =>
      flags[flag] === undefined
        ? inherited
        : slots(JSON.parse(flags[flag]), `--${flag}`);
    let requiredInputs: any[];
    let requiredOutputs: any[];
    try {
      requiredInputs = override(
        "required-inputs",
        typeDefinition.required_inputs,
      );
      requiredOutputs = override(
        "required-outputs",
        typeDefinition.required_outputs,
      );
    } catch (error) {
      if (error instanceof SyntaxError)
        fail("required slot override must be JSON.");
      throw error;
    }

    if (
      steps.some((candidate) => candidate.id === id) ||
      existsSync(join(m.dir, "steps", `${id}-${name}.md`))
    )
      fail("map step_id_counter would overwrite an existing step.");
    await writeMd(
      join(m.dir, "steps", `${id}-${name}.md`),
      {
        format_version: 1,
        id,
        name,
        type,
        description,
        status: "pending",
        dependencies: [],
        inputs: [],
        outputs: [],
        required_inputs: requiredInputs,
        required_outputs: requiredOutputs,
      },
      flags.body ?? "",
    );
    m.data.step_id_counter = id + 1;
    await atomic(join(m.dir, "map.toml"), toml(m.data));
    console.log(`Created step ${id} '${name}'.`);
    return;
  }

  const target = await step(
    m,
    position[2] ?? fail("step reference is required."),
  );
  if (command === "show") {
    let instructions: any;
    try {
      instructions = (await typeDef(m.root, target.type)).instructions;
    } catch {
      instructions = "unavailable: referenced type is missing or malformed.";
    }
    const { path, body, ...state } = target;
    const human = [
      `${target.id} ${target.name}`,
      target.description,
      "Body:",
      body || "(empty)",
      "Type instructions:",
      instructions || "(empty)",
    ].join("\n");
    render(
      { ...state, body, instructions },
      flags,
      human,
    );
    return;
  }

  if (["update", "block", "unblock", "complete", "cancel"].includes(command)) {
    if (["complete", "cancelled"].includes(target.status))
      fail("terminal steps cannot be changed.");
    if (command === "update") {
      if (target.status !== "pending")
        fail("only pending steps can be updated.");
      if (flags.description === undefined && flags.body === undefined)
        fail("step update requires --description or --body.");
      if (flags.description !== undefined)
        target.description = nonEmpty(flags.description, "step description");
      if (flags.body !== undefined) target.body = flags.body;
    }
    if (command === "block") {
      if (target.status !== "pending")
        fail("only pending steps can be blocked.");
      target.status = "blocked";
      target.block_reason = nonEmpty(flags.reason, "block reason");
    }
    if (command === "unblock") {
      if (target.status !== "blocked")
        fail("only blocked steps can be unblocked.");
      target.status = "pending";
      delete target.block_reason;
    }
    if (command === "cancel") {
      target.status = "cancelled";
      target.cancellation_reason = nonEmpty(
        flags.reason,
        "cancellation reason",
      );
    }
    if (command === "complete") {
      const summary = nonEmpty(flags.summary, "completion summary");
      if (!attachmentOK(target, "outputs", await artifacts(m)))
        fail("required output slots are not fulfilled.");
      target.status = "complete";
      target.completion_summary = summary;
    }
    await saveStep(target);
    console.log(`Updated step '${target.name}'.`);
    return;
  }

  if (command === "depends") {
    if (["complete", "cancelled"].includes(target.status))
      fail("terminal steps cannot be changed.");
    const prerequisite = await step(m, flags.on ?? fail("--on is required."));
    if (target.id === prerequisite.id) fail("a step cannot depend on itself.");
    if (target.dependencies.includes(prerequisite.id))
      fail("duplicate dependency.");
    if (prerequisite.status === "cancelled")
      fail("cannot depend on a cancelled step.");
    const steps = await allSteps(m);
    const reaches = (
      node: any,
      id: number,
      seen = new Set<number>(),
    ): boolean =>
      node.id === id ||
      (!seen.has(node.id) &&
        (seen.add(node.id),
        node.dependencies.some((dependencyID: number) => {
          const dependency = steps.find(
            (candidate) => candidate.id === dependencyID,
          );
          return dependency && reaches(dependency, id, seen);
        })));
    if (reaches(prerequisite, target.id))
      fail("dependency would create a cycle.");
    target.dependencies.push(prerequisite.id);
    await saveStep(target);
    console.log(`Added dependency to '${target.name}'.`);
    return;
  }

  if (command === "input" || command === "output") {
    if (["complete", "cancelled"].includes(target.status))
      fail("terminal steps cannot be changed.");
    const name = identifier(flags.artifact, "artifact name");
    const artifact = (await artifacts(m)).find(
      (candidate) => candidate.name === name,
    );
    if (!artifact) fail(`artifact '${name}' does not exist.`);
    const direction = command === "input" ? "inputs" : "outputs";
    const slotName = flags.slot;
    if (slotName !== undefined) {
      identifier(slotName, "slot name");
      const required =
        target[
          direction === "inputs" ? "required_inputs" : "required_outputs"
        ] ?? [];
      const slot = required.find(
        (candidate: any) => candidate.name === slotName,
      );
      if (!slot) fail(`slot '${slotName}' is not a required ${command} slot.`);
      if (slot.kind !== artifact.kind)
        fail(`artifact kind does not match slot '${slotName}'.`);
      if (
        target[direction].some(
          (attachment: any) => attachment.slot === slotName,
        )
      )
        fail(`slot '${slotName}' is already fulfilled.`);
      target[direction].push({ artifact: name, slot: slotName });
    } else target[direction].push({ artifact: name });
    await saveStep(target);
    console.log(`Attached artifact '${name}'.`);
    return;
  }

  fail(`unknown step command '${command}'.`);
}
