'use client'
import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { getGeoBreakdown } from '@/lib/api'
import { fmt, fmtROI, fmtSignedPct, fmtPct } from '@/lib/format'
import type { ModelResults } from '@/lib/types'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface GeoRow {
  geo: string
  totalRevenue: number
  totalSpend: number
  portfolioRoi: number
  mediaRevenue: number
  baseRevenue: number
  channels: Array<{ channel: string; roi: number; spend: number; revenue: number }>
  isReal: boolean
}

interface Props {
  modelResults: ModelResults | null
}

function roiColor(roi: number, avg: number): string {
  if (roi >= avg * 1.2) return '#22c55e'
  if (roi <= avg * 0.8) return '#f97316'
  return '#4361ee'
}

export default function GeoBreakdown({ modelResults }: Props) {
  const [rows, setRows] = useState<GeoRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const currency = modelResults?.currency ?? 'USD'
  const nGeos = modelResults?.nGeos ?? 0

  useEffect(() => {
    if (!modelResults || nGeos <= 1) return
    setLoading(true)
    getGeoBreakdown()
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setRows(data)
          setSelected(data[0].geo)
        } else {
          setError('No geo-level data available for this dataset.')
        }
      })
      .catch(() => setError('Geo breakdown requires the backend to be running.'))
      .finally(() => setLoading(false))
  }, [modelResults?.dataSource])

  if (nGeos <= 1) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Geo-Level Performance</h2>
          <p className="text-slate-500 mt-1">ROI and revenue attribution broken down by geography.</p>
        </div>
        <div className="card card-body text-center py-12">
          <p className="text-slate-500 text-sm">This dataset uses national-level data — there is no geographic breakdown available.</p>
          <p className="text-xs text-slate-400 mt-1">Switch to a geo dataset (e.g. Geo Media) in Step 1 to see geo-level results.</p>
        </div>
      </div>
    )
  }

  const avgRoi = rows ? rows.reduce((a, r) => a + r.portfolioRoi, 0) / rows.length : 0

  const selectedRow = rows?.find(r => r.geo === selected) ?? rows?.[0] ?? null

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-2xl font-bold text-slate-900">Geo-Level Performance</h2>
          {rows && rows[0]?.isReal
            ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">Meridian posterior</span>
            : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Estimated</span>
          }
        </div>
        <p className="text-slate-500 mt-1">ROI and revenue attribution for each geography.</p>
      </div>

      {!modelResults && (
        <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs font-medium text-amber-700">Run the analysis in Step 2 to see geo-level results.</p>
        </div>
      )}

      {loading && (
        <div className="card card-body text-center py-12">
          <p className="text-slate-500 text-sm animate-pulse">Loading geo breakdown...</p>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs text-amber-700">{error}</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          {/* Portfolio ROI bar chart by geo */}
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-slate-900">Portfolio ROI by Geography</h3>
              {rows[0]?.isReal
                ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">Meridian posterior</span>
                : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Estimated</span>
              }
            </div>
            <p className="text-sm text-slate-500 mb-4">Average return across all channels, per geo. Bars above the dashed line outperform the portfolio average.</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={rows}
                margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                onClick={d => d?.activePayload && setSelected(d.activePayload[0].payload.geo)}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
                <XAxis dataKey="geo" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickFormatter={v => fmtROI(v, currency)}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v: number) => [fmtROI(v, currency), 'Portfolio ROI']}
                  labelFormatter={l => `Geography: ${l}`}
                />
                <Bar dataKey="portfolioRoi" radius={[6, 6, 0, 0]} cursor="pointer">
                  {rows.map(r => (
                    <Cell
                      key={r.geo}
                      fill={r.geo === selected ? '#1d4ed8' : roiColor(r.portfolioRoi, avgRoi)}
                      opacity={selected && r.geo !== selected ? 0.5 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-400 mt-1">Click a bar to see that geo's channel breakdown. Portfolio average: {fmtROI(avgRoi, currency)}</p>
          </div>

          {/* Selected geo detail */}
          {selectedRow && (
            <div className="card card-body space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-bold text-slate-900">{selectedRow.geo} — Channel breakdown</h3>
                <div className="flex flex-wrap gap-2">
                  {rows.map(r => (
                    <button
                      key={r.geo}
                      onClick={() => setSelected(r.geo)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        r.geo === selected
                          ? 'bg-brand-600 text-white'
                          : 'bg-surface-100 text-slate-600 hover:bg-surface-200'
                      }`}
                    >
                      {r.geo}
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total Revenue',   value: fmt(selectedRow.totalRevenue, currency) },
                  { label: 'Media Spend',     value: fmt(selectedRow.totalSpend, currency) },
                  { label: 'Portfolio ROI',   value: fmtROI(selectedRow.portfolioRoi, currency) },
                  { label: 'vs Portfolio Avg',
                    value: fmtSignedPct((selectedRow.portfolioRoi / avgRoi - 1) * 100),
                    highlight: selectedRow.portfolioRoi >= avgRoi,
                  },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="text-center px-3 py-2 bg-surface-50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                    <p className={`font-bold text-sm ${highlight === true ? 'text-green-600' : highlight === false ? 'text-red-500' : 'text-slate-800'}`}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Per-channel table */}
              <div className="overflow-hidden rounded-xl border border-surface-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-50 text-left">
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Channel</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">ROI</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Spend</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Revenue</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">vs Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {[...selectedRow.channels].sort((a, b) => b.roi - a.roi).map((ch, i) => {
                      const avgChRoi = rows.reduce((a, r) => {
                        const c = r.channels.find(c => c.channel === ch.channel)
                        return a + (c?.roi ?? 0)
                      }, 0) / rows.length
                      const diff = ch.roi - avgChRoi
                      return (
                        <tr key={ch.channel} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'}>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{ch.channel}</td>
                          <td className="px-4 py-2.5 font-bold text-brand-600">{fmtROI(ch.roi, currency)}</td>
                          <td className="px-4 py-2.5 text-slate-600">{fmt(ch.spend, currency)}</td>
                          <td className="px-4 py-2.5 text-slate-600">{fmt(ch.revenue, currency)}</td>
                          <td className="px-4 py-2.5">
                            <span className={`flex items-center gap-1 text-xs font-semibold ${diff > 0.1 ? 'text-green-600' : diff < -0.1 ? 'text-red-500' : 'text-slate-400'}`}>
                              {diff > 0.1 ? <TrendingUp className="w-3 h-3" /> : diff < -0.1 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                              {diff >= 0 ? '+' : '-'}{fmtROI(Math.abs(diff), currency)} vs avg
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ranked summary table */}
          <div className="card card-body">
            <h3 className="font-bold text-slate-900 mb-3">All Geos Ranked by ROI</h3>
            <div className="overflow-hidden rounded-xl border border-surface-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">#</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Geography</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Portfolio ROI</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Revenue</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Spend</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">vs Average</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {rows.map((r, i) => {
                    const deltaPct = (r.portfolioRoi / avgRoi - 1) * 100
                    const above = r.portfolioRoi >= avgRoi
                    return (
                      <tr
                        key={r.geo}
                        className={`cursor-pointer transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'} hover:bg-surface-100/60`}
                        onClick={() => setSelected(r.geo)}
                      >
                        <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-800">{r.geo}</td>
                        <td className="px-4 py-2.5 font-bold text-brand-600">{fmtROI(r.portfolioRoi, currency)}</td>
                        <td className="px-4 py-2.5 text-slate-600">{fmt(r.totalRevenue, currency)}</td>
                        <td className="px-4 py-2.5 text-slate-600">{fmt(r.totalSpend, currency)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-semibold ${above ? 'text-green-600' : 'text-red-500'}`}>
                            {fmtSignedPct(deltaPct)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modelResults && (
        <PlanningCycleSummary items={
          rows && rows.length > 1
            ? [
                `${rows[0].geo} is your highest-performing geography at ${fmtROI(rows[0].portfolioRoi, currency)} portfolio ROI — ${fmtPct((rows[0].portfolioRoi / avgRoi - 1) * 100, 0)} above average. Consider using it as a test market for new channels before rolling out nationally.`,
                `${rows[rows.length - 1].geo} is underperforming at ${fmtROI(rows[rows.length - 1].portfolioRoi, currency)}. Investigate whether this reflects market maturity, creative fatigue, or a channel mix mismatch before adjusting budget.`,
                'When comparing geos, control for market size differences. A smaller geo with strong ROI often signals an undertapped opportunity worth scaling.',
              ]
            : [
                'Run the model with a geo dataset to see geographic performance breakdowns.',
                'Geo-level analysis helps identify where to test new channels with lower risk before national rollout.',
              ]
        } />
      )}
    </div>
  )
}
