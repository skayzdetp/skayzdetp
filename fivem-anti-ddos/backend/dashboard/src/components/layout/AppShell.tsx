import { useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, LogOutIcon, MenuIcon, MonitorIcon, MoonIcon, ServerIcon, SunIcon, UsersIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { ChangePasswordDialog } from '@/components/layout/ChangePasswordDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'
import { useUser } from '@/lib/auth'
import { useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

function NavItem({ to, icon, children, onNavigate }: { to: string; icon: ReactNode; children: ReactNode; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted [&_svg]:size-4',
          isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  )
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const Icon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [passwordOpen, setPasswordOpen] = useState(false)

  async function signOut() {
    try {
      await api.post('/auth/logout')
    } finally {
      queryClient.clear()
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <Logo />
        <div className="leading-tight">
          <div className="font-semibold">FX Shield</div>
          <div className="text-xs text-muted-foreground">FiveM protection</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-2">
        <NavItem to="/" icon={<ServerIcon />} onNavigate={onNavigate}>
          Servers
        </NavItem>
        {user.role === 'admin' ? (
          <NavItem to="/accounts" icon={<UsersIcon />} onNavigate={onNavigate}>
            Accounts
          </NavItem>
        ) : null}
      </nav>

      <div className="flex items-center gap-1 border-t p-2">
        <ThemeMenu />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 min-w-0 flex-1 justify-between px-2">
              <span className="truncate text-sm">{user.email}</span>
              <ChevronsUpDownIcon className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="truncate text-sm font-medium">{user.email}</div>
              <div className="text-xs text-muted-foreground">{user.role === 'admin' ? 'Administrator' : 'Account'}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
              <KeyRoundIcon /> Change password
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={signOut}>
              <LogOutIcon /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  )
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground md:block">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <MenuIcon />
          </Button>
          <Logo className="size-6" />
          <span className="font-semibold">FX Shield</span>
        </header>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-64 bg-sidebar p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Menu</SheetTitle>
              <SheetDescription>Navigation</SheetDescription>
            </SheetHeader>
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
