import { WayfulError } from "@domain/errors";

/**
 * GitHub's per-parent sub-issue limit. Steps and goals are both sub-issues of
 * the map issue, so they share this one budget — a map can hold at most this
 * many of them together, not this many of each.
 */
export const SUB_ISSUE_CAP = 100;

/** The named error a map produces when steps and goals have filled its budget. */
export const subIssueCapError = (): WayfulError =>
  new WayfulError({
    message: `a map can have at most ${SUB_ISSUE_CAP} sub-issues; steps and goals share this cap.`,
  });
