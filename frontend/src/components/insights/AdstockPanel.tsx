'use client'
import { useState } from 'react'
import { Code2, ChevronDown, ChevronUp } from 'lucide-react'
import SectionTooltip from '@/components/ui/SectionTooltip'
import type { AdstockChannelParams } from '@/lib/types'
import { fmtPct } from '@/lib/format'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import CodeBlock from '@/components/ui/CodeBlock'

const ADSTOCK_CODE = `# google-meridian 1.5.3 — extract adstock / carryover parameters
from meridian.analysis import analyzer

an = analyzer.Analyzer(meridian=model)

# Posterior adstock decay rates per channel
# Shape: (n_samples, n_channels)  — geometric decay (L parameter in Meridian)
adstock = an.adstock_decay()

for ch in adstock.channel.values:
    samples = adstock.sel(channel=ch)
    mean  = float(samples.mean())
    lo    = float(samples.quantile(0.10))
    hi    = float(samples.quantile(0.90))
    print(f"{ch}: decay = {mean:.3f}  [80% CI: {lo:.3f} – {hi:.3f}]")

# Example output:
# tv:           decay = 0.62  [80% CI: 0.54 – 0.70]
# social:       decay = 0.45  [80% CI: 0.38 – 0.52]
# search:       decay = 0.28  [80% CI: 0.22 – 0.35]
# ooh:          decay = 0.71  [80% CI: 0.63 – 0.79]
# ecommerce:    decay = 0.31  [80% CI: 0.25 – 0.38]
`

interface AdstockPanelProps {
  adstockParams: AdstockChannelParams[]
}

function buildDecayCurve(decayRate: number, maxLag: number) {
  return Array.from({ length: maxLag + 1 }, (_, week) => ({
    week,
    pct: Math.round(Math.pow(decayRate, week) * 100),
  }))
}

function carryoverSummary(decayRate: number): string {
  const week1 = fmtPct(decayRate * 100, 0)
  const week2 = fmtPct(decayRate ** 2 * 100, 0)
  const halfLifeWeeks = Math.ceil(Math.log(0.5) / Math.log(decayRate))
  return `${week1} carries into week 2 · ${week2} into week 3 · half-life ≈ ${halfLifeWeeks} week${halfLifeWeeks !== 1 ? 's' : ''}`
}

function decayLabel(rate: number): { text: string; color: string } {
  if (rate >= 0.55) return { text: 'Long carryover', color: 'text-blue-600 bg-blue-50' }
  if (rate >= 0.35) return { text: 'Medium carryover', color: 'text-amber-600 bg-amber-50' }
  return { text: 'Short carryover', color: 'text-green-600 bg-green-50' }
}

type ViewMode = 'glance' | 'weekly'

export default function AdstockPanel({ adstockParams }: AdstockPanelProps) {
  const [selected, setSelected] = useState(0)
  const [view, setView] = useState<ViewMode>('glance')
  const [showCode, setShowCode] = useState(false)
  if (!adstockParams || adstockParams.length === 0) return null

  const ch = adstockParams[selected]
  const decayRate = ch.decayRate ?? 0.4
  const curve = buildDecayCurve(decayRate, Math.min(ch.maxLag, 12))
  const badge = decayLabel(decayRate)

  return (
    <div className="card card-body space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900">How long ads keep working</h3>
            <SectionTooltip content="Adstock (or carryover) measures how long a channel keeps driving revenue after you stop spending. A slow decay means TV impact from last week is still showing up in this week's sales. A fast decay means Digital channels lose effect almost immediately. This matters when deciding when to cut or boost spend." />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            How much of each channel&apos;s impact carries into the weeks after an ad runs.
          </p>
        </div>
        <DataMethodBadge method={ch.isReal ? 'meridian' : 'pearson'} />
      </div>

      {/* Toggle switch */}
      <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-lg w-fit text-xs font-medium">
        <button
          onClick={() => setView('glance')}
          className={`px-3 py-1.5 rounded-md transition-all ${view === 'glance' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          All channels at a glance
        </button>
        <button
          onClick={() => setView('weekly')}
          className={`px-3 py-1.5 rounded-md transition-all ${view === 'weekly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Weekly breakdown
        </button>
      </div>

      {/* View: All channels at a glance */}
      {view === 'glance' && (
        <div className="overflow-hidden rounded-xl border border-surface-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-50 text-left">
                <th className="px-3 py-2 font-semibold text-slate-500">Channel</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Decay / week</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Week +1</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Week +2</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Half-life</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {adstockParams.map((p, idx) => {
                const r = p.decayRate ?? 0.4
                const halfLife = Math.ceil(Math.log(0.5) / Math.log(r))
                const lb = decayLabel(r)
                return (
                  <tr
                    key={p.channel_key}
                    className={`cursor-pointer ${idx % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'} hover:bg-surface-100/60`}
                    onClick={() => { setSelected(idx); setView('weekly') }}
                  >
                    <td className="px-3 py-2 font-medium text-slate-700">{p.channel}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{fmtPct(r * 100, 0)}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtPct(r * 100, 0)}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtPct(r ** 2 * 100, 0)}</td>
                    <td className="px-3 py-2 text-slate-600">{halfLife}w</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${lb.color}`}>{lb.text}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-slate-400 bg-surface-50 border-t border-surface-100">Click a row to see the weekly breakdown for that channel.</p>
        </div>
      )}

      {/* View: Weekly breakdown */}
      {view === 'weekly' && (
        <div className="space-y-3">
          {/* Channel selector */}
          <div className="flex flex-wrap gap-2">
            {adstockParams.map((p, idx) => (
              <button
                key={p.channel_key}
                onClick={() => setSelected(idx)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  idx === selected
                    ? 'bg-brand-600 text-white'
                    : 'bg-surface-100 text-slate-600 hover:bg-surface-200'
                }`}
              >
                {p.channel}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-slate-900">{ch.channel}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.color}`}>{badge.text}</span>
            <span className="text-xs text-slate-500">Decay rate: <strong className="text-slate-700">{fmtPct(decayRate * 100, 0)} per week</strong></span>
          </div>
          <p className="text-xs text-slate-500">{carryoverSummary(decayRate)}</p>

          {/* Bar chart — decay by week */}
          <div className="space-y-1.5">
            {curve.map(({ week, pct }) => (
              <div key={week} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-16 shrink-0">
                  {week === 0 ? 'Ad runs' : `Week +${week}`}
                </span>
                <div className="flex-1 bg-surface-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: week === 0 ? '#4361ee' : `hsl(${220 - week * 12}, 70%, ${50 + week * 4}%)`,
                      opacity: Math.max(0.3, 1 - week * 0.08),
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-slate-600 w-10 text-right">{pct}%</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-500">Why this matters:</strong> Don&apos;t judge {ch.channel} on the same week it runs.
            {decayRate >= 0.5
              ? ` Its effects carry for ${Math.min(ch.maxLag, 8)} weeks — measuring only same-week conversions underestimates its real contribution.`
              : ` Its effects fade quickly, so weekly attribution is fairly accurate for this channel.`}
          </p>
        </div>
      )}

      {/* Code toggle — bottom, matching btn-secondary style */}
      <div className="pt-2 border-t border-surface-100 flex items-center gap-3">
        <button
          onClick={() => setShowCode(v => !v)}
          className="btn-secondary gap-1.5 text-xs"
        >
          <Code2 className="w-3.5 h-3.5" />
          {showCode ? 'Hide generated code' : 'Show generated code'}
          {showCode ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {showCode && <CodeBlock code={ADSTOCK_CODE} />}
    </div>
  )
}
