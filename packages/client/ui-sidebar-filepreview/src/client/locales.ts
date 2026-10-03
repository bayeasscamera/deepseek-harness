/**
 * `sidebarFilepreview` namespace dictionaries.
 *
 * The failure lines are the point of this file: a preview that cannot show a
 * file has to say which of several different things went wrong, and each one
 * suggests a different next step for the reader.
 */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  loading: '正在载入…',
  reload: '重新载入文件',
  retry: '重试',
  slide: '第 {n} 张幻灯片',
  'table.truncated': '文件太大，只绘制了开头一部分。',
  'document.empty': '这个文档里没有可显示的文本。',
  'error.notFound': '这个文件不在了。可能已被移动或删除。',
  'error.outsideWorkspace': '这个文件在工作区之外，侧栏不会读取它。',
  'error.notRegularFile': '这不是一个普通文件，没有可预览的内容。',
  'error.tooLargeWindow': '这一页太大，侧栏不读取超过 {limit} 的页。',
  'error.tooLargePreview': '这个文件超过预览上限 {limit}，太大了，没法在这里打开。',
  'error.unsupported': '这种文件没有内置预览。',
  'error.unreadable': '读取中途停住了，文件可能正在被写入。',
  'error.malformed': '这个文件按扩展名读不出来，可能已经损坏。',
  'error.unavailable': '读取失败：{message}',
} satisfies Record<string, string>

/** File-preview dictionary key union. */
export type SidebarFilepreviewKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  loading: 'Loading…',
  reload: 'Load the file again',
  retry: 'Retry',
  slide: 'Slide {n}',
  'table.truncated': 'The file is larger than the preview draws; only its beginning is shown.',
  'document.empty': 'There is no readable text in this document.',
  'error.notFound': 'That file is gone. It may have been moved or deleted.',
  'error.outsideWorkspace': 'That file is outside the workspace, so the sidebar will not read it.',
  'error.notRegularFile': 'That is not a regular file, so there is nothing to preview.',
  'error.tooLargeWindow': 'That page is too large; the sidebar does not read pages above {limit}.',
  'error.tooLargePreview': 'That file is past the {limit} preview limit, so it cannot be opened here.',
  'error.unsupported': 'There is no built-in preview for that kind of file.',
  'error.unreadable': 'The read stopped part-way; the file may be being written.',
  'error.malformed': 'That file could not be read as its extension claims; it may be damaged.',
  'error.unavailable': 'Read failed: {message}',
} satisfies Record<SidebarFilepreviewKey, string>
