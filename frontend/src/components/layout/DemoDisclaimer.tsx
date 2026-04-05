'use client'
import { useState } from 'react'
import { FlaskConical, X } from 'lucide-react'

export default function DemoDisclaimer() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2 bg-ink-800 text-ink-200 rounded-lg text-xs border border-ink-700">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 shrink-0 text-amber-400" />
        <span>
          <span className="font-semibold text-amber-300">Sandbox mode</span>
          {' '}— numbers shown are illustrative sample data, not your real business results.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-ink-500 hover:text-ink-200 transition-colors ml-1"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
