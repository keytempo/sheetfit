import { Refinement } from '../refine.ts'
import type { PackedLayout } from '../types.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'

/** The only thing the host needs from its environment: a way to send messages to the caller. */
export interface HostPort {
  postMessage(message: WorkerResponse): void
}

/**
 * The worker's behaviour with the messaging taken out, so it can be tested in plain Node. Starting
 * a run cancels the one before it; a cancelled run says nothing more about its improvements.
 *
 * A run that stops at its time limit leaves its search paused here, so that `continue` can carry on
 * from the best layout found instead of starting again. Only the latest run can be continued: any
 * request, run or continue, throws away what was paused before it, so a `continue` for a layout
 * that has since been replaced is answered with a failure and never touches the new one.
 */
export function createHost(port: HostPort) {
  let active: { id: number; controller: AbortController } | null = null
  let paused: { id: number; refinement: Refinement } | null = null

  return {
    handle(request: WorkerRequest) {
      if (request.type === 'cancel') {
        if (active?.id === request.id) active.controller.abort()
        return
      }

      active?.controller.abort()
      const resumable = paused
      paused = null
      const controller = new AbortController()
      const { id } = request
      active = { id, controller }
      const report = (type: 'first' | 'improved') => (layout: PackedLayout) => {
        if (!controller.signal.aborted) port.postMessage({ type, id, layout })
      }
      const fail = (message: string) => port.postMessage({ type: 'failed', id, message })

      let refinement: Refinement
      let limits
      try {
        if (request.type === 'continue') {
          if (resumable?.id !== request.from) return fail('There is no search to continue.')
          refinement = resumable.refinement
          limits = request.limits
        } else {
          refinement = new Refinement(request.input, request.limits)
          limits = request.limits
          report('first')(refinement.layout)
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'The packer failed.')
      }

      refinement.run({ ...limits, signal: controller.signal }, report('improved')).then(
        (summary) => {
          if (summary.stopped === 'time-limit' && active?.id === id) paused = { id, refinement }
          port.postMessage({ type: 'done', id, summary })
        },
        (error: unknown) => fail(error instanceof Error ? error.message : 'The packer failed.'),
      )
    },
  }
}
