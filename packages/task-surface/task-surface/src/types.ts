/**
 * Pure types of the task-surface domain: the browser-safe model vocabulary
 * (sections, blocks, fields), the branded cross-boundary ids, the tool
 * presentation meta, the submission correlation, the pending-submission
 * acknowledgement, the projection value, and the host service contract —
 * free of this package's host-side imports (cordis, the projection unit).
 * Two namespace projections serve it — `./types` for host consumers,
 * `./client` (the browser half-entry's re-export) for client aggregates —
 * with zero content duplication. The transport augmentation that pairs the
 * correlation with an rpcId is owned by dsh-apiproxy, never here.
 *
 * @module @deepseek-ai/dsh-task-surface/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies one surface across its presentation and dismissal. */
export type TaskSurfaceId = Branded<'TaskSurfaceId'>

/** Identifies one submission attempt across its retry phases. */
export type TaskSurfaceSubmissionId = Branded<'TaskSurfaceSubmissionId'>

/** Identifies one dismissal attempt across its retries. */
export type TaskSurfaceDismissalId = Branded<'TaskSurfaceDismissalId'>

/** Stack layout: blocks render one below the other. */
export interface TaskSurfaceStackLayout {
  readonly kind: 'stack'
}

/** Grid layout with a fixed column count. */
export interface TaskSurfaceGridLayout {
  readonly kind: 'grid'
  readonly columns: 2 | 3
}

/** Section layout choice. */
export type TaskSurfaceLayout = TaskSurfaceStackLayout | TaskSurfaceGridLayout

/** Read-only prose block. */
export interface TaskSurfaceMarkdownBlock {
  readonly kind: 'markdown'
  readonly text: string
}

/** One labelled metric inside a metrics block. */
export interface TaskSurfaceMetric {
  readonly label: string
  readonly value: string
  readonly detail?: string
}

/** Read-only labelled-value strip. */
export interface TaskSurfaceMetricsBlock {
  readonly kind: 'metrics'
  readonly items: TaskSurfaceMetric[]
}

/** One table column declaration. */
export interface TaskSurfaceTableColumn {
  readonly id: string
  readonly label: string
}

/** One table row keyed by column id. */
export type TaskSurfaceTableRow = Record<string, string | number | boolean | null>

/** Read-only tabular data. */
export interface TaskSurfaceTableBlock {
  readonly kind: 'table'
  readonly columns: TaskSurfaceTableColumn[]
  readonly rows: TaskSurfaceTableRow[]
}

/** Read-only before/after comparison. */
export interface TaskSurfaceDiffBlock {
  readonly kind: 'diff'
  readonly path?: string
  readonly before: string | null
  readonly after: string
  readonly language?: string
}

/** Notice emphasis level. */
export type TaskSurfaceNoticeTone = 'neutral' | 'info' | 'warning'

/** Read-only highlighted message. */
export interface TaskSurfaceNoticeBlock {
  readonly kind: 'notice'
  readonly tone: TaskSurfaceNoticeTone
  readonly text: string
}

/** One block inside a surface section. */
export type TaskSurfaceBlock =
  | TaskSurfaceMarkdownBlock
  | TaskSurfaceMetricsBlock
  | TaskSurfaceTableBlock
  | TaskSurfaceDiffBlock
  | TaskSurfaceNoticeBlock

/** One labelled option inside a choice-like field. */
export interface TaskSurfaceOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

/** Single-line or multi-line text input. */
export interface TaskSurfaceTextField {
  readonly kind: 'text'
  readonly id: string
  readonly label: string
  readonly multiline?: boolean
  readonly required?: boolean
  readonly initial?: string
}

/** Single-selection field. */
export interface TaskSurfaceChoiceField {
  readonly kind: 'choice'
  readonly id: string
  readonly label: string
  readonly options: TaskSurfaceOption[]
  readonly initial?: string
}

/** Multi-selection field. */
export interface TaskSurfaceMultiChoiceField {
  readonly kind: 'multi-choice'
  readonly id: string
  readonly label: string
  readonly options: TaskSurfaceOption[]
  readonly initial?: string[]
}

/** Boolean field. */
export interface TaskSurfaceToggleField {
  readonly kind: 'toggle'
  readonly id: string
  readonly label: string
  readonly initial?: boolean
}

/** Ranking field over the declared options. */
export interface TaskSurfaceOrderField {
  readonly kind: 'order'
  readonly id: string
  readonly label: string
  readonly options: TaskSurfaceOption[]
  readonly initial?: string[]
}

/** One input field of the surface. */
export type TaskSurfaceField =
  | TaskSurfaceTextField
  | TaskSurfaceChoiceField
  | TaskSurfaceMultiChoiceField
  | TaskSurfaceToggleField
  | TaskSurfaceOrderField

/** One titled group of blocks. */
export interface TaskSurfaceSection {
  readonly id: string
  readonly title?: string
  readonly layout?: TaskSurfaceLayout
  readonly blocks: TaskSurfaceBlock[]
}

/** The submit affordance. */
export interface TaskSurfaceSubmit {
  readonly label: string
}

/**
 * The complete durable surface model carried by the tool-result presentation
 * meta. Section ids and field ids are each unique within one model.
 */
export interface TaskSurfaceModelV1 {
  readonly version: 1
  readonly title: string
  readonly description?: string
  readonly sections: TaskSurfaceSection[]
  readonly fields?: TaskSurfaceField[]
  readonly submit: TaskSurfaceSubmit
}

/**
 * Tool presentation meta persisted in the `tool/result` event's `meta` field.
 * The full model rides here; the session projection carries only the active
 * identity, so renderers read the model from the event, never the projection.
 */
export interface TaskSurfacePresentationMeta {
  readonly kind: 'dsh/task-surface'
  readonly version: 1
  readonly surfaceId: TaskSurfaceId
  readonly model: TaskSurfaceModelV1
}

/**
 * Correlation attached to the submitted user message. It carries no transport
 * id: the rpcId-carrying message source is the dsh-apiproxy augmentation of
 * this record, registered through `MessageSourceMap` by that package.
 */
export interface TaskSurfaceCorrelation {
  readonly version: 1
  readonly submissionId: TaskSurfaceSubmissionId
  readonly callId: ToolCallId
  readonly surfaceId: TaskSurfaceId
  readonly values: Record<string, JsonValue>
}

/** Durable acknowledgement phase of one accepted submission. */
export type TaskSurfaceSubmissionPhase = 'queued' | 'claiming'

/** One submission accepted but not yet claimed by the agent loop. */
export interface TaskSurfacePendingSubmission {
  readonly submissionId: TaskSurfaceSubmissionId
  readonly messageId: MessageId
  readonly phase: TaskSurfaceSubmissionPhase
}

/**
 * The `taskSurface` projection value: the identity of the at-most-one open
 * surface, or `null` while none is open. The full model stays on the
 * `tool/result` meta; this carries only what close/reopen bookkeeping needs.
 */
export interface TaskSurfaceProjection {
  readonly active: {
    readonly callId: ToolCallId
    readonly surfaceId: TaskSurfaceId
  } | null
}

/** Result of reading the session's currently open surface. */
export type GetActiveTaskSurfaceResult =
  | {
    readonly active: true
    readonly callId: ToolCallId
    readonly surfaceId: TaskSurfaceId
    readonly model: TaskSurfaceModelV1
    readonly pending: TaskSurfacePendingSubmission | null
  }
  | { readonly active: false; readonly reason: 'not-open' }

/** Request to submit one surface's field values. */
export interface SubmitTaskSurfaceRequest {
  readonly sessionId: SessionId
  readonly surfaceId: TaskSurfaceId
  readonly submissionId: TaskSurfaceSubmissionId
  readonly values: Record<string, JsonValue>
  readonly note?: string
}

/** Outcome of one submission attempt. */
export type SubmitTaskSurfaceResult =
  | { readonly accepted: true; readonly messageId: MessageId; readonly phase: 'queued' }
  | {
    readonly accepted: false
    readonly reason: 'not-open' | 'stale' | 'invalid-submission' | 'submission-pending'
  }

/** Request to dismiss one open surface without submitting. */
export interface DismissTaskSurfaceRequest {
  readonly sessionId: SessionId
  readonly surfaceId: TaskSurfaceId
  readonly dismissalId: TaskSurfaceDismissalId
}

/** Outcome of one dismissal attempt. */
export type DismissTaskSurfaceResult =
  | { readonly dismissed: true; readonly eventSeq: number }
  | { readonly dismissed: false; readonly reason: 'not-open' | 'stale' | 'submission-pending' }

/**
 * Host-side service contract. The implementation lives in the Stage 2 host
 * package; the browser reaches it through the transport, never directly.
 */
export interface TaskSurfaceService {
  /**
   * Read the session's currently open surface.
   * @param input - session and surface to match against the open identity.
   * @returns the open surface with its pending submission, or `not-open`.
   */
  getActive(input: { sessionId: SessionId; surfaceId: TaskSurfaceId }): Promise<GetActiveTaskSurfaceResult>
  /**
   * Submit one surface's field values as a correlated user message.
   * @param input - session, surface, retry-stable submission id, and values.
   * @returns the accepted message id, or the rejection reason.
   */
  submit(input: SubmitTaskSurfaceRequest): Promise<SubmitTaskSurfaceResult>
  /**
   * Dismiss one open surface without submitting.
   * @param input - session, surface, and retry-stable dismissal id.
   * @returns the committed event seq, or the rejection reason.
   */
  dismiss(input: DismissTaskSurfaceRequest): Promise<DismissTaskSurfaceResult>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /**
     * The session's open surface identity, or `null` while none is open.
     * Whole-value rule: every change carries the complete post-change
     * identity, so the fold is last-wins.
     */
    taskSurface: TaskSurfaceProjection | null
  }

  interface SessionProjectionMap {
    /**
     * The session's open surface identity, or `null` while none is open.
     * Whole-value rule: every change carries the complete post-change
     * identity, so the fold is last-wins.
     */
    taskSurface: TaskSurfaceProjection | null
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Surface dismissed without a submission. Retried dismissals reuse the
     * same dismissalId and return the original result without appending
     * another event.
     */
    'task-surface/dismissed': {
      readonly surfaceId: TaskSurfaceId
      readonly dismissalId: TaskSurfaceDismissalId
    }
  }
}
