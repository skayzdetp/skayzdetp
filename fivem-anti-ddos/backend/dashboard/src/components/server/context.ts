import { useOutletContext } from 'react-router-dom'
import type { Server } from '@/lib/types'

export interface ServerContext {
  server: Server
}

export function useServerContext(): ServerContext {
  return useOutletContext<ServerContext>()
}
