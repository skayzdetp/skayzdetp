import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ActivityIcon, GaugeIcon, ShieldAlertIcon, TriangleAlertIcon, UsersIcon, WifiIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { ApplyStatus } from '@/components/server/ApplyStatus'
import { ConnectGuide } from '@/components/server/ConnectGuide'
import { useServerContext } from '@/components/server/context'
import { SeverityBadge } from '@/components/server/event-bits'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, errorMessage } from '@/lib/api'
import { eventTypeLabel, formatDateTime, formatNumber, ruleLabel, storageGet, storageSet, timeAgo } from '@/lib/format'
import { keys, useCatalog, useEvents, useStats } from '@/lib/queries'
import type { StatsRange } from '@/lib/types'

const RANGES: { value: StatsRange; label: string }[] = [
  { value: '1h', label: '1 h' },
  { value: '6h', label: '6 h' },
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
]

const chartConfig = {
  allowed: { label: 'Allowed', color: 'oklch(0.72 0.15 160)' },
  blocked: { label: 'Rejected', color: 'oklch(0.63 0.22 25)' },
  monitored: { label: 'Would block (monitor)', color: 'oklch(0.8 0.16 85)' },
} satisfies ChartConfig

function Tile({ icon, title, value, sub }: { icon: ReactNode; title: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex-row items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4.5">{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="truncate text-lg leading-tight font-semibold tabular-nums">{value}</div>
          {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function Total({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'amber' }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === 'red' && value > 0 ? 'text-destructive' : ''} ${tone === 'amber' && value > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
        {formatNumber(value)}
      </div>
    </div>
  )
}

function AttackModeControl() {
  const { server } = useServerContext()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const current = String(server.config?.protections.attackMode?.mode ?? 'auto')
  const def = catalog.data?.protections.find((p) => p.id === 'attackMode')

  const change = useMutation({
    mutationFn: (mode: string) => api.patch(`/servers/${server.id}/config`, { patch: { protections: { attackMode: { mode } } } }),
    onSuccess: () => {
      toast.success('Under-attack mode updated.')
      queryClient.invalidateQueries({ queryKey: keys.server(server.id) })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!def) return null
  const modeDef = def.modes.find((m) => m.value === current)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlertIcon className="size-4" /> Under-attack mode
        </CardTitle>
        <CardDescription>The panic switch: while active, strangers cannot join and per-IP limits are tightened. Returning players still get in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={current}
          disabled={change.isPending}
          onValueChange={(v) => v && v !== current && change.mutate(v)}
          aria-label="Under-attack mode"
          className="w-full"
        >
          {def.modes.map((m) => (
            <ToggleGroupItem
              key={m.value}
              value={m.value}
              className={`flex-1 ${m.value === 'on' ? 'data-[state=on]:bg-destructive/15 data-[state=on]:text-destructive' : m.value === 'auto' ? 'data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400' : ''}`}
            >
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {modeDef ? <p className="text-xs text-muted-foreground">{modeDef.description}</p> : null}
      </CardContent>
    </Card>
  )
}

export function OverviewTab() {
  const { server } = useServerContext()
  const catalog = useCatalog()
  const [range, setRangeState] = useState<StatsRange>(() => {
    const stored = storageGet('fxshield-range')
    return stored === '1h' || stored === '6h' || stored === '24h' || stored === '7d' ? stored : '24h'
  })
  const stats = useStats(server.id, range)
  const events = useEvents(server.id, {}, { limit: 8 })
  const s = server.status
  const cfg = server.config

  const setRange = (r: StatsRange) => {
    setRangeState(r)
    storageSet('fxshield-range', r)
  }

  const ipProtectionOn = ['connectionFlood', 'playersPerIp'].some((id) => cfg?.protections[id]?.mode && cfg.protections[id]?.mode !== 'off')
  const oneSyncProtectionOn = ['gameEventFlood', 'entitySpam', 'entityLockdown'].some((id) => cfg?.protections[id]?.mode && cfg.protections[id]?.mode !== 'off')

  const tick = (t: number) =>
    new Intl.DateTimeFormat(undefined, range === '7d' ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' }).format(new Date(t * 1000))

  const rows = (stats.data?.buckets ?? []).map((b) => ({ t: b.t, allowed: b.allowed, blocked: b.blocked, monitored: b.monitored }))
  const totals = stats.data?.totals
  const recent = events.data?.pages[0]?.items ?? []
  const maxRule = Math.max(1, ...(stats.data?.byRule ?? []).map((r) => r.blocked + r.monitored))

  return (
    <div className="space-y-6">
      {s.lastSeenAt === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect your FiveM server</CardTitle>
            <CardDescription>
              This server has not connected yet. Follow these steps – the API key was shown when you created the server. Lost it? Rotate it in{' '}
              <Link to={`/servers/${server.id}/settings`} className="underline">
                Settings
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectGuide keyPrefix={server.keyPrefix} />
          </CardContent>
        </Card>
      ) : null}

      {s.online && s.onesync === 'off' && oneSyncProtectionOn ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>OneSync is disabled on this server</AlertTitle>
          <AlertDescription>The in-game guards (events, entities, lockdown) need OneSync. The connection protection works without it.</AlertDescription>
        </Alert>
      ) : null}
      {s.online && s.endpointPrivacy && ipProtectionOn ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>FX Shield cannot see player IP addresses</AlertTitle>
          <AlertDescription>
            FXServer hides them while <code>sv_endpointprivacy</code> is on (its default), so IP-based limits are inactive. License-based limits, the blocklist by license and
            under-attack mode still work. Add <code>sv_endpointprivacy false</code> to your server.cfg and restart to get full protection.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<WifiIcon />}
          title="Connection"
          value={s.online ? 'Online' : s.lastSeenAt === null ? 'Waiting' : 'Offline'}
          sub={s.lastSeenAt ? `Last sync ${timeAgo(s.lastSeenAt)}` : 'No sync yet'}
        />
        <Tile icon={<UsersIcon />} title="Players" value={s.online && s.players !== null ? `${s.players}${s.maxPlayers ? ` / ${s.maxPlayers}` : ''}` : '—'} sub={s.serverName ?? undefined} />
        <Tile
          icon={<GaugeIcon />}
          title="Scheduler delay"
          value={s.online && s.tickMs !== null ? `${s.tickMs} ms` : '—'}
          sub={s.online ? 'Lower is better' : undefined}
        />
        <Tile
          icon={<ActivityIcon />}
          title="Resource"
          value={s.resourceVersion ? `v${s.resourceVersion}` : '—'}
          sub={s.onesync ? `OneSync: ${s.onesync}` : undefined}
        />
      </div>
      <div className="-mt-2">
        <ApplyStatus server={server} />
      </div>

      <AttackModeControl />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Connection traffic</CardTitle>
              <CardDescription>Connection attempts per time slot: allowed, rejected, and what monitor mode would have rejected.</CardDescription>
            </div>
            <ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={(v) => v && setRange(v as StatsRange)} aria-label="Time range">
              {RANGES.map((r) => (
                <ToggleGroupItem key={r.value} value={r.value}>
                  {r.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {stats.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <ComposedChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" tickFormatter={tick} tickLine={false} axisLine={false} minTickGap={36} tickMargin={8} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(_v, payload) => (payload?.[0]?.payload?.t ? formatDateTime(payload[0].payload.t) : '')} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area dataKey="allowed" stackId="a" type="monotone" stroke="var(--color-allowed)" fill="var(--color-allowed)" fillOpacity={0.25} isAnimationActive={false} />
                <Area dataKey="blocked" stackId="a" type="monotone" stroke="var(--color-blocked)" fill="var(--color-blocked)" fillOpacity={0.35} isAnimationActive={false} />
                <Line dataKey="monitored" type="monotone" stroke="var(--color-monitored)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ChartContainer>
          )}
          {totals ? (
            <div className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-3 lg:grid-cols-6">
              <Total label="Attempts" value={totals.attempts} />
              <Total label="Rejected" value={totals.blocked} tone="red" />
              <Total label="Would block (monitor)" value={totals.monitored} tone="amber" />
              <Total label="Cancelled events" value={totals.cancelled} />
              <Total label="Kicked" value={totals.kicked} tone="red" />
              <Total label="Temporary bans" value={totals.banned} tone="red" />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What was stopped</CardTitle>
            <CardDescription>By protection, in the selected period.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.data && stats.data.byRule.length > 0 ? (
              stats.data.byRule.map((r) => (
                <div key={r.rule} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{ruleLabel(r.rule, catalog.data)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {r.blocked > 0 ? <span className="text-foreground">{formatNumber(r.blocked)} stopped</span> : null}
                      {r.blocked > 0 && r.monitored > 0 ? ' · ' : null}
                      {r.monitored > 0 ? <span className="text-amber-600 dark:text-amber-400">{formatNumber(r.monitored)} detected</span> : null}
                    </span>
                  </div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-destructive/70" style={{ width: `${(r.blocked / maxRule) * 100}%` }} />
                    <div className="bg-amber-500/70" style={{ width: `${(r.monitored / maxRule) * 100}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Nothing was stopped in this period.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Recent events</CardTitle>
                <CardDescription>Latest things the resource reported.</CardDescription>
              </div>
              <Link to={`/servers/${server.id}/events`} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {events.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <ul className="divide-y">
                {recent.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm">
                        {eventTypeLabel(e.type)}
                        {e.count > 1 ? <span className="text-muted-foreground"> ×{formatNumber(e.count)}</span> : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {ruleLabel(e.rule, catalog.data)}
                        {e.ip ? ` · ${e.ip}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <SeverityBadge severity={e.severity} />
                      <span className="w-16 text-right text-xs text-muted-foreground">{timeAgo(e.ts)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
