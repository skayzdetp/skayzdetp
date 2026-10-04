import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, Trash2Icon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ApiKeyReveal } from '@/components/server/AddServerDialog'
import { useServerContext } from '@/components/server/context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { keys } from '@/lib/queries'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs">{children}</span>
    </div>
  )
}

export function SettingsTab() {
  const { server } = useServerContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState(server.name)
  const [newKey, setNewKey] = useState<string | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: keys.server(server.id) })
    queryClient.invalidateQueries({ queryKey: keys.servers })
  }

  const update = useMutation({
    mutationFn: (body: { name?: string; enabled?: boolean }) => api.patch(`/servers/${server.id}`, body),
    onSuccess: () => {
      toast.success('Saved.')
      refresh()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  function rename(e: FormEvent) {
    e.preventDefault()
    update.mutate({ name: name.trim() })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>How this server is listed in the dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form onSubmit={rename} className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="srv-name">Name</Label>
              <Input id="srv-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <Button type="submit" disabled={update.isPending || name.trim() === '' || name.trim() === server.name}>
              Save
            </Button>
          </form>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="srv-enabled">Server enabled</Label>
              <p className="text-xs text-muted-foreground">
                When disabled, the backend refuses this server's API key. The resource keeps protecting with the last configuration it received.
              </p>
            </div>
            <Switch id="srv-enabled" checked={server.enabled} onCheckedChange={(enabled) => update.mutate({ enabled })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection details</CardTitle>
          <CardDescription>Technical information about this server.</CardDescription>
        </CardHeader>
        <CardContent>
          <Row label="Server ID">{server.id}</Row>
          <Row label="API key">{server.keyPrefix}…</Row>
          <Row label="Created">{formatDateTime(server.createdAt)}</Row>
          <Row label="Last sync from">{server.status.lastIp ?? '—'}</Row>
          <Row label="Game server build">{server.status.build ?? '—'}</Row>
          <Row label="Config / list revision">
            {server.configRev} / {server.listsRev}
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">API key</CardTitle>
          <CardDescription>
            Rotate the key if it leaked or you lost it. The old key stops working immediately; update <code>fxshield_key</code> in your server.cfg and restart the resource.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmDialog
            trigger={
              <Button variant="outline">
                <KeyRoundIcon /> Rotate API key
              </Button>
            }
            title="Rotate the API key?"
            description="The current key is revoked right away. The resource keeps protecting with its last configuration, but cannot sync until you install the new key."
            confirmLabel="Rotate key"
            destructive={false}
            onConfirm={async () => {
              const res = await api.post<{ apiKey: string }>(`/servers/${server.id}/rotate-key`)
              setNewKey(res.apiKey)
              refresh()
            }}
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Delete server</CardTitle>
          <CardDescription>Removes the server with its statistics, events and lists. The resource on the game server stops syncing but keeps its last configuration.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmDialog
            trigger={
              <Button variant="destructive">
                <Trash2Icon /> Delete server
              </Button>
            }
            title={`Delete “${server.name}”?`}
            description="This cannot be undone."
            confirmLabel="Delete"
            onConfirm={async () => {
              await api.del(`/servers/${server.id}`)
              queryClient.removeQueries({ queryKey: keys.server(server.id) })
              queryClient.invalidateQueries({ queryKey: keys.servers })
              toast.success('Server deleted.')
              navigate('/', { replace: true })
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={newKey !== null} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>The previous key no longer works.</DialogDescription>
          </DialogHeader>
          {newKey ? <ApiKeyReveal apiKey={newKey} /> : null}
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
