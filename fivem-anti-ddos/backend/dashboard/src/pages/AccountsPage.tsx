import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DicesIcon, KeyRoundIcon, MoreHorizontalIcon, PlusIcon, ShieldIcon, Trash2Icon, UserIcon, UsersIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, errorMessage } from '@/lib/api'
import { useUser } from '@/lib/auth'
import { copyText, timeAgo } from '@/lib/format'
import { keys, useUsers } from '@/lib/queries'
import type { UserRow } from '@/lib/types'

function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(18))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Password</Label>
      <div className="flex gap-2">
        <Input id={id} type="text" autoComplete="off" spellCheck={false} className="font-mono" minLength={10} value={value} onChange={(e) => onChange(e.target.value)} required />
        <Button type="button" variant="outline" onClick={() => onChange(generatePassword())}>
          <DicesIcon /> Generate
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">At least 10 characters. Share it with the person safely – they can change it after signing in.</p>
    </div>
  )
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api.post('/users', { email, password, role }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: keys.users })
      await copyText(password)
      toast.success('Account created. The password was copied to your clipboard.')
      onOpenChange(false)
      setEmail('')
      setPassword('')
      setRole('user')
    },
    onError: (err) => setError(errorMessage(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add an account</DialogTitle>
            <DialogDescription>Accounts see and manage only their own servers. Administrators see everything.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-email">Email</Label>
            <Input id="new-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <PasswordField id="new-password" value={password} onChange={setPassword} />
          <div className="space-y-2">
            <Label htmlFor="new-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'user' | 'admin')}>
              <SelectTrigger id="new-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Account (own servers only)</SelectItem>
                <SelectItem value="admin">Administrator</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => api.patch(`/users/${user!.id}`, { password }),
    onSuccess: async () => {
      await copyText(password)
      toast.success('Password changed and copied to your clipboard. The user was signed out everywhere.')
      setPassword('')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            reset.mutate()
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>{user?.email}</DialogDescription>
          </DialogHeader>
          <PasswordField id="reset-password" value={password} onChange={setPassword} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={reset.isPending}>
              {reset.isPending ? 'Saving…' : 'Set password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AccountsPage() {
  const me = useUser()
  const queryClient = useQueryClient()
  const { data, isPending, error, refetch } = useUsers()
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<UserRow | null>(null)

  const changeRole = useMutation({
    mutationFn: (v: { id: string; role: 'admin' | 'user' }) => api.patch(`/users/${v.id}`, { role: v.role }),
    onSuccess: () => {
      toast.success('Role updated.')
      queryClient.invalidateQueries({ queryKey: keys.users })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}`),
    onSuccess: () => {
      toast.success('Account deleted.')
      queryClient.invalidateQueries({ queryKey: keys.users })
      queryClient.invalidateQueries({ queryKey: keys.servers })
    },
  })

  return (
    <>
      <PageHeader
        title="Accounts"
        description="People who can sign in to this dashboard."
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> Add account
          </Button>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : data.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No accounts" />
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-32">Role</TableHead>
                <TableHead className="hidden w-24 sm:table-cell">Servers</TableHead>
                <TableHead className="hidden w-32 md:table-cell">Last sign-in</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.email} {u.id === me.id ? <span className="text-xs font-normal text-muted-foreground">(you)</span> : null}
                  </TableCell>
                  <TableCell>
                    {u.role === 'admin' ? (
                      <Badge>
                        <ShieldIcon /> Administrator
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <UserIcon /> Account
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">{u.serverCount}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.email}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setResetting(u)}>
                          <KeyRoundIcon /> Reset password
                        </DropdownMenuItem>
                        {u.id !== me.id ? (
                          <DropdownMenuItem onSelect={() => changeRole.mutate({ id: u.id, role: u.role === 'admin' ? 'user' : 'admin' })}>
                            <ShieldIcon /> {u.role === 'admin' ? 'Make regular account' : 'Make administrator'}
                          </DropdownMenuItem>
                        ) : null}
                        {u.id !== me.id ? (
                          <>
                            <DropdownMenuSeparator />
                            <ConfirmDialog
                              trigger={
                                <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                                  <Trash2Icon /> Delete account
                                </DropdownMenuItem>
                              }
                              title={`Delete ${u.email}?`}
                              description={`This also deletes the ${u.serverCount} server${u.serverCount === 1 ? '' : 's'} of this account, with all statistics and lists.`}
                              confirmLabel="Delete account"
                              onConfirm={() => remove.mutateAsync(u.id)}
                            />
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </>
  )
}
