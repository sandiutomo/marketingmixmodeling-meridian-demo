'use client'
import type { SaturationResult } from '@/lib/types'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import { fmt, fmtROI } from '@/lib/format'
import { getSaturationBadge } from '@/lib/types'

interface Props {
  data: SaturationResult
  currency?: 'USD' | 'IDR'
}

function ratioColor(ratio: number): string {
  if (ratio > 1.1) return 'bg-red-50 border-red-100'
  if (ratio < 0.7) return 'bg-green-50 border-green-100'
  return 'bg-amber-50 border-amber-100'
}

function ratioTextColor(ratio: number): string {
  if (ratio > 1.1) return 'text-red-700 font-bold'
  if (ratio < 0.7) return 'text-green-700 font-bold'
  return 'text-amber-700 font-semibold'
}

export default function SaturationHeatmap({ data, currency = 'USD' }: Props) {
  const method = data.is_real_meridian ? 'meridian' : 'pearson'

  if (!data.channels.length) {
    return (
      <div className="text-xs text-slate-400 py-4 text-center">
        Run the model to see saturation analysis.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Saturation by channel</p>
        <DataMethodBadge method={method} />
      </div>
      <p className="text-xs text-slate-500">
        Saturation ratio = monthly spend ÷ the spend level where returns start to flatten. Above 1.1 means you&apos;re past the efficient range; below 0.7 means there&apos;s room to grow.
      </p>

      <div className="overflow-x-auto rounded-xl border border-surface-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-50 text-left text-slate-500">
              <th className="px-3 py-2 font-semibold">Channel</th>
              <th className="px-3 py-2 font-semibold text-right">Monthly Spend</th>
              <th className="px-3 py-2 font-semibold text-right">Half-sat point</th>
              <th className="px-3 py-2 font-semibold text-right">Sat. ratio</th>
              <th className="px-3 py-2 font-semibold text-right">Marginal ROI</th>
              <th className="px-3 py-2 font-semibold text-right">Avg ROI</th>
              <th className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {data.channels.map((ch, idx) => {
              const badge = getSaturationBadge(ch.status)
              return (
                <tr key={ch.channel_key} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'} ${ratioColor(ch.saturation_ratio)}`}>
                  <td className="px-3 py-2 font-medium text-slate-700">{ch.channel}</td>
                  <td className="px-3 py-2 text-right text-slate-600 font-mono">
                    {fmt(ch.current_spend, currency)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500 font-mono">
                    {ch.ec != null ? fmt(ch.ec, currency) : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${ratioTextColor(ch.saturation_ratio)}`}>
                    {ch.saturation_ratio.toFixed(2)}×
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600 font-mono">
                    {ch.marginal_roi != null ? fmtROI(ch.marginal_roi, currency) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600 font-mono">
                    {fmtROI(ch.roi, currency)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.color}`}>{badge.text}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-200" /> Ratio &gt; 1.1 — overspending past efficiency knee</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-200" /> 0.7–1.1 — near efficient zone</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-200" /> Ratio &lt; 0.7 — room to grow</span>
      </div>
    </div>
  )
}
