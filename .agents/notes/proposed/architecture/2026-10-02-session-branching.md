# Agent Note: Branch a conversation from a message

Status: proposed

English | [中文](2026-10-02-session-branching.zh.md)

## Problem

The product wants a **Branch** action: from any message, start a parallel session that carries the files, the instructions, and the history up to that message, while the source session stays strictly untouched. Before designing anything, the repository had to be read to learn what already exists.

**Discovery result: most of the primitive exists.** A fork already copies a session's event prefix into a new session, is exposed over RPC as `session.fork`, and is already reachable from the chat UI on a completed turn's last message. What is missing is product semantics on top of it, not a copying engine.

### Where sessions and messages live

- A session is an **append-only event log**, not a row-per-message table. `@deepseek-ai/dsh-session-persistence` (`packages/session/session-persistence/README.md:12`) exposes `ctx.sessionPersistence` with `create`/`open`/`stat`/`list`; `create`/`open` return a `SessionHandle` that owns every read, append, flush and the single-writer claim.
- The shipped backend is **one `.jsonl.zstd` artifact per session** (`packages/session/session-persistence-jsonl`), framed by `@deepseek-ai/dsh-session-format` (`packages/session/session-format/README.md:12`), with released adjacent migrations v0→v1→v2 (`packages/session/session-format-v0-to-v1`, `-v1-to-v2`) composed by `session-format-catalog`.
- Non-replayable metadata travels separately as **`SessionHeader`** (`packages/core/session/src/types.ts:91`): `version`, `id`, `createdAt`, `cwd`, `parentSession`, `isSeeded`, `origin`, `delegationDepth`, `agentPreset`. There is no parallel stored message type.
- Events carry a per-session monotonic **`seq`**; the vocabulary is the generated `KNOWN_SESSION_EVENT_TYPES` (`packages/core/session/src/known-event-types.ts:22`): `user/message`, `assistant/message`, `assistant/attempt`, `tool/call`, `tool/result`, `turn/start`, `turn/end`, `step/start`, `step/end`, `session/title`, `compaction/*`, `request/header`, `request/context`, `model/selection`, `agent-preset/selected`, `permission/preset`, `plan/mode`, `sandbox/mode`, `goal/change`, `todo/write`, plus `session/end-seed` for the seed boundary.
- A tool call and its result are **separate events linked by a call id** (`tool/call` / `tool/result`), and the read path already repairs dangling pairs on resume: an assistant request without a durable call becomes `TOOL_NOT_STARTED`, a durable call without a result becomes `TOOL_OUTCOME_UNKNOWN` (`packages/session/session-persistence/README.md:132`).

### What constitutes a session's context

- Instructions, model, preset, permissions and workspace are composed by plugins over the session; the durable ones are logged as events (`agent-preset/selected`, `model/selection`, `permission/preset`, `plan/mode`, `sandbox/mode`, `request/context`, `request/header`), so they travel **inside the event prefix**.
- `cwd` is header metadata; the client wire header carries the lineage fields `parentSession`, `isSeeded`, `origin`, `delegationDepth` (`packages/api/session-controller/src/types.ts:392`).
- Compaction state is event-sourced too (`compaction/start`, `compaction/summary`, `compaction/end`, `compaction/prune`), so a prefix that includes a compaction carries its summary naturally.
- The engine does not need App-supplied history per turn: the loop persists every published event and **resumes** by reading the stored log and appending synthetic closers for an interrupted turn (`packages/session/session-persistence/README.md:61`).

### What already exists to reuse

| Piece | Where | State |
|---|---|---|
| Fork with a boundary | `packages/core/session/src/index.ts:1170` — `fork(source, boundary?, childSessionId?)` seeds a child from the source's events, sets `parentSession`, `isSeeded: true`, `cwd`, and `inheritedEventCount` | Reusable as-is |
| Boundary safety | `_forkSeed` rejects a boundary that does not exist and requires the slice **not to end inside an open turn** | Reusable as-is (this is the §3.3 guarantee) |
| Host RPC | `packages/api/session-controller/src/commands.ts:194` — `fork(request)`; errors `session/fork-unavailable` when there is no completed turn to fork from | Reusable, needs new options |
| Client RPC | `packages/api/session-controller/src/client/contract/sessions.ts:97` — `fork({ sessionId, atSeq?, increaseTitle? }): Promise<SessionId>` | Reusable, needs new options |
| Chat action | `packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx:48` — `onBranch={() => forkAt(closing.finalNode.seq)}`, disabled via `branchUnavailable` when the turn is not the last completed one; rendered by `MessageIconActions.tsx:91` with label `message.branch` | Exists on **turn tails only** |
| Session-list fork | `packages/client/ui-workspace/src/client/index.ts:113` — `forkSession` → `sessions.fork({ sessionId, increaseTitle: true })` | Exists |
| Title numbering | `increaseTitle` on the client contract (child title derivation) | Exists |
| Workspace attach | `commands.ts:527` — `forkWorkspace` reuses the source's workspace (or the subagent ancestor's) | Reusable; **no isolation option** |
| Fork tests | `packages/core/session/tests/fork.spec.ts`, `ui-chat/tests/chat-view.client.spec.tsx:1290,2435` (`forkAt` called with the expected seq) | Exist |

### The gap against the requested product

| Requirement | State |
|---|---|
| Action available on **every message** | Partial: only on a completed turn's last assistant message; user messages render `MessageIconActions` but only with copy |
| Title `<titre> (branche)` / `(branche N)` | Exists as `increaseTitle`; exact wording must be checked |
| Draft text when branching from a **user** message | Missing: `SessionForkRequest` is `{ sessionId, atSeq? }` and `SessionForkValue` is `{ sessionId }` — no text is returned or staged |
| Visible **"Branch of `<parent>`"** link in the child | Missing |
| **"N branches"** marker on the source message | Missing (countable from `parentSession`, but the branch point is not on the wire) |
| Sidebar indent/icon under the parent | Partial: the workspace browser lists forks; no parent grouping |
| **Isolation option** (`git worktree` or copy) | Missing: the child reuses the source's workspace |
| Deleting a parent detaches children | Not applicable: persistence exposes **no deletion API** (`session-persistence/README.md:152`); pruning is out-of-band |
| Atomic creation / no orphan | The core `fork` creates the child in one step after validating the boundary; the RPC wraps workspace attach and cleans up a child whose attach fails (`commands.ts:281`) |

### Design adaptation to this stack

- **Identity is the event `seq`, not a message id.** Messages have no durable id in this design; the branch point is a seq, exactly what `atSeq` already takes. The requested `branched_from_message_id` therefore becomes the source seq at which the child's prefix ends, which the child already records as its inherited prefix length.
- **No new schema and no migration for the copy itself.** The child is a normal session whose events are the copied prefix; `parentSession` + `isSeeded` already describe the lineage. Any additional product field earns its place only where a fact is not derivable (for example an explicit isolation marker), and adding it means a `SessionHeader`/wire change plus the adjacent-migration rules.
- **Attachments are references, not copies.** Prompt attachments travel as durable references admitted through `ctx.attachments` (`packages/api/session-controller/src/commands.ts:557`), with content addressed by the attachment store under `packages/attachment/`, so a copied prefix carries the same references and copies no bytes. Deleting a branch therefore cannot delete the source's files.
- **The engine needs no fork id.** The child gets a new session id and its own log; the source's id is never reused.

## Proposal

Add the missing product semantics on top of the existing fork, in phases:

1. **Server**: extend the fork contract with a branch intent — `atSeq` for the cutoff (already there), an optional `isolateFiles` flag, and a returned `draftText` when the cutoff is a user message. Keep `fork` as the primitive; add nothing that duplicates it.
2. **Client action**: expose Branch on every message that addresses durable events (user messages included), keeping the existing `branchUnavailable` gate for messages that cannot fork.
3. **Draft handoff**: when the cutoff message is the user's, put its text in the composer as an editable draft so the user can rephrase and explore a second path.
4. **Lineage UX**: a "Branch of `<parent title>`" link at the top of a child, a "N branches" marker on the source message, and parent grouping in the session list.
5. **Isolation**: an explicit opt-in that creates an independent working copy; fail closed (no branch) when it cannot be created.

## Acceptance criteria

- Branching from any forkable message creates a child, opens it, and leaves the source session byte-identical (messages, order, title, header).
- A branch never contains an orphan `tool/call` or `tool/result`; a cutoff inside an open turn is repaired or refused, never copied verbatim.
- Creation is atomic: no partial session, and no orphan file or workspace, survives a failure.
- A child shows its parent link; the source shows how many branches were cut from it.
- Branching from a user message fills the composer with that text; branching from an assistant message leaves the composer empty.
- Every new user-visible string exists in every shipped locale.

## Alternatives considered

**Share a prefix by reference instead of copying events.** The child would depend on the source's live log, so editing, regenerating, pruning or repairing the source would change the branch afterwards, and its single-writer claim would have to be shared. The requested guarantee is that the source stays intact and the branch is an independent snapshot.

**Duplicate the JSONL artifact and trim it.** Cheaper to write, but it bypasses the format catalog's validation and header translation, leaves the seed metadata wrong, and would reimplement the tail-trimming rules `_forkSeed` already enforces.

**Reuse the source's session id and branch on the engine side.** Two writers would share one log while the persistence seam admits exactly one writer per session, so the second writer is refused by design.

**Add a new branching service next to `fork`.** A second creation path would duplicate the boundary validation, the lineage header fields, and the workspace attach that `fork` and `forkWorkspace` already own.

**Add `branched_from_message_id` and `branch_created_at`.** This stack has no message ids and no relational session table: the branch point already exists as the child's inherited prefix length, and `parentSession` + `isSeeded` already carry the lineage. A second copy of the same fact would need every writer to keep it in sync.

## Risks

- **Uncommitted work overlaps the locale files.** `packages/client/locale-fr/src/client/dicts-chat.ts` and several `ui-chat` files are modified in the working tree; any new string must be added without sweeping those edits into a phase commit.
- **`increaseTitle` wording** may not match the requested `(branche)` / `(branche N)` exactly; the client owns child-title derivation and must be read before changing it.
- **Isolation is the only genuinely new machinery** (worktree or directory copy) and the only place where a failure can leave residue; it must fail closed and be proven by a test.
- **A cutoff inside an open turn** currently makes the fork unavailable ("completed turn" rule) rather than trimming to the last safe boundary; the requested behaviour would extend or refuse the cutoff, which changes an existing refusal into a repair. That decision changes user-visible behaviour and should be confirmed.
