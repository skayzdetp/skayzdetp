import { CodeBlock } from '@/components/CodeBlock'
import { serverCfgSnippet } from '@/lib/format'

/** The three steps to connect a FiveM server. `apiKey` is only known right after creation / rotation. */
export function ConnectGuide({ apiKey, keyPrefix }: { apiKey?: string; keyPrefix?: string }) {
  const shownKey = apiKey ?? `${keyPrefix ?? 'fxs_'}…  (your full key)`
  return (
    <ol className="space-y-4 text-sm">
      <li className="flex gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">1</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p>
            Copy the folder <code className="rounded bg-muted px-1 py-0.5 text-xs">resource/fxshield</code> from the repository into your server's{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">resources</code> folder.
          </p>
        </div>
      </li>
      <li className="flex gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">2</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p>
            Add this to your <code className="rounded bg-muted px-1 py-0.5 text-xs">server.cfg</code> – near the top, before your other resources. Use{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">set</code>, never <code className="rounded bg-muted px-1 py-0.5 text-xs">setr</code> /{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">sets</code>.
          </p>
          <CodeBlock code={apiKey ? serverCfgSnippet(apiKey) : serverCfgSnippet(shownKey)} copyLabel="Copy" />
          <p className="text-xs text-muted-foreground">
            Recommended: also add <code className="rounded bg-muted px-1 py-0.5">sv_endpointprivacy false</code>. FXServer hides player IP addresses by default, and without them
            the IP-based protections cannot work (the license-based ones still do).
          </p>
        </div>
      </li>
      <li className="flex gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">3</span>
        <div className="min-w-0 flex-1">
          <p>
            Start (or restart) the server. This page shows <strong>Online</strong> within seconds, and the server console prints{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">[fxshield] connected to the backend</code>.
          </p>
        </div>
      </li>
    </ol>
  )
}
