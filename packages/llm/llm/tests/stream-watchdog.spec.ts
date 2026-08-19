import { describe, expect, it } from 'vitest'
import { watchdogStream } from '@deepseek-ai/dsh-llm'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'

const CODE = 'TEST_IDLE'

/** Manual iterator with an observable `return` call count and optional teardown hook. */
function manualIterator(items: readonly number[], onReturn?: () => Promise<void> | void) {
  let index = 0
  let returnCalls = 0
  const iterator: AsyncIterator<number> & { returnCalls: () => number } = {
    async next() {
      const value = items[index]
      if (value !== undefined) {
        index += 1
        return { value, done: false }
      }
      return { value: undefined as never, done: true }
    },
    async return() {
      returnCalls += 1
      if (onReturn !== undefined) await onReturn()
      return { value: undefined as never, done: true }
    },
    returnCalls: () => returnCalls,
  }
  return iterator
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const seen: T[] = []
  for await (const value of stream) seen.push(value)
  return seen
}

describe('watchdogStream', () => {
  it('yields every value and skips iterator teardown on exhaustion', async () => {
    using watchdog = idleWatchdog(undefined, 60_000, CODE)
    const iterator = manualIterator([1, 2, 3])

    expect(await drain(watchdogStream({ watchdog, watchdogCode: CODE, iterator }))).toEqual([1, 2, 3])
    expect(iterator.returnCalls()).toBe(0)
  })

  it('propagates an iterator failure and tears the iterator down', async () => {
    using watchdog = idleWatchdog(undefined, 60_000, CODE)
    async function* failing(): AsyncGenerator<number> {
      yield 1
      throw new Error('transport dropped')
    }
    const iterator = failing()[Symbol.asyncIterator]()
    const returnSpy = iterator.return.bind(iterator)
    let returnCalls = 0
    iterator.return = async (value?: unknown) => {
      returnCalls += 1
      return returnSpy(value)
    }

    const stream = watchdogStream({ watchdog, watchdogCode: CODE, iterator })
    const first = await stream.next()
    expect(first.value).toBe(1)
    await expect(stream.next()).rejects.toThrow('transport dropped')
    expect(returnCalls).toBe(1)
  })

  it('propagates the watchdog timeout when an outstanding demand stalls', async () => {
    using watchdog = idleWatchdog(undefined, 20, CODE)
    // A transport that observes the fused signal: it settles only when the
    // watchdog aborts it, then fails like a real aborted read would.
    const stalled: AsyncIterator<number> = {
      async next() {
        await new Promise<void>((resolve) => {
          if (watchdog.signal.aborted) {
            resolve()
            return
          }
          watchdog.signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        throw new Error('read aborted')
      },
    }

    await expect(drain(watchdogStream({ watchdog, watchdogCode: CODE, iterator: stalled }))).rejects.toThrow('read aborted')
    expect(timeoutOf(watchdog.signal, CODE)).toBeDefined()
  })

  it('throws the watchdog reason when it fired before a done result is honored', async () => {
    using watchdog = idleWatchdog(undefined, 5, CODE)
    // The iterator ignores the fused signal and finishes after the idle
    // interval. The probe runs before `done` is honored, so the fired
    // watchdog wins — matching the pi-ai transport, which returns an
    // abort-shaped chunk rather than throwing on a watchdog abort.
    const slowFinish: AsyncIterator<number> = {
      async next() {
        await new Promise(resolve => setTimeout(resolve, 20))
        return { value: undefined as never, done: true }
      },
    }

    await expect(drain(watchdogStream({ watchdog, watchdogCode: CODE, iterator: slowFinish })))
      .rejects.toMatchObject({ code: CODE })
    expect(timeoutOf(watchdog.signal, CODE)).toBeDefined()
  })

  it('returns the iterator when the consumer stops early', async () => {
    using watchdog = idleWatchdog(undefined, 60_000, CODE)
    const iterator = manualIterator([1, 2, 3])
    const stream = watchdogStream({ watchdog, watchdogCode: CODE, iterator })

    expect((await stream.next()).value).toBe(1)
    await stream.return(undefined)
    expect(iterator.returnCalls()).toBe(1)
  })

  it('swallows a teardown failure on early consumer exit', async () => {
    using watchdog = idleWatchdog(undefined, 60_000, CODE)
    const iterator = manualIterator([1, 2], () => { throw new Error('teardown abort') })
    const stream = watchdogStream({ watchdog, watchdogCode: CODE, iterator })

    await stream.next()
    await expect(stream.return(undefined)).resolves.toMatchObject({ done: true })
    expect(iterator.returnCalls()).toBe(1)
  })
})
