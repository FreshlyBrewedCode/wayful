import { describe, expect, test } from "bun:test";

import { decodeIssueBody, encodeIssueBody } from "../../../src/backend/github/issue";

describe("issue body anatomy", () => {
  test("round-trips prose and structured residue", () => {
    const data = { format_version: 4, name: "redesign", allowed_step_types: ["task"] };
    const body = encodeIssueBody("Human prose.", data);
    expect(body).toContain("<details>");
    expect(body).toContain("```yaml");
    expect(body.indexOf("<details>")).toBeGreaterThan(body.indexOf("Human prose."));
    expect(decodeIssueBody(body)).toEqual({ body: "Human prose.", data });
  });

  test("round-trips a record with no prose", () => {
    const data = { format_version: 4, name: "redesign" };
    expect(decodeIssueBody(encodeIssueBody("", data))).toEqual({ body: "", data });
  });

  test("writes a collapsed details block", () => {
    expect(encodeIssueBody("", {})).toContain("<details>\n");
  });

  test("fails when the details block is missing", () => {
    expect(() => decodeIssueBody("just prose")).toThrow(/details block/);
  });

  test("fails when the details block carries no YAML fence", () => {
    expect(() => decodeIssueBody("<details>\n<summary>x</summary>\n\nnothing\n</details>")).toThrow(
      /YAML/,
    );
  });

  test("fails when the YAML is malformed", () => {
    expect(() =>
      decodeIssueBody('<details>\n<summary>x</summary>\n\n```yaml\nkey: "oops\n```\n</details>'),
    ).toThrow(/malformed YAML/);
  });
});
