import type { ReactNode } from 'react'
import { Logo } from '@/components/Logo'

export function AuthLayout({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo className="size-9" />
          <span className="text-xl font-semibold tracking-tight">FX Shield</span>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-1 mb-5 text-sm text-muted-foreground">{description}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
