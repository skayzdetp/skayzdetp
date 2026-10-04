import { PlusIcon, ServerIcon, ShieldAlertIcon, UsersIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { AddServerDialog } from '@/components/server/AddServerDialog'
import { ServerStatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useUser } from '@/lib/auth'
import { formatNumber, timeAgo } from '@/lib/format'
import { useServers } from '@/lib/queries'
import type { Server } from '@/lib/types'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium tabular-nums">{value}</div>
    </div>
  )
}

function ServerCard({ server, showOwner }: { server: Server; showOwner: boolean }) {
  const s = server.status
  const sum = server.summary24h
  return (
    <Link to={`/servers/${server.id}`} className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardHeader className="gap-1">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="truncate text-base">{server.name}</CardTitle>
            <ServerStatusBadge server={server} />
          </div>
          {showOwner && server.ownerEmail ? <p className="truncate text-xs text-muted-foreground">{server.ownerEmail}</p> : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Players" value={s.online && s.players !== null ? `${s.players}${s.maxPlayers ? ` / ${s.maxPlayers}` : ''}` : '—'} />
            <Stat label="Last seen" value={timeAgo(s.lastSeenAt)} />
            <Stat label="Blocked (24 h)" value={formatNumber(sum.blocked)} />
          </div>
          {s.online && s.attack.active ? (
            <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              <ShieldAlertIcon className="size-3.5" /> Under-attack mode is active
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  )
}

export function ServersPage() {
  const user = useUser()
  const { data, isPending, error, refetch } = useServers()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHeader
        title="Servers"
        description={user.role === 'admin' ? 'All servers of all accounts.' : 'Your FiveM servers and their protection status.'}
        actions={
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> Add server
          </Button>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={ServerIcon}
          title="No server yet"
          description="Add your first server to get an API key. You then install the fxshield resource on it and configure the protection here."
        >
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> Add your first server
          </Button>
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <ServerCard key={s.id} server={s} showOwner={user.role === 'admin'} />
          ))}
        </div>
      )}
      <AddServerDialog open={adding} onOpenChange={setAdding} />
      {user.role === 'admin' && data && data.length > 0 ? (
        <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
          <UsersIcon className="size-3.5" /> Administrators see every account's servers.
        </p>
      ) : null}
    </>
  )
}
