import { Loader2Icon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { AppShell } from '@/components/layout/AppShell'
import { EventsTab } from '@/components/server/EventsTab'
import { ListsTab } from '@/components/server/ListsTab'
import { ProtectionsTab } from '@/components/server/ProtectionsTab'
import { SettingsTab } from '@/components/server/SettingsTab'
import { Skeleton } from '@/components/ui/skeleton'
import { useUser } from '@/lib/auth'
import { useMe } from '@/lib/queries'
import { AccountsPage } from '@/pages/AccountsPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ServerPage } from '@/pages/ServerPage'
import { ServersPage } from '@/pages/ServersPage'
import { SetupPage } from '@/pages/SetupPage'

// the overview pulls in the charting library – load it only when a server page is opened
const OverviewTab = lazy(() => import('@/components/server/OverviewTab').then((m) => ({ default: m.OverviewTab })))

function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center text-muted-foreground">
      <Loader2Icon className="size-6 animate-spin" />
    </div>
  )
}

/** Everything behind the login. */
function RequireAuth() {
  const me = useMe()
  const location = useLocation()
  if (me.isPending) return <FullPageSpinner />
  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    )
  }
  if (me.data.needsSetup) return <Navigate to="/setup" replace />
  if (!me.data.user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <AppShell />
}

/** Login / setup: not shown to signed-in users. */
function PublicOnly({ page }: { page: 'login' | 'setup' }) {
  const me = useMe()
  if (me.isPending) return <FullPageSpinner />
  if (me.data?.user) return <Navigate to="/" replace />
  if (page === 'login' && me.data?.needsSetup) return <Navigate to="/setup" replace />
  if (page === 'setup' && me.data && !me.data.needsSetup) return <Navigate to="/login" replace />
  return page === 'login' ? <LoginPage /> : <SetupPage />
}

function AdminOnly() {
  const user = useUser()
  return user.role === 'admin' ? <AccountsPage /> : <Navigate to="/" replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly page="login" />} />
      <Route path="/setup" element={<PublicOnly page="setup" />} />
      <Route element={<RequireAuth />}>
        <Route index element={<ServersPage />} />
        <Route path="servers/:id" element={<ServerPage />}>
          <Route
            index
            element={
              <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
                <OverviewTab />
              </Suspense>
            }
          />
          <Route path="protections" element={<ProtectionsTab />} />
          <Route path="lists" element={<ListsTab />} />
          <Route path="events" element={<EventsTab />} />
          <Route path="settings" element={<SettingsTab />} />
        </Route>
        <Route path="accounts" element={<AdminOnly />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
