import { refinePacked } from '../refine.ts'
import type { PackedLayout } from '../types.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'

/** The only thing the host needs from its environment: a way to send messages to the caller. */
export interface HostPort {
  postMessage(message: WorkerResponse): void
}

/**
 * The worker's behaviour with the messaging taken out, so it can be tested in plain Node. Starting
 * a run cancels the one before it; a cancelled run says nothing more about its improvements.
 */
export function createHost(port: HostPort) {
  let active: { id: number; controller: AbortController } | null = null

  return {
    handle(request: WorkerRequest) {
      if (request.type === 'cancel') {
        if (active?.id === request.id) active.controller.abort()
        return
      }

      active?.controller.abort()
      const controller = new AbortController()
      const { id } = request
      active = { id, controller }
      const report = (type: 'first' | 'improved') => (layout: PackedLayout) => {
        if (!controller.signal.aborted) port.postMessage({ type, id, layout })
      }
      refinePacked(
        request.input,
        { ...request.limits, signal: controller.signal },
        report('improved'),
        report('first'),
      ).then(
        (summary) => port.postMessage({ type: 'done', id, summary }),
        (error: unknown) =>
          port.postMessage({
            type: 'failed',
            id,
            message: error instanceof Error ? error.message : 'The packer failed.',
          }),
      )
    },
  }
}
