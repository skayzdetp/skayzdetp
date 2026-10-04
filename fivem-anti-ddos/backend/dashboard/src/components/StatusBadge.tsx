import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Server } from '@/lib/types'

function Dot({ className }: { className: string }) {
  return <span className={cn('inline-block size-1.5 rounded-full', className)} />
}

export function ServerStatusBadge({ server }: { server: Server }) {
  const s = server.status
  if (!server.enabled) return <Badge variant="outline">Disabled</Badge>
  if (s.online && s.attack.active) {
    return (
      <Badge variant="destructive">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-destructive" />
        </span>
        Under attack
      </Badge>
    )
  }
  if (s.online) {
    return (
      <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400">
        <Dot className="bg-emerald-500" /> Online
      </Badge>
    )
  }
  if (s.lastSeenAt === null) {
    return (
      <Badge variant="outline">
        <Dot className="bg-amber-500" /> Waiting for connection
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Dot className="bg-muted-foreground" /> Offline
    </Badge>
  )
}
