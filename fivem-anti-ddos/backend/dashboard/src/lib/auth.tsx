import { useMe } from '@/lib/queries'
import type { User } from '@/lib/types'

/** The signed-in user. Only call inside routes protected by <RequireAuth>. */
export function useUser(): User {
  const me = useMe()
  if (!me.data?.user) throw new Error('useUser() called without a signed-in user')
  return me.data.user
}
