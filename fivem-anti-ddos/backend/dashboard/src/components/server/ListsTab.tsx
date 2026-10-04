import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, ShieldBanIcon, ShieldCheckIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { useServerContext } from '@/components/server/context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import { formatDate, timeUntil } from '@/lib/format'
import { keys, useLists } from '@/lib/queries'
import type { AddListResult, ListEntry } from '@/lib/types'

type ListName = 'block' | 'allow'

const DURATIONS: { value: string; label: string; ttl: number | null }[] = [
  { value: 'perm', label: 'Permanent', ttl: null },
  { value: '3600', label: '1 hour', ttl: 3600 },
  { value: '21600', label: '6 hours', ttl: 21600 },
  { value: '86400', label: '24 hours', ttl: 86400 },
  { value: '604800', label: '7 days', ttl: 604800 },
  { value: '2592000', label: '30 days', ttl: 2592000 },
]

const KIND_LABEL: Record<ListEntry['kind'], string> = { ip: 'IP address', cidr: 'IP range', identifier: 'Identifier' }

function AddEntryDialog({ list, open, onOpenChange }: { list: ListName; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { server } = useServerContext()
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState('perm')
  const [result, setResult] = useState<AddListResult | null>(null)

  const add = useMutation({
    mutationFn: () =>
      api.post<AddListResult>(`/servers/${server.id}/lists`, {
        list,
        value,
        reason: reason.trim() || undefined,
        ttlSec: DURATIONS.find((d) => d.value === duration)?.ttl ?? null,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: keys.lists(server.id) })
      queryClient.invalidateQueries({ queryKey: keys.server(server.id) })
      if (res.skipped.length === 0) {
        toast.success(`${res.added} ${res.added === 1 ? 'entry' : 'entries'} added.`)
        close(false)
      } else {
        setResult(res)
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  function close(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setValue('')
      setReason('')
      setDuration('perm')
      setResult(null)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    add.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {result.added} added, {result.skipped.length} skipped
              </DialogTitle>
              <DialogDescription>These values could not be added:</DialogDescription>
            </DialogHeader>
            <ul className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
              {result.skipped.map((s, i) => (
                <li key={`${s.value}-${i}`} className="flex flex-wrap gap-x-2">
                  <code className="font-mono text-xs">{s.value}</code>
                  <span className="text-muted-foreground">– {s.error}</span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{list === 'block' ? 'Add to blocklist' : 'Add to allowlist'}</DialogTitle>
              <DialogDescription>
                {list === 'block'
                  ? 'Blocked IPs, ranges and identifiers cannot connect.'
                  : 'Allowlisted players are never blocked, kicked or rate-limited by any protection – use it for yourself and your staff.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="entry-value">Values</Label>
              <Textarea
                id="entry-value"
                rows={5}
                autoFocus
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={'203.0.113.7\n198.51.100.0/24\nlicense:0123456789abcdef…\ndiscord:123456789012345678'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                One or many – separated by new lines, commas or spaces. Accepts IPv4/IPv6 addresses, IPv4 ranges (/8–/32) and license, license2, steam, discord, fivem, xbl or live identifiers.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="entry-reason">Reason (optional)</Label>
                <Input id="entry-reason" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entry-duration">Duration</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger id="entry-duration" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={add.isPending || value.trim() === ''}>
                {add.isPending ? 'Adding…' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ListsTab() {
  const { server } = useServerContext()
  const queryClient = useQueryClient()
  const lists = useLists(server.id)
  const [list, setList] = useState<ListName>('block')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/servers/${server.id}/lists/${id}`),
    onSuccess: () => {
      toast.success('Entry removed.')
      queryClient.invalidateQueries({ queryKey: keys.lists(server.id) })
      queryClient.invalidateQueries({ queryKey: keys.server(server.id) })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const all = lists.data?.items ?? []
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((e) => e.list === list && (q === '' || e.value.toLowerCase().includes(q) || (e.reason ?? '').toLowerCase().includes(q)))
  }, [all, list, search])
  const counts = { block: all.filter((e) => e.list === 'block').length, allow: all.filter((e) => e.list === 'allow').length }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={list} onValueChange={(v) => setList(v as ListName)}>
          <TabsList>
            <TabsTrigger value="block">
              <ShieldBanIcon /> Blocklist <Badge variant="secondary">{counts.block}</Badge>
            </TabsTrigger>
            <TabsTrigger value="allow">
              <ShieldCheckIcon /> Allowlist <Badge variant="secondary">{counts.allow}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Input placeholder="Search…" aria-label="Search entries" className="w-48" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> Add
          </Button>
        </div>
      </div>

      {list === 'allow' ? (
        <Alert>
          <ShieldCheckIcon />
          <AlertDescription>
            Allowlisted players skip <strong>every</strong> protection. Add yourself and your staff here, so a strict setting can never lock you out. You can also set a local allowlist in the
            resource's <code>config.lua</code>, which works even when the backend is offline.
          </AlertDescription>
        </Alert>
      ) : null}

      {lists.error ? (
        <ErrorState error={lists.error} onRetry={() => lists.refetch()} />
      ) : lists.isPending ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={list === 'block' ? ShieldBanIcon : ShieldCheckIcon}
          title={search ? 'No matching entries' : list === 'block' ? 'The blocklist is empty' : 'The allowlist is empty'}
          description={search ? undefined : list === 'block' ? 'Add IPs, IP ranges or identifiers that must never connect.' : 'Add yourself and your staff so no protection ever affects them.'}
        >
          {!search ? (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> Add entries
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="hidden md:table-cell">Reason</TableHead>
                <TableHead className="hidden sm:table-cell w-32">Added</TableHead>
                <TableHead className="w-28">Expires</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="max-w-72 truncate font-mono text-xs" title={e.value}>
                    {e.value}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{KIND_LABEL[e.kind]}</Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-60 truncate text-sm text-muted-foreground md:table-cell">{e.reason ?? '—'}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{formatDate(e.createdAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.expiresAt ? timeUntil(e.expiresAt) : 'Never'}</TableCell>
                  <TableCell>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${e.value}`}>
                          <Trash2Icon />
                        </Button>
                      }
                      title="Remove this entry?"
                      description={
                        <span>
                          <code className="font-mono text-xs">{e.value}</code> will be {list === 'block' ? 'allowed to connect again' : 'subject to the protections again'}. The server picks this up within a few
                          seconds.
                        </span>
                      }
                      confirmLabel="Remove"
                      onConfirm={() => remove.mutateAsync(e.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {lists.data ? (
        <p className="text-xs text-muted-foreground">
          {counts[list]} / {formatLimit(lists.data.limit)} entries used. The server receives changes within its sync interval.
        </p>
      ) : null}

      <AddEntryDialog key={list} list={list} open={adding} onOpenChange={setAdding} />
    </div>
  )
}

function formatLimit(n: number): string {
  return new Intl.NumberFormat().format(n)
}
