// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SkillsTab, type SkillEntry, type SkillsTabProps } from '../src/client/SkillsTab.tsx'

afterEach(cleanup)

/** One installed skill as the host projects it onto the tab. */
const skill: SkillEntry = {
  name: 'imported-skill',
  description: 'An imported skill.',
  source: 'user-dsh',
  path: '/home/u/.dsh/skills/imported-skill',
}

/** The tab with every injected face replaced by a spy the test drives. */
function harness(overrides: Partial<Record<keyof SkillsTabProps, unknown>> = {}): SkillsTabProps {
  return {
    listSkills: vi.fn().mockResolvedValue([skill]),
    refreshSkills: vi.fn().mockResolvedValue([skill]),
    openDirectory: vi.fn().mockResolvedValue({ opened: true }),
    importSkills: vi.fn().mockResolvedValue({
      outcomes: [{ kind: 'imported', name: 'imported-skill', path: '/p' }],
    }),
    t: ((key: string) => key) as SkillsTabProps['t'],
    ...overrides,
  } as unknown as SkillsTabProps
}

/** Flush the promise chain a click started. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('SkillsTab', () => {
  it('lists the discovered skills on mount', async () => {
    const props = harness()
    render(<SkillsTab {...props} />)
    await settle()

    expect(props.listSkills).toHaveBeenCalledOnce()
    // The name appears in its own column and as the folder name in the path column.
    expect(screen.getAllByText('imported-skill')).toHaveLength(2)
    expect(screen.getByText('An imported skill.')).toBeDefined()
    expect(screen.getByText('user-dsh')).toBeDefined()
  })

  it('reports an empty deployment and a failed catalog with a retry', async () => {
    const empty = harness({ listSkills: vi.fn().mockResolvedValue([]) })
    const { unmount } = render(<SkillsTab {...empty} />)
    await settle()
    expect(screen.getByText('skillsEmpty')).toBeDefined()
    unmount()

    const listSkills = vi
      .fn()
      .mockRejectedValueOnce(new Error('registry exploded'))
      .mockResolvedValue([skill])
    const failed = harness({ listSkills })
    render(<SkillsTab {...failed} />)
    await settle()
    expect(screen.getByText(/^skillsLoadFailed/)).toBeDefined()

    fireEvent.click(screen.getByText('skillsRetry'))
    await settle()
    expect(listSkills).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText('imported-skill')).toHaveLength(2)
  })

  it('rescans the roots through the host instead of the cached listing', async () => {
    const props = harness()
    render(<SkillsTab {...props} />)
    await settle()

    fireEvent.click(screen.getByText('skillsRefresh'))
    await settle()

    expect(props.refreshSkills).toHaveBeenCalledOnce()
    expect(props.listSkills).toHaveBeenCalledOnce()
  })

  it('reports an installed skill and rescans for it', async () => {
    const props = harness()
    render(<SkillsTab {...props} />)
    await settle()

    fireEvent.click(screen.getByText('skillsImport'))
    await settle()

    expect(screen.getByText('skillsImported imported-skill')).toBeDefined()
    // The import installed a folder the cached listing has not seen.
    expect(props.refreshSkills).toHaveBeenCalledOnce()
  })

  it('reports each host refusal and a dismissed picker', async () => {
    for (const [reason, message] of [
      ['missing-skill-file', 'skillsImportMissing'],
      ['invalid-frontmatter', 'skillsImportInvalid'],
      ['exists', 'skillsImportExists'],
    ] as const) {
      const props = harness({
        importSkills: vi.fn().mockResolvedValue({ outcomes: [{ kind: 'rejected', reason }] }),
      })
      const { unmount } = render(<SkillsTab {...props} />)
      await settle()
      fireEvent.click(screen.getByText('skillsImport'))
      await settle()
      expect(screen.getByText(message)).toBeDefined()
      unmount()
    }

    const cancelled = harness({ importSkills: vi.fn().mockResolvedValue(undefined) })
    const view = render(<SkillsTab {...cancelled} />)
    await settle()
    fireEvent.click(screen.getByText('skillsImport'))
    await settle()
    expect(screen.getByText('skillsImport')).toBeDefined()
    // A dismissed picker leaves no message behind.
    expect(screen.queryByText('skillsImported imported-skill')).toBeNull()
    view.unmount()
  })

  it('names every skill an import installed and why the rest were refused', async () => {
    const props = harness({
      importSkills: vi.fn().mockResolvedValue({
        outcomes: [
          { kind: 'imported', name: 'brand-voice', path: '/a' },
          { kind: 'imported', name: 'benchmark', path: '/b' },
          { kind: 'rejected', reason: 'exists' },
        ],
      }),
    })
    render(<SkillsTab {...props} />)
    await settle()

    fireEvent.click(screen.getByText('skillsImport'))
    await settle()

    // A grouped folder installs several skills at once, and the one that
    // could not be installed is reported next to the ones that could.
    expect(screen.getByText('skillsImported brand-voice, benchmark')).toBeDefined()
    expect(screen.getByText('skillsImportExists')).toBeDefined()
  })

  it('reports a failed import', async () => {
    const props = harness({ importSkills: vi.fn().mockRejectedValue(new Error('copy failed')) })
    render(<SkillsTab {...props} />)
    await settle()

    fireEvent.click(screen.getByText('skillsImport'))
    await settle()

    expect(screen.getByText('skillsImportFailed')).toBeDefined()
  })

  it('confirms the native opener and falls back to the path when it declines', async () => {
    const opened = harness()
    const first = render(<SkillsTab {...opened} />)
    await settle()
    fireEvent.click(screen.getByText('skillsOpenDirectory'))
    await settle()
    expect(screen.getByText('skillsOpened')).toBeDefined()
    first.unmount()

    const declined = harness({
      openDirectory: vi.fn().mockResolvedValue({ opened: false, path: '/home/u/.dsh/skills' }),
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const second = render(<SkillsTab {...declined} />)
    await settle()
    fireEvent.click(screen.getByText('skillsOpenDirectory'))
    await settle()
    expect(screen.getByText('/home/u/.dsh/skills')).toBeDefined()

    fireEvent.click(screen.getAllByText('skillsCopyPath')[0]!)
    await settle()
    expect(writeText).toHaveBeenCalledWith('/home/u/.dsh/skills')
    vi.unstubAllGlobals()
    second.unmount()
  })

  it('reports a failed native opener', async () => {
    const props = harness({ openDirectory: vi.fn().mockRejectedValue(new Error('no opener')) })
    render(<SkillsTab {...props} />)
    await settle()

    fireEvent.click(screen.getByText('skillsOpenDirectory'))
    await settle()

    expect(screen.getByText('skillsOpenFailed')).toBeDefined()
  })

  it('copies a row path, marks it copied, and leaves no marker when refused', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const props = harness()
    const { unmount } = render(<SkillsTab {...props} />)
    await settle()

    fireEvent.click(screen.getByText('skillsCopyPath'))
    await settle()

    expect(writeText).toHaveBeenCalledWith('/home/u/.dsh/skills/imported-skill')
    expect(screen.getByText('\u2713')).toBeDefined()
    unmount()

    const refused = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText: refused } })
    render(<SkillsTab {...harness()} />)
    await settle()
    fireEvent.click(screen.getByText('skillsCopyPath'))
    await settle()
    expect(refused).toHaveBeenCalledOnce()
    expect(screen.getByText('skillsCopyPath')).toBeDefined()
    vi.unstubAllGlobals()
  })

  it('names no cause when the host rejects a catalog without a message', async () => {
    const props = harness({ listSkills: vi.fn().mockRejectedValue('') })
    render(<SkillsTab {...props} />)
    await settle()

    expect(screen.getByText(/^skillsLoadFailed$/)).toBeDefined()
  })

  it('clears the copy, refusal, and opener-failure markers on their own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      const props = harness({
        importSkills: vi
          .fn()
          .mockResolvedValue({ outcomes: [{ kind: 'rejected', reason: 'exists' }] }),
        openDirectory: vi.fn().mockRejectedValue(new Error('no opener')),
      })
      render(<SkillsTab {...props} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      fireEvent.click(screen.getByText('skillsCopyPath'))
      fireEvent.click(screen.getByText('skillsImport'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('\u2713')).toBeDefined()
      expect(screen.getByText('skillsImportExists')).toBeDefined()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(screen.queryByText('\u2713')).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
      expect(screen.queryByText('skillsImportExists')).toBeNull()

      fireEvent.click(screen.getByText('skillsOpenDirectory'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('skillsOpenFailed')).toBeDefined()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(screen.queryByText('skillsOpenFailed')).toBeNull()
      vi.unstubAllGlobals()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores catalog and import failures that land after the tab unmounts', async () => {
    let rejectList: ((reason: unknown) => void) | undefined
    const listSkills = vi.fn().mockReturnValue(
      new Promise<readonly SkillEntry[]>((_, reject) => {
        rejectList = reject
      }),
    )
    const first = render(<SkillsTab {...harness({ listSkills })} />)
    first.unmount()
    await act(async () => {
      rejectList?.(new Error('late failure'))
    })

    let rejectImport: ((reason: unknown) => void) | undefined
    const importSkills = vi.fn().mockReturnValue(
      new Promise((_, reject) => {
        rejectImport = reject
      }),
    )
    const second = render(<SkillsTab {...harness({ importSkills })} />)
    await settle()
    fireEvent.click(screen.getByText('skillsImport'))
    second.unmount()
    await act(async () => {
      rejectImport?.(new Error('late refusal'))
    })

    expect(screen.queryAllByText('skillsImportFailed')).toHaveLength(0)
    expect(screen.queryAllByText(/^skillsLoadFailed/)).toHaveLength(0)
  })

  it('clears its transient feedback on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const props = harness()
      render(<SkillsTab {...props} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      fireEvent.click(screen.getByText('skillsImport'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('skillsImported imported-skill')).toBeDefined()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
      expect(screen.queryByText('skillsImported imported-skill')).toBeNull()

      fireEvent.click(screen.getByText('skillsOpenDirectory'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('skillsOpened')).toBeDefined()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(screen.queryByText('skillsOpened')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a refusal and an opener that declines without naming a path', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const refused = harness({ importSkills: vi.fn().mockRejectedValue('the host refused') })
      const first = render(<SkillsTab {...refused} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(screen.getByText('skillsImport'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('skillsImportFailed')).toBeDefined()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000)
      })
      expect(screen.queryByText('skillsImportFailed')).toBeNull()
      first.unmount()

      const declined = harness({ openDirectory: vi.fn().mockResolvedValue({ opened: false }) })
      render(<SkillsTab {...declined} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(screen.getByText('skillsOpenDirectory'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      // One copy control in the fallback line, one in the skill row.
      expect(screen.getAllByText('skillsCopyPath')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('abandons an import still in flight when the tab unmounts', async () => {
    let settleImport:
      | ((report: { outcomes: { kind: 'imported'; name: string; path: string }[] }) => void)
      | undefined
    const props = harness({
      importSkills: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          settleImport = resolve
        }),
      ),
    })
    const { unmount } = render(<SkillsTab {...props} />)
    await settle()
    fireEvent.click(screen.getByText('skillsImport'))
    unmount()

    await act(async () => {
      settleImport?.({ outcomes: [{ kind: 'imported', name: 'late-skill', path: '/p' }] })
    })
    expect(screen.queryAllByText(/late-skill/)).toHaveLength(0)
  })

  it('abandons an in-flight catalog read when the tab unmounts', async () => {
    let resolveList: ((value: readonly SkillEntry[]) => void) | undefined
    const props = harness({
      listSkills: vi.fn().mockReturnValue(
        new Promise<readonly SkillEntry[]>((resolve) => {
          resolveList = resolve
        }),
      ),
    })
    const { unmount } = render(<SkillsTab {...props} />)
    unmount()

    await act(async () => {
      resolveList?.([skill])
    })
    // The abandoned read must not resurrect the tab it belonged to.
    expect(screen.queryAllByText('imported-skill')).toHaveLength(0)
  })
})
