import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlertIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CodeBlock } from '@/components/CodeBlock'
import { ConnectGuide } from '@/components/server/ConnectGuide'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { keys } from '@/lib/queries'
import type { Server } from '@/lib/types'

/** Shown once after creating a server or rotating its key. */
export function ApiKeyReveal({ apiKey }: { apiKey: string }) {
  return (
    <div className="space-y-4">
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>Copy your API key now</AlertTitle>
        <AlertDescription>It is shown only once. Only a hash is stored, so it cannot be displayed again – you can always rotate it for a new one.</AlertDescription>
      </Alert>
      <CodeBlock code={apiKey} />
      <ConnectGuide apiKey={apiKey} />
    </div>
  )
}

/**
 * Controlled on purpose: the page keeps this mounted for as long as it is open. If the dialog lived inside the
 * "no servers yet" empty state it would be unmounted the moment the first server appears – and the one-time API
 * key shown in step 2 would vanish with it.
 */
export function AddServerDialog({ open, onOpenChange: setOpen }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('')
  const [created, setCreated] = useState<{ server: Server; apiKey: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: (n: string) => api.post<{ server: Server; apiKey: string }>('/servers', { name: n }),
    onSuccess: (res) => {
      setCreated(res)
      queryClient.invalidateQueries({ queryKey: keys.servers })
    },
    onError: (err) => setError(errorMessage(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    create.mutate(name.trim())
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setName('')
      setCreated(null)
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>“{created.server.name}” was created</DialogTitle>
              <DialogDescription>Now connect your FiveM server with this key.</DialogDescription>
            </DialogHeader>
            <ApiKeyReveal apiKey={created.apiKey} />
            <DialogFooter>
              <Button
                onClick={() => {
                  onOpenChange(false)
                  navigate(`/servers/${created.server.id}`)
                }}
              >
                Open server
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add a server</DialogTitle>
              <DialogDescription>Each FiveM server gets its own API key and its own protection settings.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="server-name">Server name</Label>
              <Input id="server-name" autoFocus maxLength={60} placeholder="e.g. My RP Server" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || name.trim() === ''}>
                {create.isPending ? 'Creating…' : 'Create server'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
