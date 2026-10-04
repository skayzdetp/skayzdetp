import { CopyButton } from '@/components/CopyButton'

export function CodeBlock({ code, copyLabel = 'Copy' }: { code: string; copyLabel?: string }) {
  return (
    <div className="relative rounded-md border bg-muted/40">
      <pre className="overflow-x-auto p-3 pr-24 font-mono text-xs leading-relaxed whitespace-pre">{code}</pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={code} label={copyLabel} size="xs" />
      </div>
    </div>
  )
}
