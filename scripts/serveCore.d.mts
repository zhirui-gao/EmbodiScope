import type { IncomingMessage, ServerResponse } from 'node:http'
export function createDataHandler(roots: string[]): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
