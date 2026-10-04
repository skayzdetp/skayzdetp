import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontalIcon, ScrollTextIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { ActionBadge, SeverityBadge, WhoCell } from '@/components/server/event-bits'
import { useServerContext } from '@/components/server/context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, errorMessage } from '@/lib/api'
import { EVENT_TYPES, eventTypeLabel, formatDateTime, formatNumber, ruleLabel, timeAgo } from '@/lib/format'
import { keys, useCatalog, useEvents } from '@/lib/queries'
import type { EventItem } from '@/lib/types'

export function EventsTab() {
  const { server } = useServerContext()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const [severity, setSeverity] = useState('all')
  const [type, setType] = useState('all')

  const q = useEvents(server.id, { severity: severity === 'all' ? undefined : severity, type: type === 'all' ? undefined : type }, { limit: 40 })
  const items: EventItem[] = q.data?.pages.flatMap((p) => p.items) ?? []

  const addToList = useMutation({
    mutationFn: (v: { list: 'block' | 'allow'; value: string }) =>
      api.post<{ added: number }>(`/servers/${server.id}/lists`, { list: v.list, value: v.value, reason: 'Added from the event log' }),
    onSuccess: (_res, v) => {
      toast.success(`${v.value} was added to the ${v.list === 'block' ? 'blocklist' : 'allowlist'}.`)
      queryClient.invalidateQueries({ queryKey: keys.lists(server.id) })
      queryClient.invalidateQueries({ queryKey: keys.server(server.id) })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-40" aria-label="Severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warn">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-52" aria-label="Event type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {Object.entries(EVENT_TYPES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Updates automatically. Identical events are merged into one row with a counter.</span>
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : items.length === 0 ? (
        <EmptyState icon={ScrollTextIcon} title="No events" description="Nothing matches this filter yet. Events appear here as soon as the resource reports blocked attempts, bans or attacks." />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="hidden lg:table-cell">Details</TableHead>
                <TableHead className="w-24">Result</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="align-top text-xs whitespace-nowrap text-muted-foreground">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{timeAgo(e.ts)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{formatDateTime(e.ts)}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{eventTypeLabel(e.type)}</span>
                      {e.count > 1 ? <span className="text-xs text-muted-foreground">×{formatNumber(e.count)}</span> : null}
                      <SeverityBadge severity={e.severity} />
                    </div>
                    <div className="text-xs text-muted-foreground">{ruleLabel(e.rule, catalog.data)}</div>
                  </TableCell>
                  <TableCell className="align-top">
                    <WhoCell event={e} />
                  </TableCell>
                  <TableCell className="hidden max-w-sm align-top text-xs break-words whitespace-normal text-muted-foreground lg:table-cell">{e.detail ?? '—'}</TableCell>
                  <TableCell className="align-top">
                    <ActionBadge action={e.action} detail={e.detail} />
                  </TableCell>
                  <TableCell className="align-top">
                    {e.ip || e.identifier ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Actions">
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Add to list</DropdownMenuLabel>
                          {e.ip ? <DropdownMenuItem onSelect={() => addToList.mutate({ list: 'block', value: e.ip! })}>Block IP {e.ip}</DropdownMenuItem> : null}
                          {e.identifier ? <DropdownMenuItem onSelect={() => addToList.mutate({ list: 'block', value: e.identifier! })}>Block {e.identifier.split(':')[0]} identifier</DropdownMenuItem> : null}
                          <DropdownMenuSeparator />
                          {e.ip ? <DropdownMenuItem onSelect={() => addToList.mutate({ list: 'allow', value: e.ip! })}>Allow IP (never block)</DropdownMenuItem> : null}
                          {e.identifier ? <DropdownMenuItem onSelect={() => addToList.mutate({ list: 'allow', value: e.identifier! })}>Allow identifier (never block)</DropdownMenuItem> : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {q.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? 'Loading…' : 'Load older events'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
