import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/format'

export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'xs' | 'sm' | 'default' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const ok = await copyText(text)
    if (!ok) {
      toast.error('Could not copy – select the text and copy it manually.')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <Button type="button" variant="outline" size={size} onClick={copy}>
      {copied ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
      {copied ? 'Copied' : label}
    </Button>
  )
}
