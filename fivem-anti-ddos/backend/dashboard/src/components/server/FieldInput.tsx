import { InfoIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { humanDuration } from '@/lib/format'
import type { Field, FieldValue, IntField } from '@/lib/types'

function Help({ text }: { text?: string }) {
  if (!text) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="More information">
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  )
}

const DURATIONS: [string, number][] = [
  ['1 min', 60],
  ['5 min', 300],
  ['15 min', 900],
  ['1 h', 3600],
  ['6 h', 21600],
  ['24 h', 86400],
  ['7 d', 604800],
]

function IntInput({ id, field, value, onChange }: { id: string; field: IntField; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  const isSeconds = field.unit === 'seconds'
  const useSlider = field.max - field.min <= 600
  const presets = isSeconds && field.max >= 3600 ? DURATIONS.filter(([, s]) => s >= field.min && s <= field.max) : []

  function commit(raw: string) {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) return setText(String(value))
    const clamped = Math.min(field.max, Math.max(field.min, Math.round(n)))
    setText(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Label htmlFor={id}>{field.label}</Label>
          <Help text={field.help} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            step={1}
            className="h-8 w-24 text-right tabular-nums"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              const n = Number(e.target.value)
              if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= field.min && n <= field.max && Math.round(n) !== value) onChange(Math.round(n))
            }}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
          />
          {field.unit ? <span className="max-w-24 text-xs leading-tight text-muted-foreground">{field.unit}</span> : null}
        </div>
      </div>
      {useSlider ? (
        <Slider
          aria-label={field.label}
          min={field.min}
          max={field.max}
          step={1}
          value={[value]}
          onValueChange={([v]) => v !== undefined && onChange(v)}
        />
      ) : null}
      {isSeconds && value >= 60 ? <p className="text-xs text-muted-foreground">≈ {humanDuration(value)}</p> : null}
      {presets.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {presets.map(([label, secs]) => (
            <Button key={secs} type="button" size="xs" variant={secs === value ? 'secondary' : 'ghost'} onClick={() => onChange(secs)}>
              {label}
            </Button>
          ))}
          {field.min === 0 ? (
            <Button type="button" size="xs" variant={value === 0 ? 'secondary' : 'ghost'} onClick={() => onChange(0)}>
              Off
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** `idPrefix` keeps DOM ids unique: several protections share field names such as `windowSec`. */
export function FieldInput({ idPrefix, field, value, onChange }: { idPrefix: string; field: Field; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const id = `${idPrefix}-${field.key}`
  switch (field.type) {
    case 'int':
      return <IntInput id={id} field={field} value={typeof value === 'number' ? value : field.default} onChange={onChange} />
    case 'bool':
      return (
        <div className="flex items-start justify-between gap-4 @xl:col-span-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={id}>{field.label}</Label>
            </div>
            {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
          </div>
          <Switch id={id} checked={typeof value === 'boolean' ? value : field.default} onCheckedChange={onChange} />
        </div>
      )
    case 'select':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={id}>{field.label}</Label>
            <Help text={field.help} />
          </div>
          <Select value={typeof value === 'string' ? value : field.default} onValueChange={onChange}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case 'text':
      return (
        <div className="space-y-2 @xl:col-span-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={id}>{field.label}</Label>
            <Help text={field.help} />
          </div>
          <Input id={id} maxLength={field.maxLength} value={typeof value === 'string' ? value : field.default} onChange={(e) => onChange(e.target.value)} />
        </div>
      )
  }
}
