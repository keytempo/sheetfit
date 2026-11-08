import type { WorkerLike } from '../worker/client.ts'
import { createHost } from '../worker/host.ts'
import type { WorkerRequest, WorkerResponse } from '../worker/protocol.ts'

/**
 * A stand-in for a Web Worker: the real host behind a pair of message ports, so every message is
 * structured-cloned exactly as it would be across a worker boundary.
 */
export function fakeWorker() {
  const { port1, port2 } = new MessageChannel()
  const host = createHost({ postMessage: (message) => port2.postMessage(message) })
  port2.onmessage = (event: MessageEvent<WorkerRequest>) => host.handle(event.data)
  const worker: WorkerLike & { terminated: boolean; crash(): void } = {
    terminated: false,
    postMessage: (message) => port1.postMessage(message),
    addEventListener: (type: string, listener: unknown) => {
      if (type === 'message') {
        port1.addEventListener('message', listener as (event: MessageEvent<WorkerResponse>) => void)
        port1.start()
      } else {
        errorListeners.push(listener as (event: ErrorEvent) => void)
      }
    },
    terminate() {
      worker.terminated = true
      port1.close()
      port2.close()
    },
    crash() {
      for (const listener of errorListeners) listener({ message: 'boom' } as ErrorEvent)
    },
  }
  const errorListeners: ((event: ErrorEvent) => void)[] = []
  return worker
}
