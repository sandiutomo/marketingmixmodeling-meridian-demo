'use client'
import { useState, useMemo, useEffect } from 'react'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import DataMethodBanner from '@/components/ui/DataMethodBanner'
import WaterfallChart from '@/components/charts/WaterfallChart'
import type { ModelResults, WaterfallResult, TimePeriod } from '@/lib/types'
import { getSaturationBadge, deriveDataMethod } from '@/lib/types'
import { fmt, fmtROI, fmtPct } from '@/lib/format'
import SectionTooltip from '@/components/ui/SectionTooltip'
import { fetchWaterfall } from '@/lib/api'
import BumpChart from '@/components/charts/BumpChart'
import type { BumpDataPoint } from '@/components/charts/BumpChart'

// Deterministic noise seeded by week index — no Math.random() so values are stable across renders
function deterministicNoise(seed: number, amplitude: number): number {
  return Math.round(amplitude * (Math.sin(seed * 2.3998 + 1.5708) * 0.5 + 0.5))
}

const MOCK_WEEKLY_DATA = Array.from({ length: 52 }, (_, i) => ({
  week: `W${i + 1}`,
  weekIndex: i,
  TV: Math.round(60000 + Math.sin(i / 6) * 20000 + deterministicNoise(i, 10000)),
  'Paid Search': Math.round(35000 + Math.cos(i / 4) * 8000 + deterministicNoise(i * 3 + 1, 5000)),
  Social: Math.round(22000 + Math.sin(i / 8) * 6000 + deterministicNoise(i * 7 + 2, 4000)),
  Display: Math.round(12000 + deterministicNoise(i * 11 + 3, 3000)),
  Base: Math.round(105000 + Math.sin(i / 12) * 15000),
}))

const MOCK_CHANNELS = [
  { key: 'TV',          color: '#4361ee' },
  { key: 'Paid Search', color: '#7209b7' },
  { key: 'Social',      color: '#f72585' },
  { key: 'Display',     color: '#4cc9f0' },
  { key: 'Base',        color: '#e4e8f0' },
]

type Period = 'full' | 'q1' | 'q2' | 'q3' | 'q4'
const PERIOD_RANGES: Record<Period, [number, number]> = {
  full: [0, 51], q1: [0, 12], q2: [13, 25], q3: [26, 38], q4: [39, 51],
}

function getRoleForChannel(_label: string, roi: number, portfolioRoi: number) {
  if (roi >= portfolioRoi * 1.2) return { role: 'Demand Capture',  color: 'bg-blue-100 text-blue-700' }
  if (roi >= portfolioRoi * 0.8) return { role: 'Demand Driver',   color: 'bg-purple-100 text-purple-700' }
  return                                  { role: 'Support Channel', color: 'bg-slate-100 text-slate-600' }
}

function getChannelDescription(label: string, role: string, roi: number, portfolioRoi: number, currency: 'USD' | 'IDR' = 'USD'): string {
  if (role === 'Demand Capture') return `${label} captures people already looking to buy. Its ${fmtROI(roi, currency)} ROI is above the portfolio average (${fmtROI(portfolioRoi, currency)}), meaning it efficiently converts existing intent — but it depends on upper-funnel channels creating that demand.`
  if (role === 'Demand Driver')  return `${label} creates new purchase intent. Its ${fmtROI(roi, currency)} ROI is near the portfolio average. Coordinate ${label} flights with your demand-capture channels to convert the interest it generates.`
  return `${label} reinforces other channels through repetition and recall. Its ${fmtROI(roi, currency)} ROI is below the portfolio average, but removing it entirely can reduce overall effectiveness — check cross-channel lift before cutting.`
}

export default function ChannelContribution({ modelResults }: { modelResults: ModelResults | null }) {
  const [period, setPeriod] = useState<Period>('full')
  const [chartView, setChartView] = useState<'stacked' | 'individual'>('stacked')
  const currency = modelResults?.currency ?? 'USD'
  const dataMethod = deriveDataMethod(modelResults)
  const [waterfallPeriod, setWaterfallPeriod] = useState<TimePeriod>('quarterly')
  const [waterfall, setWaterfall] = useState<WaterfallResult | null>(null)

  useEffect(() => {
    if (!modelResults) { setWaterfall(null); return }
    fetchWaterfall(waterfallPeriod).then(setWaterfall).catch(() => setWaterfall(null))
  }, [modelResults, waterfallPeriod])

  const allWeeklyData = modelResults
    ? modelResults.weeklyData.map((d, i) => ({ ...d, weekIndex: i }))
    : MOCK_WEEKLY_DATA

  const paidChannels = modelResults
    ? modelResults.channels.map(ch => ({ key: ch.channel, color: ch.color }))
    : MOCK_CHANNELS.filter(c => c.key !== 'Base')

  // Dynamic period labels derived from actual date range
  const periodLabels: Record<Period, string> = useMemo(() => {
    if (!modelResults?.weeklyData?.length) {
      return { full: 'Full year', q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4' }
    }
    const wd = modelResults.weeklyData
    const fmt = (d: string) => d?.slice(0, 7) ?? ''  // "YYYY-MM"
    return {
      full: `${fmt(wd[0].date)} – ${fmt(wd[wd.length - 1].date)}`,
      q1:   `${fmt(wd[0].date)} – ${fmt(wd[Math.min(12, wd.length - 1)].date)}`,
      q2:   `${fmt(wd[Math.min(13, wd.length - 1)].date)} – ${fmt(wd[Math.min(25, wd.length - 1)].date)}`,
      q3:   `${fmt(wd[Math.min(26, wd.length - 1)].date)} – ${fmt(wd[Math.min(38, wd.length - 1)].date)}`,
      q4:   `${fmt(wd[Math.min(39, wd.length - 1)].date)} – ${fmt(wd[wd.length - 1].date)}`,
    }
  }, [modelResults])

  // Dynamic channel roles
  const channelRoles = useMemo(() => {
    if (!modelResults) return []
    const { channels: chs, portfolioRoi } = modelResults
    return chs.map(ch => {
      const { role, color } = getRoleForChannel(ch.label, ch.roi, portfolioRoi)
      return {
        channel:          ch.label,
        role,
        color,
        description:      getChannelDescription(ch.label, role, ch.roi, portfolioRoi, currency),
        saturationStatus: ch.saturationStatus,
      }
    })
  }, [modelResults])

  const [start, end] = PERIOD_RANGES[period]
  const chartData = allWeeklyData.filter(d => d.weekIndex >= start && d.weekIndex <= end)

  return (
    <div className="space-y-6">
      <DataMethodBanner method={dataMethod} />
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900">How much is each channel contributing?</h2>
          <SectionTooltip content="Shows the share of total revenue each channel caused, not just correlated with. The model separates media-driven revenue from organic baseline (word of mouth, repeat customers, branded search) so you can see what advertising is actually worth." />
        </div>
        <p className="text-slate-500 mt-1">Revenue attributed to each channel — based on causal impact, not just timing coincidence.</p>
      </div>

      <div className="card card-body">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900">Revenue Attribution Over Time</h3>
              <DataMethodBadge method={dataMethod} />
              <SectionTooltip content="Breaks down weekly revenue into the share each channel caused. Useful for spotting seasonal patterns, identifying which channels drove growth in specific periods, and checking whether any channel's contribution is declining over time." />
            </div>
            <p className="text-sm text-slate-500 mt-0.5">How each channel contributed to weekly revenue</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* View toggle */}
            <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-lg text-xs font-medium">
              {(['stacked', 'individual'] as const).map(v => (
                <button key={v} onClick={() => setChartView(v)}
                  className={`px-2.5 py-1 rounded-md transition-all ${chartView === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  title={v === 'stacked' ? 'Stacked area chart' : 'Individual channel lines (easier comparison)'}>
                  {v === 'stacked' ? 'Stacked' : 'Individual'}
                </button>
              ))}
            </div>
            {/* Period filter */}
            <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-lg shrink-0">
              {(Object.keys(periodLabels) as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  title={periodLabels[p]}>
                  {p === 'full' ? 'All' : p.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Active period date range */}
        <p className="text-xs text-slate-400 mb-3">{periodLabels[period]}</p>

        {chartView === 'stacked' ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-Base" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fde68a" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#fde68a" stopOpacity={0.85} />
                </linearGradient>
                {paidChannels.map(({ key, color }) => (
                  <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.90} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.75} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={period === 'full' ? 7 : 2} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => fmt(v, currency)} />
              <Tooltip formatter={(v: number, name: string) => [fmt(v, currency), name === 'Base' ? 'Organic baseline' : name]} />
              <Area type="monotone" dataKey="Base" stackId="1" stroke="#d97706" strokeWidth={1.5} fill="url(#grad-Base)" fillOpacity={1} />
              {paidChannels.map(({ key, color }) => (
                <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={color} strokeWidth={0.5} fill={`url(#grad-${key})`} fillOpacity={1} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          /* Individual channels — small multiples in 2-column grid */
          <div>
            <p className="text-xs text-slate-400 mb-3">Each channel shown on its own scale for accurate comparison. <span className="text-brand-500">Tip: stacked view can distort upper bands.</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {paidChannels.map(({ key, color }) => {
                const label = modelResults ? (modelResults.channels.find(c => c.channel === key)?.label ?? key) : key
                return (
                  <div key={key}>
                    <p className="text-xs font-semibold mb-1" style={{ color }}>{label}</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
                        <XAxis dataKey="week" tick={{ fontSize: 8, fill: '#94a3b8' }} interval={period === 'full' ? 7 : 2} />
                        <YAxis tick={{ fontSize: 8, fill: '#94a3b8' }} tickFormatter={v => fmt(v, currency)} width={52} />
                        <Tooltip formatter={(v: number) => [fmt(v, currency), label]} />
                        <Line type="monotone" dataKey={key} stroke={color} strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Legend — two clearly separated groups */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-3 h-3 rounded-sm border border-amber-400" style={{ background: 'repeating-linear-gradient(45deg, #fef3c7, #fef3c7 3px, #fbbf24 3px, #fbbf24 4px)' }} />
            <span className="text-amber-700 font-medium">Organic baseline</span>
          </div>
          <div className="w-px h-3.5 bg-slate-200" />
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Paid media</span>
          {paidChannels.map(({ key, color }) => (
            <span key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              {modelResults ? (modelResults.channels.find(c => c.channel === key)?.label ?? key) : key}
            </span>
          ))}
        </div>

        <details className="mt-4">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">How is this calculated?</summary>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">Each channel&apos;s contribution is the model&apos;s estimate of revenue it caused — sales that happened because of that spend, not sales that would have happened anyway. &quot;Base&quot; is organic revenue: brand equity, word-of-mouth, and everything outside paid media.</p>
        </details>
      </div>

      {/* Seasonality peak annotations */}
      {(() => {
        const allData = allWeeklyData
        if (allData.length < 8) return null
        const channelKeys = paidChannels.map(ch => ch.key)

        // Compute total paid media per week
        const totals = allData.map(d =>
          channelKeys.reduce((s, k) => s + ((d as Record<string, unknown>)[k] as number ?? 0), 0)
        )

        // Rolling 7-week average
        const rolling = totals.map((_, i) => {
          const w = totals.slice(Math.max(0, i - 3), Math.min(totals.length, i + 4))
          return w.reduce((s, v) => s + v, 0) / w.length
        })

        // Peaks: weeks that are ≥25% above the rolling average AND are local maxima
        const peaks = allData
          .map((d, i) => {
            const total = totals[i]
            const avg   = rolling[i]
            if (avg === 0 || total < avg * 1.25) return null
            // Local maximum check (within ±3 weeks)
            const window = totals.slice(Math.max(0, i - 3), Math.min(totals.length, i + 4))
            if (total < Math.max(...window)) return null
            // Find dominant channel
            const dominant = channelKeys.reduce((best, k) => {
              const v = (d as Record<string, unknown>)[k] as number ?? 0
              return v > ((d as Record<string, unknown>)[best] as number ?? 0) ? k : best
            }, channelKeys[0])
            const dominantLabel = modelResults
              ? (modelResults.channels.find(c => c.channel === dominant)?.label ?? dominant)
              : dominant
            const dominantColor = paidChannels.find(c => c.key === dominant)?.color ?? '#4361ee'
            const liftPct = Math.round((total / avg - 1) * 100)
            return {
              week: (d as Record<string, unknown>).week as string ?? `W${i + 1}`,
              total,
              liftPct,
              dominant: dominantLabel,
              dominantColor,
            }
          })
          .filter(Boolean)
          .slice(0, 6) as { week: string; total: number; liftPct: number; dominant: string; dominantColor: string }[]

        if (peaks.length === 0) return null

        return (
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-slate-900">Seasonality peaks detected</h3>
              <SectionTooltip content="Weeks where total media contribution was at least 25% above the rolling 7-week average. These spikes often correspond to campaign launches, promotions, or seasonal events. The dominant channel is the one that drove the most revenue in that week." />
            </div>
            <p className="text-sm text-slate-500 mb-4">Weeks where your media spend significantly over-delivered vs the rolling baseline, and which channel drove each spike.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {peaks.map(pk => (
                <div key={pk.week} className="flex items-start gap-3 p-3 rounded-xl border border-surface-200 bg-white">
                  <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: pk.dominantColor }}>
                    ↑
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">{pk.week}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      <span className="font-semibold text-emerald-600">+{pk.liftPct}%</span> vs rolling avg
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">Led by <span className="font-medium" style={{ color: pk.dominantColor }}>{pk.dominant}</span></p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3">Peaks are weeks at least 25% above a ±3-week rolling average that are also local maxima in the selected period. Useful for anchoring campaign calendars to historically high-performance windows.</p>
          </div>
        )
      })()}

      {channelRoles.length > 0 && (
        <div>
          <h3 className="font-bold text-slate-900 mb-3">What role does each channel play?</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {channelRoles.map(({ channel, role, color, description, saturationStatus }) => {
              const satBadge = saturationStatus ? getSaturationBadge(saturationStatus) : null
              return (
                <div key={channel} className="card px-4 py-3 flex items-start gap-3">
                  <div className="flex flex-col gap-1 shrink-0 mt-0.5">
                    <span className={`insight-badge ${color}`}>{role}</span>
                    {satBadge && <span className={`insight-badge ${satBadge.color}`}>{satBadge.text}</span>}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{channel}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Bump chart — channel rank over time */}
      {paidChannels.length > 1 && (() => {
        // Build quarterly rank data from allWeeklyData
        const quarters = [
          { label: 'Q1', range: [0, 12] as [number, number] },
          { label: 'Q2', range: [13, 25] as [number, number] },
          { label: 'Q3', range: [26, 38] as [number, number] },
          { label: 'Q4', range: [39, 51] as [number, number] },
        ].filter(q => q.range[1] < allWeeklyData.length)

        if (quarters.length < 2) return null

        const bumpData: BumpDataPoint[] = quarters.map(q => {
          const slice = allWeeklyData.slice(q.range[0], q.range[1] + 1)
          const totals: Record<string, number> = {}
          paidChannels.forEach(ch => {
            totals[ch.key] = slice.reduce((s, w) => s + ((w as Record<string, unknown>)[ch.key] as number ?? 0), 0)
          })
          // Rank: 1 = highest contribution
          const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
          const ranks: BumpDataPoint = { period: q.label }
          sorted.forEach(([key], i) => { ranks[key] = i + 1 })
          return ranks
        })

        const bumpChannels = paidChannels.map(ch => ({
          key: ch.key,
          label: modelResults ? (modelResults.channels.find(c => c.channel === ch.key)?.label ?? ch.key) : ch.key,
          color: ch.color,
        }))

        return (
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-bold text-slate-900 text-sm">Channel Contribution Rank Over Time</h3>
              <SectionTooltip content="Shows which channels lead or fall behind in each quarter. A channel moving from rank 3 to rank 1 over the year is growing in importance — useful for spotting seasonal dominance before budget planning." />
            </div>
            <BumpChart data={bumpData} channels={bumpChannels} />
          </div>
        )
      })()}

      {/* Waterfall — period-over-period breakdown */}
      {waterfall && (
        <div className="card card-body">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-lg">
              {(['weekly', 'monthly', 'quarterly', 'yearly'] as TimePeriod[]).map(p => (
                <button key={p} onClick={() => setWaterfallPeriod(p)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${waterfallPeriod === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <WaterfallChart data={waterfall} currency={currency} />
        </div>
      )}

      <PlanningCycleSummary items={(() => {
        if (!modelResults) return [
          'Evaluate your top channel\'s performance over a 6-week window, not week by week. Ads keep working for several weeks after they run, so single-week drops are expected and normal.',
          'Run your awareness and conversion channels in the same weeks. Awareness channels create purchase intent that conversion channels capture — but that intent fades within 2–3 weeks.',
          'Audit your lowest-contribution channel\'s creative and audience targeting before the next flight.',
        ]
        const sorted = [...modelResults.channels].sort((a, b) => b.revenue - a.revenue)
        const top    = sorted[0]
        const topPct = Math.round(top.revenue / modelResults.totalRevenue * 100)
        const bottom = sorted[sorted.length - 1]
        const botPct = Math.round(bottom.revenue / modelResults.totalRevenue * 100)
        return [
          `${top.label}'s ${fmtPct(topPct, 0)} revenue contribution justifies its budget share, but evaluate performance over a 6-week window — not week by week. Ads keep working for weeks after they run, so single-week drops are expected.`,
          'Run your awareness and conversion channels in the same weeks. Awareness channels create purchase intent that conversion channels capture — but that intent fades within 2–3 weeks.',
          `Audit ${bottom.label} creative and audience targeting before the next flight. A ${fmtPct(botPct, 0)} contribution points to execution issues — ad fatigue, audience overlap, or stale creative.`,
        ]
      })()} />
    </div>
  )
}
