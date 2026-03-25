'use client'
import { useMemo } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import MeridianBadge from '@/components/ui/MeridianBadge'
import type { ModelResults, WeeklyDataPoint } from '@/lib/types'
import { fmtROI, fmtPct } from '@/lib/format'

function pearsonR(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let cov = 0, sa = 0, sb = 0
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb)
    sa  += (a[i] - ma) ** 2
    sb  += (b[i] - mb) ** 2
  }
  return sa > 0 && sb > 0 ? cov / Math.sqrt(sa * sb) : 0
}

function buildSynergyData(modelResults: ModelResults) {
  const { channels, weeklyData } = modelResults
  const pairs: { x: number; y: number; z: number; channels: string; lift: string; corr: number }[] = []

  for (let i = 0; i < channels.length; i++) {
    for (let j = i + 1; j < channels.length; j++) {
      const keyA = channels[i].channel
      const keyB = channels[j].channel
      const a = weeklyData.map(d => Number(d[keyA] ?? 0))
      const b = weeklyData.map(d => Number(d[keyB] ?? 0))
      const corr = pearsonR(a, b)
      if (corr < 0.05) continue  // skip uncorrelated pairs

      const spendA = (channels[i].spend / modelResults.totalSpend) * 100
      const spendB = (channels[j].spend / modelResults.totalSpend) * 100
      const strength = corr >= 0.7 ? 'Strong pairing' : corr >= 0.45 ? 'Moderate pairing' : 'Weak pairing'
      const absImpact = Math.round((channels[i].revenue + channels[j].revenue) * corr * 0.1)

      pairs.push({
        x: Math.round(spendA),
        y: Math.round(spendB),
        z: Math.max(200, absImpact / 1000),
        channels: `${channels[i].label} + ${channels[j].label}`,
        lift: strength,
        corr,
      })
    }
  }

  return pairs.sort((a, b) => b.corr - a.corr).slice(0, 6)
}

function buildInsights(modelResults: ModelResults, currency: 'USD' | 'IDR' = 'USD') {
  const { channels } = modelResults
  const sorted = [...channels].sort((a, b) => b.revenue - a.revenue)
  const top    = sorted[0]
  const second = sorted[1]
  const low    = [...channels].sort((a, b) => a.roi - b.roi)[0]

  return [
    {
      title: `${top.label} drives branded awareness that lifts other channels`,
      description: `${top.label} is your top revenue contributor at ${fmtPct(top.revenue / modelResults.totalRevenue * 100, 0)} of attributed revenue. Awareness built by ${top.label} makes other channels—especially search and social—more effective. Standard attribution tools miss this because they only see last click.`,
      impact: 'High',
    },
    {
      title: `${second.label} captures demand generated upstream`,
      description: `${second.label} performs best when upper-funnel channels like ${top.label} are running simultaneously. Coordinate flight dates to capture the purchase intent that ${top.label} creates before it decays (typically 2–3 weeks).`,
      impact: 'Medium',
    },
    {
      title: `${low.label} plays a support role beyond its direct ROI`,
      description: `${low.label}'s ${fmtROI(low.roi, currency)} ROI understates its value—support channels often reinforce other channels through brand recall and frequency. Before cutting, check whether weeks with ${low.label} active show higher performance across other channels.`,
      impact: 'Medium',
    },
  ]
}

function buildActions(modelResults: ModelResults, currency: 'USD' | 'IDR' = 'USD') {
  const sorted = [...modelResults.channels].sort((a, b) => b.revenue - a.revenue)
  const top  = sorted[0]
  const top2 = sorted[1]
  const low  = [...modelResults.channels].sort((a, b) => a.roi - b.roi)[0]
  const high = [...modelResults.channels].sort((a, b) => b.roi - a.roi)[0]

  return [
    { action: `Align ${top.label} and ${top2.label} flight dates`, detail: `Running both in the same weeks captures compounding lift. Brands that coordinate these channels typically see 15–20% more conversions from ${top2.label}.` },
    { action: `Don't cut ${top.label} in isolation`, detail: `${top.label} keeps influencing purchases for several weeks after the ad runs — so a budget cut shows up as lower performance across other channels 2–4 weeks later. Plan a compensating ${top2.label} increase before any ${top.label} reduction.` },
    { action: `Test ${high.label} scale before committing nationally`, detail: `${high.label} has your highest ROI (${fmtROI(high.roi, currency)}). Run a 6-week pilot in 2 comparable markets before committing national budget.` },
    { action: `Audit ${low.label} before cutting`, detail: `Low direct ROI (${fmtROI(low.roi, currency)}) may mask brand-building contribution. Check audience overlap, frequency caps, and cross-channel lift first.` },
  ]
}

const FALLBACK_SYNERGY = [
  { x: 45, y: 72, z: 800, channels: 'TV + Paid Search', lift: 'Strong pairing' },
  { x: 38, y: 65, z: 600, channels: 'TV + Social',      lift: 'Moderate pairing' },
  { x: 22, y: 38, z: 400, channels: 'Display + Social', lift: 'Weak pairing'  },
]
const FALLBACK_INSIGHTS = [
  { title: 'TV drives branded search lift', description: 'People who see a TV ad and then search for your brand convert at 3× the rate of those who only searched. This offline assist is invisible in last-click attribution.', impact: 'High' },
  { title: 'Upper-funnel channels amplify search', description: 'Demand-driver channels like TV and Social create purchase intent that Paid Search captures. Coordinating flight dates maximises this effect.', impact: 'Medium' },
  { title: 'Support channels matter beyond direct ROI', description: 'Low-ROI channels often reinforce others through brand recall and frequency. Check cross-channel lift before cutting.', impact: 'Medium' },
]
const FALLBACK_ACTIONS = [
  { action: 'Align TV and Paid Search flight dates', detail: 'Run in the same weeks to capture the search lift. Brands that coordinate these see 15–20% more search conversions.' },
  { action: 'Never cut TV in isolation', detail: "TV keeps influencing purchases for weeks after the ad runs. Cuts show up as lower search and direct traffic 2–4 weeks later. Plan a compensating Paid Search increase." },
  { action: 'Test your highest-ROI channel before scaling', detail: 'Run a 6-week pilot in 2 comparable markets before committing national budget.' },
  { action: 'Audit low-ROI channels before cutting', detail: 'Low direct ROI may mask brand-building work. Check audience overlap and frequency caps first.' },
]

export default function CrossChannelImpact({ modelResults }: { modelResults: ModelResults | null }) {
  const currency    = modelResults?.currency ?? 'USD'
  const synergyData = useMemo(() => modelResults ? buildSynergyData(modelResults) : FALLBACK_SYNERGY, [modelResults])
  const insights    = useMemo(() => modelResults ? buildInsights(modelResults, currency)    : FALLBACK_INSIGHTS, [modelResults, currency])
  const actions     = useMemo(() => modelResults ? buildActions(modelResults, currency)     : FALLBACK_ACTIONS,  [modelResults, currency])

  const top = modelResults
    ? [...modelResults.channels].sort((a, b) => b.revenue - a.revenue)[0]
    : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">How your channels work together</h2>
        <p className="text-slate-500 mt-1">The best media plans aren't just about individual channel ROI — it's about how channels amplify each other.</p>
      </div>

      {!modelResults && (
        <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs font-medium text-amber-700">Sample data — run the analysis in Step 2 to see real patterns from your channels.</p>
        </div>
      )}

      <div className="card card-body">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-900">Channel Pairing Map</h3>
          <MeridianBadge isReal={modelResults?.isRealMeridian} />
        </div>
        <p className="text-sm text-slate-500 mt-0.5 mb-4">
          {modelResults
            ? 'Each bubble shows a channel pair that tends to move together in your data — weeks when one performs well, the other tends to also. Bigger bubbles = larger combined revenue. This is a signal worth coordinating on, not a guarantee.'
            : 'Shows which channel pairs tend to perform well in the same weeks. Run the analysis to see real values from your data.'}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
            <XAxis type="number" dataKey="x" name="Channel A spend %" tick={{ fontSize: 11, fill: '#94a3b8' }} unit="%" label={{ value: 'Channel A spend share', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#94a3b8' }} />
            <YAxis type="number" dataKey="y" name="Channel B spend %" tick={{ fontSize: 11, fill: '#94a3b8' }} unit="%" />
            <ZAxis type="number" dataKey="z" range={[60, 400]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
              if (payload?.length) {
                const d = payload[0].payload
                return (
                  <div className="bg-white border border-surface-200 rounded-xl p-3 shadow-lg text-sm">
                    <p className="font-semibold text-slate-900">{d.channels}</p>
                    <p className="text-green-600 font-bold">{d.lift}</p>
                  </div>
                )
              }
              return null
            }} />
            <Scatter data={synergyData} fill="#4361ee" fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
        <details className="mt-3">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">How this is calculated</summary>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">Pairing strength is based on how closely correlated each pair's weekly revenue is in your data. A strong pairing means both channels tend to have good and bad weeks at the same time — which suggests they amplify each other. This is not a precise lift measurement; for that, Meridian supports full interaction modelling in production runs.</p>
        </details>
      </div>

      <div>
        <h3 className="font-bold text-slate-900 mb-1">Cross-channel effects you can't see in standard attribution</h3>
        <p className="text-sm text-slate-500 mb-4">These effects only become visible when you look at all channels together over time — not channel-by-channel in your attribution tool.</p>
        <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
          {insights.map(({ title, description, impact }) => (
            <div key={title} className="card px-5 py-4">
              <div className="flex items-center gap-3 mb-2">
                <h4 className="font-semibold text-slate-900 text-sm">{title}</h4>
                <span className={`insight-badge shrink-0 ${impact === 'High' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{impact} impact</span>
              </div>
              <p className="text-sm text-slate-500">{description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card card-body bg-brand-50 border-brand-100">
        <h3 className="font-bold text-brand-900 mb-3">Recommended next actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {actions.map((rec, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm text-brand-700">
              <span className="w-5 h-5 rounded-full bg-brand-200 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
              <div>
                <p className="font-semibold text-brand-900 mb-0.5">{rec.action}</p>
                <p className="text-xs text-brand-600 leading-relaxed">{rec.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <PlanningCycleSummary items={[
        top ? `Build flight calendars that coordinate ${top.label} and your next highest-revenue channel in the same weeks. The synergy lift is large enough to materially change your quarterly revenue forecast.` : 'Build flight calendars that coordinate your top two channels in the same weeks to capture compounding synergy lift.',
        'Never evaluate channels in isolation before a budget cut. A reduction in one channel can suppress performance in others for 3–4 weeks — always model cross-channel consequences before finalising cuts.',
        'Before removing any channel from the mix, check its cross-channel contribution. Even low direct-ROI channels often play a support role that doesn\'t show up in their standalone attribution number.',
      ]} />
    </div>
  )
}
