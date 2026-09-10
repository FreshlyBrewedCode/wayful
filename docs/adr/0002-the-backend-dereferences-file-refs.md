---
status: accepted
---

# The backend dereferences `file:` refs

Wayful previously never dereferenced a ref at all, but both the viewer (to preview a markdown
artifact) and agents driving the CLI (to read one without a second tool) need the content behind a
`file:` ref. Dereferencing is therefore added to `WayfulBackend` as a read operation — not to
`server/` and not to a CLI command — so the HTTP endpoint and the CLI read command are two callers
of one implementation rather than two implementations that will drift.

The backend is also the right seam because a future non-filesystem backend may hold artifacts that
are not files on a disk at all. Resolving refs behind the service interface keeps that possible;
resolving them in `server/` would hard-code the filesystem into the only caller that matters.

## The invariant

**Only a ref attached on a map is readable.**

ADR-0004 dissolved the artifact record this ADR originally named — *only through its record* — but
the substance is unchanged. The readable set is still closed and still derived from project data,
and adding a file to it still takes one deliberate act: it was `artifact add`, it is now attaching
the ref to a step or a goal. The set is enumerated from the map's attachments rather than from a
stored collection, which if anything tightens it — an orphaned registration was previously readable
and now cannot exist.

Two teeth are worth stating because both are one convenient feature away from being lost:

- **No request ever names a path.** The content endpoint addresses an artifact by a *content
  address* — a SHA-256 over the ref in the canonical form ADR-0004 normalizes to — and the backend
  resolves it by digesting the map's attached refs and matching. The membership check is the real
  control, but the digest is why losing it would not be exploitable: a digest cannot be turned back
  into a path, so no refactor can accidentally promote a caller-supplied string into a filesystem
  read. This is the same discipline `server/http.ts` already applies to client assets, where a
  request path is only ever a map key.
- **Links inside a document are never followed.** Resolving a relative link in a previewed markdown
  file would read a file that is not attached anywhere, which breaks the invariant outright.
  Relative links render inert.

## Containment

The untrusted input here is the project data, not the request: `.wayful` may be cloned from a
repository or written by an agent, so `file:../../../.ssh/id_rsa` is the attack that matters.
Defence is layered, cheapest first:

1. **Syntax** (pure, in `domain/`): only `file:` refs are candidates; `..` segments, absolute
   paths, NUL and control characters are rejected. ADR-0001 already rejects these on write, but
   read re-checks rather than trusting what is on disk.
2. **Extension allowlist**: only `.md` and `.markdown` are read. This carries more security weight
   than its size suggests — it excludes `.env`, `.git/config` and private keys by construction.
3. **Real containment** (in `backend/filesystem/`): resolve against `realpath` of the project root,
   `realpath` the target, and re-assert containment, so a `docs/` symlinked out of the project
   fails closed. A legitimately symlinked directory therefore will not preview; that is the
   intended trade, relaxable later behind an explicit flag.
4. **Shape and size**: `stat` must report a regular file — a directory, FIFO or device such as
   `/dev/zero` is refused — and reads are capped (~1 MiB) with an explicit `truncated` flag rather
   than streamed.
5. **Response shaping**: content is returned as JSON with `cache-control: no-store` and
   `X-Content-Type-Options: nosniff`, never as raw bytes under a sniffable content type on the
   viewer's own origin.

## Consequences

- Containment is tested by the existing `backend/filesystem/` contract suite against real temporary
  directories, which is a far better home for symlink-escape tests than an HTTP-level test.
- The content address depends on ADR-0004's normalization: both sides must digest the same
  canonical form, so normalization is a prerequisite rather than a detail.
- The API's absence of CORS headers becomes load-bearing: a cross-origin page must not be able to
  read these responses. Validating that the `Host` header is loopback, to defeat DNS rebinding, is
  worth more now that the server can return file contents rather than only map state.
- `map validate` still does not check that a `file:` ref exists. "Attached but not yet written"
  stays a display state, because existence checking is the slope this ADR's boundary exists to
  stop.
- Only markdown is dereferenced today. The content response carries a `format` field so images or
  structured data can be added later without reshaping the endpoint — but they need a byte-serving
  surface with pinned content types, which is a separate decision.
