'use client'
import { useState, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import MeridianBadge from '@/components/ui/MeridianBadge'
import type { ModelResults } from '@/lib/types'
import { getSaturationBadge } from '@/lib/types'
import { fmt, fmtROI, fmtPct } from '@/lib/format'

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
  const currency = modelResults?.currency ?? 'USD'

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
      <div>
        <h2 className="text-2xl font-bold text-slate-900">What is each channel actually contributing?</h2>
        <p className="text-slate-500 mt-1">See exactly how much revenue each channel is driving, based on real impact rather than coincidence of timing.</p>
      </div>

      {!modelResults && (
        <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs font-medium text-amber-700">Sample data — run the analysis in Step 2 to see real numbers for your channels.</p>
        </div>
      )}

      <div className="card card-body">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900">Revenue Attribution Over Time</h3>
              <MeridianBadge isReal={modelResults?.isRealMeridian} />
            </div>
            <p className="text-sm text-slate-500 mt-0.5">How each channel contributed to weekly revenue</p>
          </div>
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
        {/* Active period date range */}
        <p className="text-xs text-slate-400 mb-3">{periodLabels[period]}</p>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
            <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={period === 'full' ? 7 : 2} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => fmt(v, currency)} />
            <Tooltip formatter={(v: number, name: string) => [fmt(v, currency), name === 'Base' ? 'Organic baseline' : name]} />
            {/* Base first = bottom of stack, solid amber to immediately distinguish organic from paid */}
            <Area type="monotone" dataKey="Base" stackId="1" stroke="#d97706" strokeWidth={1.5} fill="#fde68a" fillOpacity={0.9} />
            {paidChannels.map(({ key, color }) => (
              <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={color} fill={color} fillOpacity={0.75} />
            ))}
          </AreaChart>
        </ResponsiveContainer>

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
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">How was this calculated?</summary>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">Each channel's weekly contribution is Meridian's estimate of revenue caused by that channel's spend — sales that happened <em>because</em> of that spending, not sales that would have occurred anyway. "Base" represents organic revenue: brand reputation, word-of-mouth, and everything outside your paid media.</p>
        </details>
      </div>

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
