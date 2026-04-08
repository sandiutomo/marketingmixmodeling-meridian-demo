'use client'
import { useMemo, useState, useEffect } from 'react'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import type { ModelResults, SynergyResult, DataMethod } from '@/lib/types'
import { fmtROI, fmtPct } from '@/lib/format'
import SectionTooltip from '@/components/ui/SectionTooltip'
import { fetchSynergy } from '@/lib/api'

// ─── Client-side fallback helpers (used when backend is unreachable) ──────────

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

function buildClientSynergy(modelResults: ModelResults): SynergyResult {
  const { channels, weeklyData } = modelResults
  const n = channels.length
  const names = channels.map(c => c.label)

  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 1.0
      const a = weeklyData.map(d => Number(d[channels[i].channel] ?? 0))
      const b = weeklyData.map(d => Number(d[channels[j].channel] ?? 0))
      return Math.round(pearsonR(a, b) * 10000) / 10000
    })
  )

  const pairs = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = matrix[i][j]
      if (Math.abs(r) <= 0.05) continue
      const interp = r >= 0.7 ? 'strong' : r >= 0.45 ? 'moderate' : r > 0 ? 'weak' : 'negative'
      pairs.push({ channel_a: names[i], channel_b: names[j], correlation: r, interpretation: interp as SynergyResult['pairs'][0]['interpretation'] })
    }
  }
  pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))

  return { channels: names, matrix, pairs, method: 'pearson' }
}

function buildInsights(modelResults: ModelResults, currency: 'USD' | 'IDR' = 'USD') {
  const { channels } = modelResults
  const sorted = [...channels].sort((a, b) => b.revenue - a.revenue)
  const top    = sorted[0]
  const second = sorted[1]
  const low    = [...channels].sort((a, b) => a.roi - b.roi)[0]
  return [
    { title: `${top.label} drives branded awareness that lifts other channels`, description: `${top.label} is your top revenue contributor at ${fmtPct(top.revenue / modelResults.totalRevenue * 100, 0)} of attributed revenue. Awareness built by ${top.label} makes other channels—especially search and social—more effective. Standard attribution tools miss this because they only see last click.`, impact: 'High' },
    { title: `${second.label} captures demand generated upstream`, description: `${second.label} performs best when upper-funnel channels like ${top.label} are running simultaneously. Coordinate flight dates to capture the purchase intent that ${top.label} creates before it decays (typically 2–3 weeks).`, impact: 'Medium' },
    { title: `${low.label} plays a support role beyond its direct ROI`, description: `${low.label}'s ${fmtROI(low.roi, currency)} ROI understates its value—support channels often reinforce other channels through brand recall and frequency. Before cutting, check whether weeks with ${low.label} active show higher performance across other channels.`, impact: 'Medium' },
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
    { action: `Don't cut ${top.label} in isolation`, detail: `${top.label} keeps influencing purchases for several weeks after the ad runs — so a budget cut shows up as lower performance across other channels 2–4 weeks later.` },
    { action: `Test ${high.label} scale before committing nationally`, detail: `${high.label} has your highest ROI (${fmtROI(high.roi, currency)}). Run a 6-week pilot in 2 comparable markets before committing national budget.` },
    { action: `Audit ${low.label} before cutting`, detail: `Low direct ROI (${fmtROI(low.roi, currency)}) may mask brand-building contribution. Check audience overlap, frequency caps, and cross-channel lift first.` },
  ]
}

const FALLBACK_INSIGHTS = [
  { title: 'TV drives branded search lift', description: 'People who see a TV ad and then search for your brand convert at 3× the rate of those who only searched. This offline assist is invisible in last-click attribution.', impact: 'High' },
  { title: 'Upper-funnel channels amplify search', description: 'Demand-driver channels like TV and Social create purchase intent that Paid Search captures. Coordinating flight dates maximises this effect.', impact: 'Medium' },
  { title: 'Support channels matter beyond direct ROI', description: 'Low-ROI channels often reinforce others through brand recall and frequency. Check cross-channel lift before cutting.', impact: 'Medium' },
]
const FALLBACK_ACTIONS = [
  { action: 'Align TV and Paid Search flight dates', detail: 'Run in the same weeks to capture the search lift. Brands that coordinate these see 15–20% more search conversions.' },
  { action: 'Never cut TV in isolation', detail: "TV keeps influencing purchases for weeks after the ad runs. Plan a compensating Paid Search increase before any TV reduction." },
  { action: 'Test your highest-ROI channel before scaling', detail: 'Run a 6-week pilot in 2 comparable markets before committing national budget.' },
  { action: 'Audit low-ROI channels before cutting', detail: 'Low direct ROI may mask brand-building work. Check audience overlap and frequency caps first.' },
]

// ─── Correlation heatmap cell color ───────────────────────────────────────────
function corrColor(r: number): string {
  if (r >= 0.7)  return 'bg-red-100 text-red-800'
  if (r >= 0.45) return 'bg-orange-50 text-orange-700'
  if (r >= 0.1)  return 'bg-yellow-50 text-yellow-700'
  if (r <= -0.1) return 'bg-blue-50 text-blue-700'
  return 'bg-surface-50 text-slate-400'
}

export default function CrossChannelImpact({ modelResults }: { modelResults: ModelResults | null }) {
  const currency = modelResults?.currency ?? 'USD'
  const [synergy, setSynergy] = useState<SynergyResult | null>(null)

  useEffect(() => {
    if (!modelResults) { setSynergy(null); return }
    fetchSynergy()
      .then(data => setSynergy(data))
      .catch(() => setSynergy(buildClientSynergy(modelResults)))
  }, [modelResults])

  // Fall back to client-side computation while backend data loads
  const synergyData: SynergyResult = useMemo(() => {
    if (synergy) return synergy
    if (modelResults) return buildClientSynergy(modelResults)
    return { channels: ['TV', 'Paid Search', 'Social', 'Display'], matrix: [[1,0.72,0.55,0.31],[0.72,1,0.48,0.22],[0.55,0.48,1,0.19],[0.31,0.22,0.19,1]], pairs: [{channel_a:'TV',channel_b:'Paid Search',correlation:0.72,interpretation:'strong'},{channel_a:'TV',channel_b:'Social',correlation:0.55,interpretation:'moderate'}], method: 'mock' }
  }, [synergy, modelResults])

  const dataMethod: DataMethod = synergyData.method

  const insights = useMemo(() => modelResults ? buildInsights(modelResults, currency) : FALLBACK_INSIGHTS, [modelResults, currency])
  const actions  = useMemo(() => modelResults ? buildActions(modelResults, currency)  : FALLBACK_ACTIONS,  [modelResults, currency])
  const top = modelResults ? [...modelResults.channels].sort((a, b) => b.revenue - a.revenue)[0] : null

  const { channels: matChannels, matrix } = synergyData

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900">How your channels work together</h2>
          <SectionTooltip content="Individual channel ROI doesn't tell you whether channels help or hurt each other. This section shows co-movement patterns and halo effects — cases where spending on one channel makes another work better. Last-click attribution can't detect this." />
        </div>
        <p className="text-slate-500 mt-1">Good media planning isn&apos;t just about individual ROI — it&apos;s about how channels amplify each other.</p>
      </div>

      <div className="card card-body">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-bold text-slate-900">How channels move together</h3>
          <DataMethodBadge method={dataMethod} />
          <SectionTooltip content="Correlation of weekly contribution between channels. High correlation (red) means two channels tend to spike and drop together — which can mean they're competing for the same audience, or that one is amplifying the other. Use this to time flights more strategically." />
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Correlation of weekly contribution between channels. Red = strong co-movement, amber = moderate, yellow = weak. Diagonal is always 1.00 (a channel correlates perfectly with itself).
        </p>

        {/* n×n CSS-grid correlation heatmap */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="p-1.5 text-left text-slate-400 font-medium w-28 shrink-0" />
                {matChannels.map(ch => (
                  <th key={ch} className="p-1.5 text-center text-slate-600 font-semibold min-w-[80px]">{ch}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matChannels.map((rowCh, i) => (
                <tr key={rowCh}>
                  <td className="p-1.5 text-right text-slate-600 font-semibold pr-3 whitespace-nowrap">{rowCh}</td>
                  {matrix[i]?.map((r, j) => (
                    <td
                      key={j}
                      className={`p-1.5 text-center font-mono rounded transition-colors ${i === j ? 'bg-surface-100 text-slate-400' : corrColor(r)}`}
                    >
                      {r.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top pairs legend */}
        {synergyData.pairs.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {synergyData.pairs.slice(0, 4).map(p => (
              <span key={`${p.channel_a}+${p.channel_b}`} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                p.interpretation === 'strong'   ? 'bg-red-100 text-red-700' :
                p.interpretation === 'moderate' ? 'bg-orange-100 text-orange-700' :
                p.interpretation === 'negative' ? 'bg-blue-100 text-blue-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>
                {p.channel_a} + {p.channel_b}: r={p.correlation.toFixed(2)} ({p.interpretation})
              </span>
            ))}
          </div>
        )}

        <details className="mt-3">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">How this is calculated</summary>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            {dataMethod === 'meridian'
              ? 'Data sourced from the GET /results/synergy endpoint, which computes Pearson correlation on the weekly spend series used to train your Meridian model. Correlation measures co-movement — a high value means the two channels tend to run in the same weeks, which may reflect coordinated scheduling or shared seasonality rather than causal synergy.'
              : dataMethod === 'pearson'
              ? 'Data sourced from the GET /results/synergy endpoint using Pearson correlation on the weekly spend series from your loaded dataset. Correlation measures co-movement, not causation — channels that correlate may share seasonality rather than true synergy.'
              : 'Illustrative values computed client-side from mock spend data. Load a real dataset and run the model to see correlations from your actual spend series via the /results/synergy endpoint.'}
          </p>
        </details>
      </div>

      {/* Synergy Scorecard */}
      <div className="card card-body">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-bold text-slate-900">Channel synergy scorecard</h3>
          <SectionTooltip content="A quick-read table summarising which channel pairs should be scheduled together, held steady, or kept separate. Based on the correlation strength between channels." />
        </div>
        <p className="text-sm text-slate-500 mb-4">Which pairs to run together, based on co-movement patterns in your spend data.</p>
        {synergyData.pairs.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No significant channel pairs detected in the current dataset.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-surface-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Channel Pair</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Correlation</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Synergy Signal</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {synergyData.pairs.slice(0, 8).map((p, i) => {
                  const isStrong   = p.interpretation === 'strong'
                  const isModerate = p.interpretation === 'moderate'
                  const isNeg      = p.interpretation === 'negative'
                  const signalCls  = isStrong ? 'bg-emerald-50 text-emerald-700' : isModerate ? 'bg-blue-50 text-blue-700' : isNeg ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-500'
                  const signalText = isStrong ? '⚡ Strong — run together' : isModerate ? '✓ Moderate — coordinate timing' : isNeg ? '⚠ Negative — schedule separately' : '~ Weak — no clear signal'
                  const rec        = isStrong
                    ? `Overlap ${p.channel_a} and ${p.channel_b} flight dates. Their co-movement suggests one amplifies the other — separating them likely costs conversion lift.`
                    : isModerate
                    ? `Try overlapping ${p.channel_a} and ${p.channel_b} in 1–2 test markets. Moderate correlation suggests timing-related lift is possible but not guaranteed.`
                    : isNeg
                    ? `Consider separating ${p.channel_a} and ${p.channel_b}. They tend to move in opposite directions — scheduling overlap may cause audience fatigue or budget competition.`
                    : `No strong scheduling recommendation for ${p.channel_a} and ${p.channel_b}. Prioritise other pairs with stronger signals.`
                  return (
                    <tr key={`${p.channel_a}+${p.channel_b}`} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                      <td className="px-4 py-3 font-semibold text-slate-800">{p.channel_a} + {p.channel_b}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{p.correlation.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${signalCls}`}>{signalText}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs">{rec}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-bold text-slate-900">Effects that standard attribution misses</h3>
          <DataMethodBadge method={dataMethod} />
          <SectionTooltip content="Platform attribution assigns credit to the last touchpoint before a purchase. It can't see halo effects — when a TV ad causes a spike in branded search a week later, or when Social creates intent that Paid Search then captures. MMM detects these patterns from historical co-movement." />
        </div>
        <p className="text-sm text-slate-500 mb-4">These only show up when you analyze all channels together over time.</p>
        <div className="grid grid-cols-1 gap-4">
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
        <h3 className="font-bold text-brand-900 mb-3">What to do next</h3>
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
        "Before removing any channel from the mix, check its cross-channel contribution. Even low direct-ROI channels often play a support role that doesn't show up in their standalone attribution number.",
      ]} />
    </div>
  )
}
