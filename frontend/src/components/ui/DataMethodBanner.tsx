'use client'
/**
 * DataMethodBanner — prominent full-width strip placed at the top of panels
 * showing how the numbers in that panel were produced.
 *
 * More visible than DataMethodBadge (inline); use this at panel/card level,
 * not inside chart titles.
 *
 * Three states:
 *   meridian  Green  — Bayesian MCMC posterior. Compact and confirming.
 *   pearson   Amber  — Pearson correlation heuristic. Prominent warning.
 *   mock      Slate  — No real data. Prominent call to action.
 */

import type { DataMethod } from '@/lib/types'

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M8 1.5L2 4v4c0 3.314 2.686 6 6 6s6-2.686 6-6V4L8 1.5z" fill="currentColor" opacity="0.2" />
      <path d="M8 1.5L2 4v4c0 3.314 2.686 6 6 6s6-2.686 6-6V4L8 1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TriangleAlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M8 2L1.5 13.5h13L8 2z" fill="currentColor" opacity="0.15" />
      <path d="M8 2L1.5 13.5h13L8 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" />
    </svg>
  )
}

function CircleDashedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2" />
    </svg>
  )
}

interface DataMethodBannerProps {
  method: DataMethod
}

export default function DataMethodBanner({ method }: DataMethodBannerProps) {
  if (method === 'meridian') {
    return (
      <div className="flex items-center gap-2.5 px-4 py-2 bg-green-50 border border-green-200 rounded-xl text-xs">
        <ShieldCheckIcon className="w-4 h-4 text-green-600 shrink-0" />
        <span className="font-bold text-green-800 uppercase tracking-wide">MODEL RESULTS</span>
        <span className="text-green-700">· Bayesian analysis complete · Confidence ranges from MCMC sampling</span>
      </div>
    )
  }

  if (method === 'pearson') {
    return (
      <div className="flex items-start gap-2.5 px-4 py-2.5 bg-amber-50 border border-amber-300 rounded-xl text-xs">
        <TriangleAlertIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-amber-800 uppercase tracking-wide">ESTIMATED RESULTS</span>
          <span className="text-amber-700 ml-2">· These numbers are directional — they reflect correlation between spend and revenue, not causal inference. Run the full model for confidence intervals.</span>
        </div>
      </div>
    )
  }

  // mock
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs">
      <CircleDashedIcon className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
      <div>
        <span className="font-bold text-slate-700 uppercase tracking-wide">SAMPLE DATA</span>
        <span className="text-slate-500 ml-2">· These are illustrative figures. Load a dataset in step 1 and run the model in step 2 to see real results.</span>
      </div>
    </div>
  )
}
