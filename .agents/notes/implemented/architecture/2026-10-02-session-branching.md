# Agent Note: Branch a conversation from a message

Status: implemented

English | [中文](2026-10-02-session-branching.zh.md)

## Problem

The product wants a **Branch** action: from any message, start a parallel session that carries the files, the instructions, and the history up to that message, while the source session stays strictly untouched.

Reading the repository before designing anything showed that most of the primitive already exists: `ctx.sessions.fork` copies a session's event prefix into a new session, the RPC exposes it as `session.fork`, and a completed turn's last message already reaches it. The work was the product semantics on top — branching from user messages with a draft handoff, a lineage line, a branch count, and file isolation — not a copying engine, a new schema, or a migration.

### Where sessions and messages live

- A session is an **append-only event log**, not a row-per-message table. `@deepseek-ai/dsh-session-persistence` (`packages/session/session-persistence/README.md:12`) exposes `ctx.sessionPersistence` with `create`/`open`/`stat`/`list`; `create`/`open` return a `SessionHandle` that owns every read, append, flush and the single-writer claim.
- The shipped backend is **one `.jsonl.zstd` artifact per session** (`packages/session/session-persistence-jsonl`), framed by `@deepseek-ai/dsh-session-format` (`packages/session/session-format/README.md:12`), with released adjacent migrations v0→v1→v2 (`session-format-v0-to-v1`, `-v1-to-v2`) composed by `session-format-catalog`.
- Non-replayable metadata travels separately as **`SessionHeader`** (`packages/core/session/src/types.ts:91`): `version`, `id`, `createdAt`, `cwd`, `parentSession`, `isSeeded`, `origin`, `delegationDepth`, `agentPreset`; the child's inherited prefix length is stored beside it as `inheritedEventCount`. There is no parallel stored message type.
- Events carry a per-session monotonic **`seq`**; the vocabulary is the generated `KNOWN_SESSION_EVENT_TYPES` (`packages/core/session/src/known-event-types.ts:22`): `user/message`, `assistant/message`, `assistant/attempt`, `tool/call`, `tool/result`, `turn/start`, `turn/end`, `step/start`, `step/end`, `session/title`, `compaction/*`, `request/header`, `request/context`, `model/selection`, `agent-preset/selected`, `permission/preset`, `plan/mode`, `sandbox/mode`, `goal/change`, `todo/write`, plus `session/end-seed` for the seed boundary.
- A tool call and its result are **separate events linked by a call id** (`tool/call` / `tool/result`), and the read path repairs dangling pairs on resume: an assistant request without a durable call becomes `TOOL_NOT_STARTED`, a durable call without a result becomes `TOOL_OUTCOME_UNKNOWN` (`packages/session/session-persistence/README.md:132`).

### What a branch carries

- Instructions, model, preset, permissions and workspace are composed by plugins over the session; the durable ones are logged as events (`agent-preset/selected`, `model/selection`, `permission/preset`, `plan/mode`, `sandbox/mode`, `request/context`, `request/header`), so they travel **inside the event prefix**.
- Compaction state is event-sourced too (`compaction/start`, `compaction/summary`, `compaction/end`, `compaction/prune`), so a prefix that includes a compaction carries its summary naturally.
- The engine needs no App-supplied history per turn: the loop persists every published event and **resumes** by reading the stored log and appending synthetic closers for an interrupted turn (`packages/session/session-persistence/README.md:61`).

### What the branch reuses

| Piece | Where | State |
|---|---|---|
| Fork with a boundary | `packages/core/session/src/index.ts:1170` — `fork(source, boundary?, childSessionId?)` seeds a child from the source's events, sets `parentSession`, `isSeeded: true`, `cwd`, and `inheritedEventCount` | Reused as-is |
| Boundary safety | `_forkSeed` rejects a boundary that does not exist and requires the slice **not to end inside an open turn** | Reused as-is |
| Host RPC | `packages/api/session-controller/src/commands.ts:194` — `fork(request)`; errors `session/fork-unavailable` when there is no completed turn to fork from | Reused, with branch options |
| Client RPC | `packages/api/session-controller/src/client/contract/sessions.ts:103` — `fork({ sessionId, atSeq?, increaseTitle?, isolateFiles? })` | Reused, with branch options |
| Workspace attach | `commands.ts:527` — `forkWorkspace` reuses the source's workspace (or the subagent ancestor's) | Reused; the child's `cwd` comes from the isolation step |
| Title numbering | `increasedForkTitle` (`client/sessions/service.ts:161`) — `<title> (1)`, then `(2)`, `(3)`…; full-width `（n）` for a Chinese title | Reused |

## Decision

`ctx.sessions.fork` stays the single creation path; branching is that fork plus five shipped behaviours.

**Cutoff planning.** `planBranchCutoff` (`packages/api/session-controller/src/branch-cutoff.ts`) reads the anchor as the user's intent: a `user/message` anchor stays OUT of the child and comes back as `draftText`; any other anchor copies through the end of its turn; an anchor that would land inside an unfinished turn moves back to the last completed turn, so a copied `tool/call` never loses its result. A session with no completed turn refuses with `session/fork-unavailable`.

**Action.** Every user message and every finalized turn tail offers Branch (`packages/client/ui-chat/src/client/chat/MessageItem.tsx`); the tail keeps `message.branchUnavailable` while a later steering message, tool call, or interrupted step belongs to the same indexed turn.

**Draft handoff.** The child's composer receives the anchor's text before the child opens, so a message kept out of the copied history becomes the second path's first editable turn (`packages/client/ui-chat/src/client/apply.ts`). An anchor that is not a user message returns no draft and the composer stays empty.

**Lineage.** A child renders "Branched from `<source title>`" above its transcript, reading the source through the session list row so a renamed source keeps its current title (`packages/client/ui-chat/src/client/chat/ChatView.tsx`). The source's row in the workspace list carries a localized branch count: `indexBranchDescendants` counts direct children that record a parent without the subagent origin, and a branch of a branch counts under its own parent (`packages/client/ui-workspace/src/client/subagent-lineage.ts`).

**File isolation.** `fork({ isolateFiles: true })` gives the child its own working tree instead of sharing the source's: a Git worktree on a branch named for the child when the source directory sits inside one, otherwise a copy that skips dependencies, history, and build residue. Isolation fails closed before any child exists, and a copy created before a later failure is removed (`packages/api/session-controller/src/branch-workspace.ts`). The message actions state the choice: the branch control opens a two-entry menu naming the file policy — the shared directory or the isolated copy — so isolation is an explicit pick rather than a hidden flag (`packages/client/ui-chat/src/client/chat/MessageIconActions.tsx`). A branch the host refuses, isolation included, reports on the source session's composer instead of leaving the click silent (`packages/client/ui-chat/src/client/apply.ts`).

**No new schema and no migration.** The branch point is the child's inherited prefix length; `parentSession` + `isSeeded` already carry lineage in the header and on the client wire (`packages/api/session-controller/src/types.ts:411`); attachments travel as durable references admitted through `ctx.attachments`, so a copied prefix copies no bytes and deleting a branch cannot delete the source's files.

## Deferred

- **A per-message branch marker on the source message.** The cut is not on the client wire — the header carries `parentSession`/`isSeeded`, not the fork point — so the marker would need either a new per-session branch-point projection, which the session list's no-per-session-stat policy rejects, or a lazy read of every child's header. The source row's branch count already answers how many branches a conversation produced.
- **Parent grouping in the session list.** Branches list as their own rows with the branch-count badge; nesting is not built.

## Testing

- Host: `packages/api/session-controller/tests/session-fork.host.spec.ts` pins the cutoff rules and the draft answer; `tests/branch-workspace.spec.ts` proves the worktree/copy isolation, the fail-closed path, and that the source directory is never moved or modified.
- Client: `packages/client/ui-chat/tests/apply-inject.client.spec.tsx` proves the draft seeding (and the empty composer for a non-user anchor), `tests/chat-view.client.spec.tsx` proves the fork target and the lineage line, `tests/chat-branch-tails.client.spec.tsx` proves the action's availability rules, and the same two suites prove the file-policy menu reaches `fork({ isolateFiles: true })` and that a refusal reports on the composer; `packages/client/ui-workspace/tests/subagent-lineage.client.spec.ts` and `tests/rows.client.spec.tsx` prove the branch count.

## Alternatives considered

**Share a prefix by reference instead of copying events.** The child would depend on the source's live log, so editing, regenerating, pruning or repairing the source would change the branch afterwards, and its single-writer claim would have to be shared. The requested guarantee is that the source stays intact and the branch is an independent snapshot.

**Duplicate the JSONL artifact and trim it.** Cheaper to write, but it bypasses the format catalog's validation and header translation, leaves the seed metadata wrong, and would reimplement the tail-trimming rules `_forkSeed` already enforces.

**Reuse the source's session id and branch on the engine side.** Two writers would share one log while the persistence seam admits exactly one writer per session, so the second writer is refused by design.

**Add a new branching service next to `fork`.** A second creation path would duplicate the boundary validation, the lineage header fields, and the workspace attach that `fork` and `forkWorkspace` already own.

**Add `branched_from_message_id` and `branch_created_at`.** This stack has no message ids and no relational session table: the branch point already exists as the child's inherited prefix length, and `parentSession` + `isSeeded` already carry the lineage. A second copy of the same fact would need every writer to keep it in sync.

## Consequences

- The source session is never written to. The child is a normal session with its own id, its own log, and a copied prefix, so the byte-identical-source guarantee holds by construction rather than by a rollback path.
- A branch never contains an orphan `tool/call` or `tool/result`, because the cutoff planner refuses or trims into the last completed turn.
- Attachments cost nothing to carry and cannot be destroyed through the branch.
- The trade-offs: isolation is opt-in, so the default branch edits the same files as its source; the branch point is not addressable from the client, which is what keeps the per-message marker deferred; and the child's title derivation reuses the existing `(n)` suffix rather than a branch-specific wording.
