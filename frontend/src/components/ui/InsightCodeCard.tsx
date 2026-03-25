'use client'
import { useState } from 'react'
import { Code2, ChevronDown } from 'lucide-react'
import CodeBlock from '@/components/ui/CodeBlock'

interface InsightCodeCardProps {
  title: string
  description?: string
  code: string
  defaultOpen?: boolean
}

/** Collapsible “how this is computed” block for insight tabs. */
export default function InsightCodeCard({
  title,
  description,
  code,
  defaultOpen = false,
}: InsightCodeCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-surface-200 bg-slate-50/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 sm:px-4 text-left hover:bg-slate-100/80 transition-colors min-h-[44px]"
      >
        <Code2 className="w-4 h-4 text-brand-600 shrink-0" />
        <span className="text-xs font-semibold text-slate-800 flex-1">{title}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {description && !open && (
        <p className="px-3 sm:px-4 pb-2 text-[11px] text-slate-500 leading-relaxed">{description}</p>
      )}
      {open && (
        <div className="px-2 pb-3 sm:px-3 border-t border-surface-200 bg-white">
          {description && <p className="text-[11px] text-slate-500 py-2 leading-relaxed">{description}</p>}
          <CodeBlock code={code} />
        </div>
      )}
    </div>
  )
}
