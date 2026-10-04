import { ArrowLeftIcon, ShieldAlertIcon } from 'lucide-react'
import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { ServerStatusBadge } from '@/components/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { useServer } from '@/lib/queries'
import type { ServerContext } from '@/components/server/context'
import { ServerIcon } from 'lucide-react'

const TABS = [
  { path: '', value: 'overview', label: 'Overview' },
  { path: 'protections', value: 'protections', label: 'Protections' },
  { path: 'lists', value: 'lists', label: 'Block / allow lists' },
  { path: 'events', value: 'events', label: 'Events' },
  { path: 'settings', value: 'settings', label: 'Settings' },
]

export function ServerPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const { data: server, error, isPending, refetch } = useServer(id)

  const segment = location.pathname.split('/')[3] ?? ''
  const tab = TABS.find((t) => t.path === segment)?.value ?? 'overview'

  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState icon={ServerIcon} title="Server not found" description="It may have been deleted, or it belongs to another account.">
        <Link to="/" className="text-sm underline">
          Back to all servers
        </Link>
      </EmptyState>
    )
  }
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const context: ServerContext = { server }

  return (
    <>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> All servers
      </Link>
      <PageHeader
        title={server.name}
        description={server.ownerEmail && server.ownerEmail.length > 0 ? `${server.status.serverName ? `${server.status.serverName} · ` : ''}${server.ownerEmail}` : server.status.serverName ?? undefined}
        actions={<ServerStatusBadge server={server} />}
      />

      {server.status.online && server.status.attack.active ? (
        <Alert variant="destructive" className="mb-6">
          <ShieldAlertIcon />
          <AlertTitle>Under-attack mode is active</AlertTitle>
          <AlertDescription>
            Since {timeAgo(server.status.attack.since)}. Connections are restricted until the attack stops; returning players can still join. You can change this on the Overview tab.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} className="mb-6">
        <div className="overflow-x-auto">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} asChild>
                <Link to={t.path ? `/servers/${id}/${t.path}` : `/servers/${id}`}>{t.label}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <Outlet context={context} />
    </>
  )
}
