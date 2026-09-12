import type { HttpClientRequest } from "effect/unstable/http";

/** The fixed timestamp every GitHub fixture reports; decode validates its shape. */
export const ISSUE_TIME = "2024-01-01T00:00:00.000Z";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A REST issue object as GitHub returns it: labels are objects, body nullable. */
export function issueJson(
  number: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: number + 1000,
    number,
    title: `issue ${number}`,
    body: "body",
    state: "open",
    state_reason: null,
    labels: [{ name: "wayful:map" }],
    created_at: ISSUE_TIME,
    updated_at: ISSUE_TIME,
    closed_at: null,
    ...overrides,
  };
}

/** Reads a stubbed request's JSON body back out of its `HttpBody` variant. */
export function bodyText(request: HttpClientRequest.HttpClientRequest): string {
  const body = request.body;
  if (body && body["_tag"] === "Uint8Array") return new TextDecoder().decode(body.body);
  return "";
}
