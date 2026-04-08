'use client'
/**
 * DataMethodBadge — inline badge showing how a panel's numbers were computed.
 *
 * Three states:
 *   meridian  Green   · Meridian MCMC — Bayesian posterior, full credible intervals
 *   pearson   Amber   · Pearson estimate — statistical correlation, not causal
 *   mock      Slate   · Sample data — illustrative figures, no real dataset loaded
 *
 * Replaces the old MeridianBadge (which only had two states and was easy to miss).
 * Use DataMethodBanner for panel-level visibility on major cards.
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

interface DataMethodBadgeProps {
  method: DataMethod
  /** Show a compact version without the full label text */
  compact?: boolean
}

const CONFIG = {
  meridian: {
    icon: ShieldCheckIcon,
    label: 'Model results',
    title: 'Bayesian MCMC posterior — full credible intervals',
    classes: 'bg-green-50 text-green-700 border-green-200',
  },
  pearson: {
    icon: TriangleAlertIcon,
    label: 'Estimated',
    title: 'Statistical estimate — correlation-based, not causal',
    classes: 'bg-amber-50 text-amber-700 border-amber-300',
  },
  mock: {
    icon: CircleDashedIcon,
    label: 'Sample data',
    title: 'Illustrative sample data — not from a real model',
    classes: 'bg-slate-100 text-slate-500 border-slate-300',
  },
} as const

export default function DataMethodBadge({ method, compact = false }: DataMethodBadgeProps) {
  const { icon: Icon, label, title, classes } = CONFIG[method]
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${classes}`}
      title={title}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {!compact && <span>{label}</span>}
    </span>
  )
}
