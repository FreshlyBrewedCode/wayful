import { CliOutput } from "effect/unstable/cli";

/**
 * effect/unstable/cli's `showHelp` (fired for every `ShowHelp` — a usage
 * mistake as much as a deliberate bare invocation) and the built-in
 * `--help`/`-h` action flag both call `formatHelpDoc` and write its return
 * value straight to stdout, unconditionally — there is no config knob to
 * suppress it. Stashing the rendered text here instead lets `main.ts` decide
 * where it goes: printed back out for a deliberate request, dropped for a
 * mistake so ~25 lines of help text don't bury the one actionable
 * diagnostic line. Cost: `showHelp`/`Help.run` still call `Console.log("")`
 * with the now-empty return value, so every affected invocation gets one
 * stray leading blank line on stdout.
 */
const base = CliOutput.defaultFormatter();
let stashed = "";

export const helpCapturingFormatter: CliOutput.Formatter = {
  ...base,
  formatHelpDoc: (doc) => {
    stashed = base.formatHelpDoc(doc);
    return "";
  },
};

export function takeHelpText(): string {
  const text = stashed;
  stashed = "";
  return text;
}
