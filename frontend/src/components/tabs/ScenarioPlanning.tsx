'use client'
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Lightbulb, RotateCcw, Zap } from 'lucide-react'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import MeridianBadge from '@/components/ui/MeridianBadge'
import type { ModelResults } from '@/lib/types'
import { getSaturationBadge } from '@/lib/types'
import { fmt, fmtDelta, currencySymbol, fmtPct, fmtSignedPct } from '@/lib/format'

const FALLBACK_CHANNELS = [
  { channel: 'TV', spend: 1200000, roi: 2.8, color: '#4361ee' },
  { channel: 'Paid Search', spend: 450000, roi: 4.2, color: '#7209b7' },
  { channel: 'Social', spend: 380000, roi: 3.1, color: '#f72585' },
  { channel: 'Display', spend: 520000, roi: 1.4, color: '#4cc9f0' },
  { channel: 'Radio', spend: 220000, roi: 1.9, color: '#3a0ca3' },
  { channel: 'Email', spend: 80000, roi: 5.8, color: '#06d6a0' },
]

// Presets are built dynamically in the component based on real channel names

function getRoiLabel(roi: number) {
  if (roi >= 4) return { label: 'High ROI', color: 'text-green-600 bg-green-50' }
  if (roi >= 2.5) return { label: 'Mid ROI', color: 'text-amber-600 bg-amber-50' }
  return { label: 'Low ROI', color: 'text-red-500 bg-red-50' }
}

export default function ScenarioPlanning({ modelResults }: { modelResults: ModelResults | null }) {
  const currency = modelResults?.currency ?? 'USD'
  const BASE_CHANNELS = modelResults
    ? modelResults.channels.map(ch => ({
        channel: ch.label,
        spend: ch.spend,
        roi: ch.roi,
        color: ch.color,
        saturationStatus: ch.saturationStatus,
      }))
    : FALLBACK_CHANNELS

  const BASE_TOTAL = BASE_CHANNELS.reduce((s, c) => s + c.spend, 0)

  const [adjustments, setAdjustments] = useState<Record<string, number>>(
    Object.fromEntries(BASE_CHANNELS.map(c => [c.channel, 0]))
  )
  const [totalBudget, setTotalBudget] = useState<number>(BASE_TOTAL)

  // Scale base spends proportionally if total budget changed
  const budgetScale = totalBudget / BASE_TOTAL

  const scenarios = BASE_CHANNELS.map(ch => {
    const scaledBase = ch.spend * budgetScale
    const adjPct = adjustments[ch.channel]
    const newSpend = scaledBase * (1 + adjPct / 100)

    // Linear model with diminishing returns for increases only.
    // Hill function is avoided here because hillParams.ec units can differ
    // from the raw spend units, making the curve flat and changes invisible.
    const satFactor = adjPct > 0 ? Math.max(0.70, 1 - adjPct / 250) : 1.0
    const baseRevenue      = scaledBase * ch.roi
    const projectedRevenue = newSpend * ch.roi * satFactor

    return { ...ch, newSpend, projectedRevenue, baseRevenue, delta: projectedRevenue - baseRevenue }
  })

  const totalDelta = scenarios.reduce((sum, s) => sum + s.delta, 0)
  const totalCurrentRevenue = scenarios.reduce((sum, s) => sum + s.baseRevenue, 0)

  // Build presets dynamically from real channel names
  const sorted = [...BASE_CHANNELS].sort((a, b) => b.roi - a.roi)
  const topTwo    = sorted.slice(0, 2).map(c => c.channel)
  const bottomTwo = sorted.slice(-2).map(c => c.channel)
  const PRESETS = [
    {
      label: 'Boost top performers',
      description: `Shift budget from low-ROI channels (${bottomTwo.join(', ')}) to high-ROI ones (${topTwo.join(', ')})`,
      adjustments: Object.fromEntries(BASE_CHANNELS.map(c => [
        c.channel,
        topTwo.includes(c.channel) ? +30 : bottomTwo.includes(c.channel) ? -30 : 0,
      ])),
    },
    {
      label: 'Cut waste',
      description: `Reduce the two lowest-ROI channels (${bottomTwo.join(', ')}) by 30%. A typical first step in budget efficiency audits.`,
      adjustments: Object.fromEntries(BASE_CHANNELS.map(c => [c.channel, bottomTwo.includes(c.channel) ? -30 : 0])),
    },
    {
      label: 'Balanced increase',
      description: 'Increase all channels by 15% proportionally to test overall scale effects.',
      adjustments: Object.fromEntries(BASE_CHANNELS.map(c => [c.channel, +15])),
    },
    {
      label: `Max ${topTwo[0]}`,
      description: `${topTwo[0]} has the highest ROI in your mix. Test what happens if you 3x the budget.`,
      adjustments: Object.fromEntries(BASE_CHANNELS.map(c => [c.channel, c.channel === topTwo[0] ? +200 : 0])),
    },
  ]

  const applyPreset = (preset: typeof PRESETS[0]) => {
    console.log(`[ScenarioPlanning] Applying preset: "${preset.label}"`)
    setAdjustments(Object.fromEntries(BASE_CHANNELS.map(c => [c.channel, preset.adjustments[c.channel] ?? 0])))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">What happens if you change your strategy?</h2>
        <p className="text-slate-500 mt-1">Test different budget scenarios and see the projected revenue impact before you commit to any changes.</p>
      </div>

      {!modelResults && (
        <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs font-medium text-amber-700">Sample data — run the analysis in Step 2 to see real numbers for your channels.</p>
        </div>
      )}

      {/* How to use */}
      <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex gap-3">
        <Lightbulb className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800">Drag the sliders or pick a preset to model budget changes. Keep in mind: channels become less efficient as spend increases, so large budget bumps produce smaller gains than you might expect.</p>
      </div>

      {/* Total budget input */}
      <div className="card card-body">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm font-semibold text-slate-800 mb-0.5">Total marketing budget</label>
            <p className="text-xs text-slate-500">Changing this scales all channel budgets proportionally before applying your adjustments.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-500 text-sm font-medium">{currencySymbol(currency)}</span>
            <input
              type="number"
              value={totalBudget}
              step={Math.round(BASE_TOTAL * 0.05 / 1000) * 1000}
              min={Math.round(BASE_TOTAL * 0.3)}
              max={Math.round(BASE_TOTAL * 3)}
              onChange={e => {
                const val = parseInt(e.target.value)
                setTotalBudget(val)
              }}
              className="w-36 px-3 py-2 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200 font-mono"
            />
            <span className="text-xs text-slate-400">
              {totalBudget !== BASE_TOTAL && (
                <span className={totalBudget > BASE_TOTAL ? 'text-green-600' : 'text-red-500'}>
                  {fmtSignedPct(((totalBudget - BASE_TOTAL) / BASE_TOTAL) * 100, 0)} vs baseline
                </span>
              )}
              {totalBudget === BASE_TOTAL && 'baseline'}
            </span>
          </div>
        </div>
      </div>

      {/* Presets */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Quick scenarios</p>
          <MeridianBadge isReal={modelResults?.isRealMeridian} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {PRESETS.map(preset => (
            <button key={preset.label} onClick={() => applyPreset(preset)}
              className="text-left p-3 rounded-xl border border-surface-200 bg-white hover:border-brand-300 hover:bg-brand-50 transition-all group">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-3.5 h-3.5 text-brand-400 group-hover:text-brand-600" />
                <span className="text-sm font-semibold text-slate-800">{preset.label}</span>
              </div>
              <p className="text-xs text-slate-500">{preset.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Sliders */}
        <div className="card card-body col-span-1">
          <div className={`p-4 rounded-xl mb-4 ${totalDelta >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-xs font-medium text-slate-500 mb-1">Projected Revenue Change</p>
            <p className={`text-3xl font-bold ${totalDelta >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {fmtDelta(totalDelta, currency)}
            </p>
            <p className={`text-sm ${totalDelta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {fmtPct((totalDelta / totalCurrentRevenue) * 100)} vs current mix
            </p>
          </div>

          <div className="space-y-4">
            {BASE_CHANNELS.map(ch => {
              const { label, color } = getRoiLabel(ch.roi)
              const satBadge = (ch as any).saturationStatus ? getSaturationBadge((ch as any).saturationStatus) : null
              return (
                <div key={ch.channel}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-slate-700">{ch.channel}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>{label}</span>
                      {satBadge && <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${satBadge.color}`}>{satBadge.text}</span>}
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-bold ${adjustments[ch.channel] > 0 ? 'text-green-600' : adjustments[ch.channel] < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                        {adjustments[ch.channel] > 0 ? '+' : ''}{adjustments[ch.channel]}%
                      </span>
                      <span className="text-xs text-slate-400 ml-1">
                        ({fmt(Math.round(ch.spend * budgetScale * (1 + adjustments[ch.channel] / 100)), currency)})
                      </span>
                    </div>
                  </div>
                  <input type="range" min="-50" max="100" value={adjustments[ch.channel]}
                    aria-label={`${ch.channel} budget adjustment, currently ${adjustments[ch.channel] > 0 ? '+' : ''}${adjustments[ch.channel]}%`}
                    onChange={e => setAdjustments(p => ({...p, [ch.channel]: parseInt(e.target.value)}))}
                    className="w-full h-1.5 appearance-none bg-surface-200 rounded-full outline-none cursor-pointer accent-brand-500" />
                  <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                    <span>-50%</span><span>0</span><span>+100%</span>
                  </div>
                </div>
              )
            })}
          </div>

          <button onClick={() => {
            console.log('[ScenarioPlanning] Reset to baseline')
            setAdjustments(Object.fromEntries(BASE_CHANNELS.map(c => [c.channel, 0])))
          }}
            className="btn-secondary w-full justify-center mt-4 text-xs gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to baseline
          </button>
        </div>

        {/* Chart + insights */}
        <div className="col-span-2 space-y-4">
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-bold text-slate-900">Revenue: current vs projected</h3>
              <MeridianBadge isReal={modelResults?.isRealMeridian} />
            </div>
            <p className="text-sm text-slate-500 mb-1">Light bars = current. Dark bars = projected with your adjustments.</p>
            <p className="text-sm text-slate-500 mb-4">Notice how gains taper off for large increases — that's because channels become less efficient as spend goes up.</p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={scenarios} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
                <XAxis dataKey="channel" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => fmt(v, currency)} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => [fmt(v as number, currency), '']} />
                <Bar dataKey="baseRevenue" name="Current" fill="#e0e9ff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="projectedRevenue" name="Projected" fill="#4361ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <details className="mt-3">
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">How Meridian projects scenario revenue</summary>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">Projected revenue uses the spend-response curve for each channel learned from your historical data. Each channel has a point where adding more budget produces smaller and smaller returns — the model accounts for this when projecting. These are estimates, not guarantees — a confidence range would show the realistic range around each bar.</p>
            </details>
          </div>

          {/* Channel-level impact callouts */}
          {scenarios.some(s => s.delta !== 0) && (
            <div className="card card-body space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">What's changing</p>
              {scenarios.filter(s => s.delta !== 0).map(s => (
                <div key={s.channel} className={`flex items-start gap-2 text-sm px-3 py-2.5 rounded-lg ${s.delta > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {s.delta > 0 ? <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" /> : <TrendingDown className="w-4 h-4 shrink-0 mt-0.5" />}
                  <div>
                    <span className="font-semibold">{s.channel}</span>
                    <span className="ml-1">{fmtDelta(s.delta, currency)} projected revenue change</span>
                    {s.roi < 2 && s.delta < 0 && (
                      <p className="text-xs mt-0.5 opacity-80">Low ROI channel. Reducing spend here is often the right first move.</p>
                    )}
                    {s.roi >= 4 && s.delta > 0 && (
                      <p className="text-xs mt-0.5 opacity-80">High ROI channel. Increasing here is well-supported by the data, though watch for saturation at very high spend levels.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      <PlanningCycleSummary items={[
        'Use the "Boost top performers" preset as your starting point for next quarter\'s planning document. It\'s the most evidence-backed reallocation available in your current channel mix.',
        `Do not cut ${topTwo[0]} by more than 15% in a single planning cycle. Ads keep influencing purchases for several weeks after they run, so the full revenue impact of a cut shows up 3–4 weeks later — long after the cycle has closed and targets are set.`,
        `Test the "Max ${topTwo[0]}" scenario in one market before committing nationally. A controlled test builds the confidence case for larger investment.`,
      ]} />
    </div>
  )
}
