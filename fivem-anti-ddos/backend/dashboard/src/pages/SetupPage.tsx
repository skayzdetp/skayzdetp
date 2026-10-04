import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/pages/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { keys, type MeResponse } from '@/lib/queries'
import type { User } from '@/lib/types'

export function SetupPage() {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) return setError('The passwords do not match.')
    setBusy(true)
    try {
      const { user } = await api.post<{ user: User }>('/auth/setup', { setupToken: token.trim(), email, password })
      queryClient.setQueryData<MeResponse>(keys.me, { user, needsSetup: false })
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Create the administrator account"
      description="First start: this account manages the whole installation. The setup token is printed in the backend's console / log."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="token">Setup token</Label>
          <Input id="token" autoFocus autoComplete="off" spellCheck={false} className="font-mono text-xs" value={token} onChange={(e) => setToken(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <p className="text-xs text-muted-foreground">At least 10 characters.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Repeat password</Label>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
