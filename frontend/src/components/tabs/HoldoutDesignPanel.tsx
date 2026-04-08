'use client'
import type { HoldoutDesignResult } from '@/lib/types'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import { fmt, fmtROI, fmtPct } from '@/lib/format'

interface Props {
  data: HoldoutDesignResult
  currency?: 'USD' | 'IDR'
}

export default function HoldoutDesignPanel({ data, currency = 'USD' }: Props) {
  const method = data.is_real_meridian ? 'meridian' : 'pearson'

  if (!data.applicable) {
    return (
      <div className="px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-xs text-slate-500">
        Holdout design needs multiple regions. Your current dataset is national-level only.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-bold text-slate-900">Lift Test Design</h3>
        <DataMethodBadge method={method} />
      </div>
      <p className="text-sm text-slate-500">
        Suggested region split for a holdout experiment. Treatment regions run ads as normal;
        control regions pause ads so you can measure the real causal lift.
      </p>

      {/* Recommended duration callout */}
      <div className="px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl">
        <p className="text-xs font-semibold text-brand-700 mb-0.5">Suggested test length</p>
        <p className="text-2xl font-bold text-brand-900">{data.recommended_duration_weeks} weeks</p>
        <p className="text-xs text-brand-600 mt-0.5">
          {fmtPct(data.holdout_pct * 100, 0)} of geos in treatment ({data.treatment_geos.length} of {data.n_geos})
        </p>
      </div>

      {/* Treatment vs Control table */}
      <div className="grid grid-cols-2 gap-4">
        {/* Treatment */}
        <div className="rounded-xl border border-green-200 overflow-hidden">
          <div className="px-3 py-2 bg-green-50 border-b border-green-200">
            <p className="text-xs font-semibold text-green-700">Treatment regions ({data.treatment_geos.length})</p>
            <p className="text-xs text-green-600">Run ads as normal</p>
          </div>
          <div className="divide-y divide-surface-100">
            {data.assignments.filter(a => a.group === 'treatment').map(a => (
              <div key={a.geo} className="px-3 py-2">
                <p className="text-sm font-medium text-slate-800">{a.geo}</p>
                <div className="flex gap-3 text-xs text-slate-500 mt-0.5">
                  <span>Spend: {fmt(a.total_spend, currency)}</span>
                  <span>ROI: {fmtROI(a.portfolio_roi, currency)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Control */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-surface-50 border-b border-surface-200">
            <p className="text-xs font-semibold text-slate-600">Control regions ({data.control_geos.length})</p>
            <p className="text-xs text-slate-500">Hold back ads</p>
          </div>
          <div className="divide-y divide-surface-100">
            {data.assignments.filter(a => a.group === 'control').map(a => (
              <div key={a.geo} className="px-3 py-2">
                <p className="text-sm font-medium text-slate-800">{a.geo}</p>
                <div className="flex gap-3 text-xs text-slate-500 mt-0.5">
                  <span>Spend: {fmt(a.total_spend, currency)}</span>
                  <span>ROI: {fmtROI(a.portfolio_roi, currency)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">{data.method_note}</p>
    </div>
  )
}
