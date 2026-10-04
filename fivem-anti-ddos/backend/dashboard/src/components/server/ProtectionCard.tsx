import {
  BoxesIcon,
  FingerprintIcon,
  FlameIcon,
  LockKeyholeIcon,
  MessageSquareWarningIcon,
  NetworkIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import { FieldInput } from '@/components/server/FieldInput'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import type { FieldValue, ProtectionDef } from '@/lib/types'

const ICONS: Record<string, LucideIcon> = {
  connectionFlood: NetworkIcon,
  playersPerIp: UsersRoundIcon,
  identityCheck: FingerprintIcon,
  attackMode: ShieldAlertIcon,
  gameEventFlood: FlameIcon,
  entitySpam: BoxesIcon,
  entityLockdown: LockKeyholeIcon,
  chatFlood: MessageSquareWarningIcon,
}

/** Colour of the selected mode button. */
function modeStyle(mode: string): string {
  switch (mode) {
    case 'enforce':
    case 'auto':
      return 'data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400'
    case 'monitor':
    case 'relaxed':
      return 'data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-600 dark:data-[state=on]:text-amber-400'
    case 'on':
    case 'strict':
      return 'data-[state=on]:bg-destructive/15 data-[state=on]:text-destructive'
    default:
      return 'data-[state=on]:bg-muted'
  }
}

export function ProtectionCard({
  def,
  value,
  onChange,
  serverOneSync,
}: {
  def: ProtectionDef
  value: Record<string, FieldValue>
  onChange: (next: Record<string, FieldValue>) => void
  serverOneSync: string | null
}) {
  const Icon = ICONS[def.id] ?? ShieldAlertIcon
  const mode = String(value.mode ?? def.defaultMode)
  const active = mode !== 'off'
  const modeDef = def.modes.find((m) => m.value === mode)
  const oneSyncOff = def.requiresOneSync && serverOneSync === 'off'

  return (
    <Card className={cn('transition-opacity', !active && 'opacity-80')}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{def.title}</CardTitle>
              {def.requiresOneSync ? <Badge variant="outline">OneSync</Badge> : null}
            </div>
            <CardDescription>{def.summary}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={mode}
            onValueChange={(v) => v && onChange({ ...value, mode: v })}
            aria-label={`${def.title} mode`}
            className="w-full"
          >
            {def.modes.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value} className={cn('flex-1', modeStyle(m.value))}>
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {modeDef ? <p className="text-xs text-muted-foreground">{modeDef.description}</p> : null}
        </div>

        {oneSyncOff && active ? (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            OneSync is disabled on this server, so this protection cannot work until you enable OneSync.
          </p>
        ) : null}
        {def.caveat && active ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {def.caveat}
          </p>
        ) : null}

        {def.fields.length > 0 ? (
          // two columns of fields only when the card itself is wide enough (container query, not viewport)
          <div className="@container">
            <div className={cn('grid gap-x-8 gap-y-5 @xl:grid-cols-2', !active && 'pointer-events-none opacity-50')} aria-disabled={!active}>
              {def.fields.map((f) => (
                <FieldInput key={f.key} idPrefix={def.id} field={f} value={value[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} />
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
