import type { Transition } from 'motion/react'

/*
 * Shared motion tokens for everything driven by the Motion library.
 * Overlays driven by CSS use the same values through the --ease-* and --dur-*
 * custom properties in src/index.css.
 */
const easeEnter: [number, number, number, number] = [0.22, 1, 0.36, 1]
const easeExit: [number, number, number, number] = [0.4, 0, 1, 1]

export const transitions = {
  enter: { duration: 0.22, ease: easeEnter },
  exit: { duration: 0.15, ease: easeExit },
  layout: { type: 'spring', stiffness: 420, damping: 38, mass: 0.8 },
} satisfies Record<string, Transition>

/** Fade and rise in, fade and drop out. Used for small floating surfaces and view switches. */
export const fadeSlide = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: transitions.enter },
  exit: { opacity: 0, y: 4, transition: transitions.exit },
}

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: transitions.enter },
  exit: { opacity: 0, transition: transitions.exit },
}
