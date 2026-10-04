import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M16 5l9 3.5v7.2c0 5.2-3.7 9.2-9 11.3-5.3-2.1-9-6.1-9-11.3V8.5L16 5z" className="fill-emerald-500" />
      <path d="M12 15.8l3 3 5.2-5.6" fill="none" className="stroke-primary" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
