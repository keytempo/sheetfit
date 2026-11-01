import { createHost } from './host.ts'
import type { WorkerRequest } from './protocol.ts'

/** The worker's entry point: it hands every message to the host and sends the answers back. */
const host = createHost({ postMessage: (message) => self.postMessage(message) })
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => host.handle(event.data))
