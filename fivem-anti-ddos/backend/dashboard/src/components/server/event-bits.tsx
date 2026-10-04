import { Badge } from '@/components/ui/badge'
import type { EventItem } from '@/lib/types'

export function SeverityBadge({ severity }: { severity: EventItem['severity'] }) {
  if (severity === 'critical') return <Badge variant="destructive">Critical</Badge>
  if (severity === 'warn') return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">Warning</Badge>
  return <Badge variant="outline">Info</Badge>
}

const ACTION_LABEL: Record<EventItem['action'], string> = {
  logged: 'Logged',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  kicked: 'Kicked',
  banned: 'Banned',
}

export function ActionBadge({ action, detail }: { action: EventItem['action']; detail?: string | null }) {
  // monitor mode reports "would block: …" with action "logged"
  if (action === 'logged' && detail?.startsWith('would ')) return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">Monitor</Badge>
  if (action === 'kicked' || action === 'banned') return <Badge variant="destructive">{ACTION_LABEL[action]}</Badge>
  if (action === 'blocked' || action === 'cancelled') return <Badge variant="secondary">{ACTION_LABEL[action]}</Badge>
  return <Badge variant="outline">{ACTION_LABEL[action]}</Badge>
}

/** IP / identifier / name of the player an event is about. */
export function WhoCell({ event }: { event: EventItem }) {
  if (!event.ip && !event.identifier && !event.name) return <span className="text-muted-foreground">—</span>
  return (
    <div className="min-w-0 space-y-0.5 text-xs">
      {event.ip ? <div className="font-mono">{event.ip}</div> : null}
      {event.identifier ? <div className="max-w-56 truncate font-mono text-muted-foreground" title={event.identifier}>{event.identifier}</div> : null}
      {event.name ? <div className="max-w-56 truncate text-muted-foreground" title={event.name}>{event.name}</div> : null}
    </div>
  )
}
