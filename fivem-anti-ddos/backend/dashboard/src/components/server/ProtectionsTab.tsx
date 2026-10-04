import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon, RotateCcwIcon, SaveIcon, Undo2Icon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/ErrorState'
import { ApplyStatus } from '@/components/server/ApplyStatus'
import { useServerContext } from '@/components/server/context'
import { FieldInput } from '@/components/server/FieldInput'
import { ProtectionCard } from '@/components/server/ProtectionCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api, errorMessage } from '@/lib/api'
import { keys, useCatalog } from '@/lib/queries'
import type { Config } from '@/lib/types'

/** JSON with sorted keys, so two equal configs always compare equal. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

export function ProtectionsTab() {
  const { server } = useServerContext()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const baseline = server.config as Config

  const [draft, setDraft] = useState<Config>(() => structuredClone(baseline))
  const dirty = useMemo(() => stable(draft) !== stable(baseline), [draft, baseline])

  // adopt changes made elsewhere (another admin, a preset applied earlier…) as long as there are no local edits
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(baseline))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.configRev])

  // warn before closing the tab with unsaved edits
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const save = useMutation({
    mutationFn: () => api.put<{ config: Config; configRev: number; changed: boolean }>(`/servers/${server.id}/config`, { config: draft }),
    onSuccess: (res) => {
      setDraft(structuredClone(res.config))
      toast.success(res.changed ? 'Saved – the server applies it within a few seconds.' : 'Nothing changed.')
      queryClient.invalidateQueries({ queryKey: keys.server(server.id) })
      queryClient.invalidateQueries({ queryKey: keys.servers })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (catalog.error) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />
  if (!catalog.data) return <Skeleton className="h-96 rounded-xl" />
  const cat = catalog.data

  function applyPreset(id: string) {
    const preset = cat.presets.find((p) => p.id === id)
    if (!preset) return
    setDraft((d) => ({ ...d, protections: structuredClone(preset.config.protections) }))
    toast.info(`“${preset.name}” applied – review it and press Save.`)
  }

  const groups = [
    { id: 'connections' as const, title: 'Connection protection', description: 'Decides who may connect to your server.' },
    { id: 'ingame' as const, title: 'In-game abuse protection', description: 'Stops connected players from crashing or flooding the server.' },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ApplyStatus server={server} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value="" onValueChange={applyPreset}>
            <SelectTrigger className="w-56" aria-label="Apply a preset">
              <SelectValue placeholder="Apply a preset…" />
            </SelectTrigger>
            <SelectContent>
              {cat.presets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.id} className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{g.title}</h2>
            <p className="text-sm text-muted-foreground">{g.description}</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {cat.protections
              .filter((p) => p.group === g.id)
              .map((def) => (
                <ProtectionCard
                  key={def.id}
                  def={def}
                  value={draft.protections[def.id] ?? {}}
                  serverOneSync={server.status.onesync}
                  onChange={(next) => setDraft((d) => ({ ...d, protections: { ...d.protections, [def.id]: next } }))}
                />
              ))}
          </div>
        </section>
      ))}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">General</h2>
        <Card>
          <CardContent className="grid gap-x-6 gap-y-5 pt-6 sm:grid-cols-2">
            {cat.general.map((f) => (
              <FieldInput key={f.key} idPrefix="general" field={f} value={draft.general[f.key]} onChange={(v) => setDraft((d) => ({ ...d, general: { ...d.general, [f.key]: v } }))} />
            ))}
          </CardContent>
        </Card>

        <Collapsible>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Messages shown to players</CardTitle>
                  <CardDescription>The text a player sees when the connection is rejected. Write it in your server's language.</CardDescription>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="group/trigger">
                    Edit <ChevronDownIcon className="transition-transform group-data-[state=open]/trigger:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {cat.messages.map((m) => (
                  <div key={m.key} className="space-y-2">
                    <Label htmlFor={`m-${m.key}`}>{m.label}</Label>
                    <Input
                      id={`m-${m.key}`}
                      maxLength={m.maxLength}
                      value={draft.messages[m.key] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, messages: { ...d.messages, [m.key]: e.target.value } }))}
                    />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft((d) => ({ ...d, messages: structuredClone(cat.defaults.messages) }))}
                  >
                    <RotateCcwIcon /> Restore default messages
                  </Button>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </section>

      <div
        className={`sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur transition-all ${
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
        }`}
        aria-hidden={!dirty}
      >
        <span className="text-sm">You have unsaved changes.</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDraft(structuredClone(baseline))} disabled={save.isPending}>
            <Undo2Icon /> Discard
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <SaveIcon /> {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
