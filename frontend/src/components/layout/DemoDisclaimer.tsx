'use client'
import { Info } from 'lucide-react'

export default function DemoDisclaimer() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
      <span>
        <strong>Demo mode:</strong> This dashboard uses preconfigured datasets and models for demonstration purposes only.
        Results are illustrative and not based on real business data.
      </span>
    </div>
  )
}
