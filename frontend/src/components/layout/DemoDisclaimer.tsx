'use client'
import { Info } from 'lucide-react'

interface DemoDisclaimerProps {
  datasetName?: string
}

export default function DemoDisclaimer({ datasetName: _datasetName }: DemoDisclaimerProps) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
      <span>
        You&apos;re exploring with sample data. All numbers here are for illustration. Connect your own data to see real results.
      </span>
    </div>
  )
}
