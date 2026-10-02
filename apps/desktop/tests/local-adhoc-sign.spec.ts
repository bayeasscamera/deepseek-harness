import { describe, expect, it } from 'vitest'
import {
  adhocSignArguments,
  adhocSignMacOSApp,
  adhocVerifyArguments,
} from '../scripts/local-adhoc-sign.mjs'

const APPLICATION = '/tmp/DeepSeek Harness.app'

describe('desktop local ad-hoc signing', () => {
  it('signs with the ad-hoc identity and verifies the nested code', () => {
    const calls: (readonly string[])[] = []
    adhocSignMacOSApp(APPLICATION, (args) => {
      calls.push(args)
      return { status: 0, stdout: '', stderr: '' }
    })
    expect(calls).toEqual([adhocSignArguments(APPLICATION), adhocVerifyArguments(APPLICATION)])
    expect(adhocSignArguments(APPLICATION)).toEqual(['--force', '--deep', '--sign', '-', APPLICATION])
    expect(adhocVerifyArguments(APPLICATION)).toEqual(['--verify', '--deep', '--strict', APPLICATION])
  })

  it('rejects a failed signing invocation with its diagnostics', () => {
    expect(() => {
      adhocSignMacOSApp(APPLICATION, () => ({
        status: 1,
        stdout: '',
        stderr: 'code object is not signed at all',
      }))
    }).toThrow(/codesign sign exited with 1: code object is not signed at all/u)
  })

  it('rejects a failed verification after signing', () => {
    const outcomes = [
      { status: 0, stdout: '', stderr: '' },
      { status: 1, stdout: '', stderr: 'invalid signature' },
    ]
    let call = 0
    expect(() => {
      adhocSignMacOSApp(APPLICATION, () => outcomes[call++] ?? { status: 1, stdout: '', stderr: 'unexpected call' })
    }).toThrow(/codesign verify exited with 1: invalid signature/u)
  })

  it('reports a codesign that could not start', () => {
    expect(() => {
      adhocSignMacOSApp(APPLICATION, () => ({
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('spawn ENOENT'),
      }))
    }).toThrow(/could not execute codesign sign: spawn ENOENT/u)
  })
})
