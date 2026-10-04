import { CheckCircle2Icon, CircleDashedIcon, CloudOffIcon } from 'lucide-react'
import type { Server } from '@/lib/types'

/** Tells whether the server already runs the latest saved configuration. */
export function ApplyStatus({ server }: { server: Server }) {
  if (server.status.lastSeenAt === null) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CloudOffIcon className="size-4" /> Not connected yet – the settings are delivered on the first connection.
      </span>
    )
  }
  if (!server.status.online) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CloudOffIcon className="size-4" /> Server offline – changes are applied when it reconnects.
      </span>
    )
  }
  if (server.appliedConfigRev === server.configRev && server.appliedListsRev === server.listsRev) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2Icon className="size-4" /> Active on the server (revision {server.configRev})
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
      <CircleDashedIcon className="size-4 animate-spin" /> Applying on the server…
    </span>
  )
}
