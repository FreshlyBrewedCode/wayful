import { fail } from "../core";
import { allTypes, project, render, typeDef } from "../model";

export async function handleType(
  command: string,
  flags: Record<string, any>,
  position: string[],
) {
  const p = await project(flags);
  if (command === "list") {
    const ts = await allTypes(p.root);
    render(ts, flags, ts.map((t) => `${t.name}: ${t.description}`).join("\n"));
    return;
  }
  if (command === "show") {
    const t = await typeDef(
      p.root,
      position[2] ?? fail("type name is required."),
    );
    render(
      t,
      flags,
      `${t.name}: ${t.description}\nInstructions:\n${t.instructions || "(empty)"}`,
    );
    return;
  }
  fail(`unknown type command '${command}'.`);
}
