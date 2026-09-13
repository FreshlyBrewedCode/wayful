# The GitHub backend

A wayful project normally keeps its maps on disk. The GitHub backend keeps the
maps, steps, and goals in a repository's Issues instead, so they are visible,
commentable, and linkable where the rest of the project already is. Project
configuration and step-type files still live on disk in `.wayful/`; only the map
data moves.

Read this beside `cli-guide.md`, which covers the commands themselves.

## Initialise a GitHub-backed project

Run `init` once, from the repository to use:

```sh
wayful init --backend github
```

The repository and host come from the `origin` remote, or pass
`--repo owner/name` for the repository. `init` verifies the credential can
write, creates the `wayful:*` labels, and records the backend and repository in
`.wayful/project.toml`. If a `.wayful/` project already exists it refuses to
overwrite it.

## Credentials

A token for the project's host is resolved in this order, first match wins:

1. `WAYFUL_GITHUB_TOKEN`
2. `GH_TOKEN`
3. `GITHUB_TOKEN`
4. `gh auth token --hostname <host>`, when the `gh` CLI is signed in

An environment variable always beats the `gh` CLI, so one command can use a
different token without disturbing the rest. The token needs write access: a
token that can read but not write is reported as an access problem, not a
missing credential. When nothing resolves, the error says to run
`gh auth login` or set `GH_TOKEN`.

## Recognising a wayful record

A wayful record is a GitHub issue carrying one of its labels. Project-wide
commands only read labelled issues, so a repository can keep using Issues for
human work without wayful seeing it.

| Record | Label | What it looks like |
| --- | --- | --- |
| Map | `wayful:map` | Its title is the map's *start* text; its name lives in the body block. |
| Step | `wayful:step` | Also wears `wayful:type/<name>` for its type and `wayful:blocked` while blocked; its title is its description. |
| Goal | `wayful:goal` | Its title is its description; like a step, its name is in the body block. |

A map's steps and goals are **sub-issues** of the map's issue. That is what
makes them parts of that map rather than unrelated issues.

## Ids are allocated by the backend

A step's id under this backend is its **repository-wide issue number**. It is
not a small counter and does not start at `1`. GitHub assigns it when the issue
is created, and the CLI prints it:

```
$ wayful step create research-users --map redesign --type research --description "..."
Created step 74 'research-users'.
```

Read the id from that output — or from `wayful map next`, `wayful step show`, or
`wayful context` — and use it afterwards. Never guess it: a made-up number
addresses a different issue, or an unrelated one that shares the repository's
numbering.

```sh
wayful step show 74 --map redesign
wayful step depends 75 --map redesign --on 74
```

## Steps and goals share one sub-issue budget

GitHub allows at most **100 sub-issues per parent issue**, and a map's steps
and goals are all sub-issues of its map issue. Steps and goals therefore share a
single budget of 100 per map, not 100 each. `step create` and `goal add` fail
with an explicit message once the map is full. A map that large is usually a
sign it should be split.

## Keep the label set in sync

`init` creates the primitive labels. The per-type labels follow the step-type
files, which are hand-maintained and can gain a member at any time, so after
adding, renaming, or removing a type, reconcile the repository:

```sh
wayful label sync
```

It creates whatever is missing and leaves existing labels alone; safe to run
whenever.

## Leave the structured data block alone

Wayful writes each issue as human prose followed by a collapsed block:

````md
Release criteria and stakeholder context.

<details>
<summary>Wayful data</summary>

```yaml
format_version: 4
name: redesign
```

</details>
````

The prose above the block is yours — comment, edit it, change labels. The block
holds the fields GitHub has no native home for. Edit it by hand and the record
becomes unreadable: commands report that issue by number rather than guess. So
leave the block intact.

## What to expect for latency

The filesystem backend is local and effectively instant. This backend talks to
the GitHub API, so every command takes at least a network round trip and can be
noticeably slower:

- A **single-map read** (metadata, steps, goals, attachments) is a handful of
  requests at most; unchanged data is revalidated rather than re-downloaded.
- A **project-wide read** such as `map list` or project-scope `context` touches
  the repository's map issues and grows with the number of maps.
- A **write** makes one or more requests, because a single change may update an
  issue, its labels, and its parent.

Avoid tight polling. GitHub rate-limits requests, and wayful stops before
exhausting the budget with a message saying when it resets — if you see it,
wait rather than retry.

## Recent activity is issue activity

`context` reports a map's recent activity from each issue's last-updated
timestamp. Here that timestamp moves on **any** activity on the issue — a
comment, a label change, a close — not only when wayful writes. A human
commenting on a step makes it look recently active. Read the window as "what
happened on these issues lately", not as a log of wayful commands.

## Sharing a repository with human work

- Wayful reads and writes only issues carrying its labels; project reads ignore
  everything else.
- Step ids are ordinary repository issue numbers, shared with human issues, so
  `#74` may be a wayful step or a human bug — check the labels.
- A map's steps and goals are its sub-issues. Don't attach unrelated issues to
  a wayful map, and don't put wayful labels on human issues.
- These are real issues, so normal GitHub workflows apply: comment on a step,
  close it with a pull request (`Closes #74`), or move it between projects.
  wayful treats GitHub's own state as authoritative.
