// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'

let appRoot: HTMLDivElement

beforeEach(() => {
  appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.appendChild(appRoot)
})

afterEach(() => {
  cleanup()
  appRoot.remove()
})

describe('OnboardingSurface', () => {
  it('portals the overlay chrome to document.body around its content', () => {
    const view = render(<OnboardingSurface><p>step content</p></OnboardingSurface>)
    // Portaled: the overlay is a body child, not inside the render container.
    expect(view.container.querySelector('[class*="onboardingOverlay"]')).toBeNull()
    const overlay = document.body.querySelector('[class*="onboardingOverlay"]')
    expect(overlay).not.toBeNull()
    // The onboarding e2e pins the mask by class substring; the stage carries
    // the content.
    expect(overlay!.querySelector('[class*="onboardingMask"]')).not.toBeNull()
    const stage = overlay!.querySelector('[class*="onboardingStage"]')
    expect(stage).not.toBeNull()
    expect(stage!.textContent).toBe('step content')
  })

  it('holds the rest of the document inert for exactly its own lifetime', () => {
    const view = render(<OnboardingSurface>x</OnboardingSurface>)
    expect(appRoot.getAttribute('inert')).not.toBeNull()
    view.unmount()
    expect(appRoot.getAttribute('inert')).toBeNull()
  })

  it('inerts body-portaled dialogs opened during onboarding and restores them', () => {
    // A body-portaled dialog (the settings-panel precedent) sits outside #root;
    // it must fall under the takeover too.
    const dialog = document.createElement('div')
    dialog.id = 'portaled-dialog'
    document.body.appendChild(dialog)
    const view = render(<OnboardingSurface>x</OnboardingSurface>)
    expect(dialog.getAttribute('inert')).not.toBeNull()
    expect(appRoot.getAttribute('inert')).not.toBeNull()
    view.unmount()
    expect(dialog.getAttribute('inert')).toBeNull()
    expect(appRoot.getAttribute('inert')).toBeNull()
    dialog.remove()
  })

  it('leaves pre-existing inert elements inert after unmount', () => {
    const already = document.createElement('div')
    already.setAttribute('inert', '')
    document.body.appendChild(already)
    const view = render(<OnboardingSurface>x</OnboardingSurface>)
    view.unmount()
    expect(already.getAttribute('inert')).not.toBeNull()
    already.remove()
  })

  it('renders without an #root element (compositions that mount elsewhere)', () => {
    appRoot.remove()
    const view = render(<OnboardingSurface>x</OnboardingSurface>)
    expect(document.body.querySelector('[class*="onboardingStage"]')!.textContent).toBe('x')
    view.unmount()
  })
})
