// OnboardingSurface: the full-viewport first-run takeover an onboarding step
// wraps its visible content in. The overlay portals to this document's body
// (the Modal precedent: ancestor stacking contexts cannot leave sticky page
// controls above the mask), and the surface holds every body child except
// itself inert for exactly its own lifetime — including body-portaled dialogs
// a step opens via openSection, which would otherwise stay keyboard- and
// screen-reader-reachable under the takeover. A step that renders null paints
// nothing and blocks nothing, so "should onboarding show right now" stays a
// plain render decision inside the step component.

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './OnboardingSurface.module.css'

/**
 * Render the onboarding takeover chrome (mask + opaque stage) around one
 * step's content and keep the rest of the document inert while mounted.
 * @param props.children - the step's page content, centered on the stage.
 * @returns the body-portaled overlay tree.
 */
export function OnboardingSurface({ children }: { children: ReactNode }) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return
    const affected: Element[] = []
    for (const child of document.body.children) {
      // The `inert` attribute type is not in this lib target; the attribute
      // itself is standard and honoured by every browser.
      const el = child as HTMLElement
      if (child !== surface && el.getAttribute('inert') === null) {
        el.setAttribute('inert', '')
        affected.push(child)
      }
    }
    return () => { for (const child of affected) (child as HTMLElement).removeAttribute('inert') }
  }, [])

  return createPortal((
    <div ref={surfaceRef} className={css.onboardingOverlay} role="presentation">
      <div className={css.onboardingMask} aria-hidden="true" />
      <div className={css.onboardingStage}>{children}</div>
    </div>
  ), document.body)
}
