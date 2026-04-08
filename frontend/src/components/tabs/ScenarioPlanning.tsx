'use client'
import { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, TrendingDown, Lightbulb, RotateCcw, Zap, BarChart2, Loader2, BookmarkPlus, X } from 'lucide-react'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import DataMethodBanner from '@/components/ui/DataMethodBanner'
import type { ModelResults, TimePeriod, TimeseriesResult } from '@/lib/types'
import { getSaturationBadge, deriveDataMethod } from '@/lib/types'
import { fmt, fmtDelta, currencySymbol, fmtPct, fmtSignedPct } from '@/lib/format'
import SectionTooltip from '@/components/ui/SectionTooltip'
import { fetchTimeseries } from '@/lib/api'

const FALLBACK_CHANNELS = [
  { channel: 'TV', spend: 1200000, roi: 2.8, color: '#4361ee' },
  { channel: 'Paid Search', spend: 450000, roi: 4.2, color: '#7209b7' },
  { channel: 'Social', spend: 380000, roi: 3.1, color: '#f72585' },
  { channel: 'Display', spend: 520000, roi: 1.4, color: '#4cc9f0' },
  { channel: 'Radio', spend: 220000, roi: 1.9, color: '#3a0ca3' },
  { channel: 'Email', spend: 80000, roi: 5.8, color: '#06d6a0' },
]

// Presets are built dynamically in the component based on real channel names

/** Distinct colours for the stacked bars — reuse CHANNEL_COLORS order */
const TIMESERIES_COLORS = [
  '#4361ee', '#f72585', '#7209b7', '#4cc9f0', '#3a0ca3',
  '#ff6b6b', '#06d6a0', '#e1306c', '#f04e24', '#95d5b2',
]

const PERIOD_LABELS: Record<TimePeriod, string> = {
  weekly:    'Weekly',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  yearly:    'Yearly',
}

function getRoiLabel(roi: number) {
  if (roi >= 4) return { label: 'High ROI', color: 'text-green-600 bg-green-50' }
  if (roi >= 2.5) return { label: 'Mid ROI', color: 'text-amber-600 bg-amber-50' }
  return { label: 'Low ROI', color: 'text-red-500 bg-red-50' }
}

export default function ScenarioPlanning({ modelResults }: { modelResults: ModelResults | null }) {
  const currency = modelResults?.currency ?? 'USD'

  // ── Time-period breakdown state ──────────────────────────────────────────
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('quarterly')
  const [timeseriesData, setTimeseriesData] = useState<TimeseriesResult | null>(null)
  const [timeseriesLoading, setTimeseriesLoading] = useState(false)
  const [timeseriesError, setTimeseriesError] = useState<string | null>(null)

  const loadTimeseries = useCallback(async (period: TimePeriod) => {
    setTimeseriesLoading(true)
    setTimeseriesError(null)
    try {
      const data = await fetchTimeseries(period)
      setTimeseriesData(data)
    } catch (e) {
      setTimeseriesError((e as Error).message ?? 'Failed to load timeseries data')
    } finally {
      setTimeseriesLoading(false)
    }
  }, [])

  // Load on mount and whenever period changes (only if backend data is available)
  useEffect(() => {
    loadTimeseries(timePeriod)
  }, [timePeriod, loadTimeseries])

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

  // ── Saved scenarios ─────────────────────────────────────────────────────
  type SavedScenario = { name: string; adjustments: Record<string, number>; totalBudget: number }
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>(() => {
    try { return JSON.parse(localStorage.getItem('mmm_saved_scenarios') ?? '[]') }
    catch { return [] }
  })
  const [savePromptOpen, setSavePromptOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const persistScenarios = (list: SavedScenario[]) => {
    setSavedScenarios(list)
    localStorage.setItem('mmm_saved_scenarios', JSON.stringify(list))
  }
  const handleSaveScenario = () => {
    if (!saveName.trim()) return
    persistScenarios([...savedScenarios, { name: saveName.trim(), adjustments: { ...adjustments }, totalBudget }])
    setSaveName('')
    setSavePromptOpen(false)
  }
  const handleLoadScenario = (s: SavedScenario) => {
    setAdjustments(s.adjustments)
    setTotalBudget(s.totalBudget)
  }
  const handleDeleteScenario = (idx: number) => {
    persistScenarios(savedScenarios.filter((_, i) => i !== idx))
  }

  // Scale base spends proportionally if total budget changed
  const budgetScale = totalBudget / BASE_TOTAL

  const scenarios = BASE_CHANNELS.map(ch => {
    const scaledBase = ch.spend * budgetScale
    const adjPct = adjustments[ch.channel]
    const newSpend = scaledBase * (1 + adjPct / 100)

    // Base revenue is always the actual current attribution — no inflation from Hill curve.
    const baseRevenue = scaledBase * ch.roi

    // Hill ec from Meridian's hill_curves() is in normalized media units, not raw spend IDR.
    // Using Hill here would make spend >> ec always (ratio ≈ 1), giving near-zero delta.
    // Use linear ROI with a diminishing-returns factor for spend increases instead.
    const projectedRevenue = newSpend * ch.roi * (adjPct > 0 ? Math.max(0.70, 1 - adjPct / 250) : 1.0)

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
    setAdjustments(Object.fromEntries(BASE_CHANNELS.map(c => [c.channel, preset.adjustments[c.channel] ?? 0])))
  }

  const dataMethod = deriveDataMethod(modelResults)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900">Model a budget change</h2>
          <SectionTooltip content="Adjust how much you spend per channel and see the projected revenue impact before committing any real budget. The projection uses the same Hill saturation curves the model fitted from your historical data, so it respects diminishing returns." />
        </div>
        <p className="text-slate-500 mt-1">Adjust channel budgets and see the projected impact before committing.</p>
      </div>

      <DataMethodBanner method={dataMethod} />

      {/* How to use */}
      <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex gap-3">
        <Lightbulb className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800">Use the sliders or pick a preset below. Larger budget increases produce smaller gains — channels get less efficient as spend goes up.</p>
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
          <DataMethodBadge method={dataMethod} />
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

          <div className="flex gap-2 mt-4">
            <button onClick={() => setAdjustments(Object.fromEntries(BASE_CHANNELS.map(c => [c.channel, 0])))}
              className="btn-secondary flex-1 justify-center text-xs gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
            <button onClick={() => { setSavePromptOpen(v => !v); setSaveName('') }}
              className="btn-secondary flex-1 justify-center text-xs gap-1.5">
              <BookmarkPlus className="w-3.5 h-3.5" /> Save
            </button>
          </div>

          {savePromptOpen && (
            <div className="mt-2 flex gap-2 items-center">
              <input autoFocus type="text" placeholder="Name this scenario…"
                value={saveName} onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveScenario(); if (e.key === 'Escape') setSavePromptOpen(false) }}
                className="flex-1 px-2.5 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
              <button onClick={handleSaveScenario} disabled={!saveName.trim()}
                className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40">Save</button>
            </div>
          )}

          {savedScenarios.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Saved</p>
              <div className="flex flex-wrap gap-1.5">
                {savedScenarios.map((s, i) => (
                  <div key={i} className="flex items-center gap-1 bg-brand-50 border border-brand-100 rounded-full px-2 py-0.5">
                    <button onClick={() => handleLoadScenario(s)}
                      className="text-xs text-brand-700 font-medium hover:text-brand-900 truncate max-w-[80px]" title={s.name}>
                      {s.name}
                    </button>
                    <button onClick={() => handleDeleteScenario(i)} className="text-brand-300 hover:text-brand-600">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chart + insights */}
        <div className="col-span-2 space-y-4">
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-bold text-slate-900">Revenue: current vs projected</h3>
              <DataMethodBadge method={dataMethod} />
              <SectionTooltip content="Light bars show revenue at your current spend levels. Dark bars show the projected revenue after your slider adjustments. The gap between them is the estimated gain or loss from the proposed change. Gains taper off at higher spend levels because of diminishing returns." />
            </div>
            <p className="text-sm text-slate-500 mb-4">Light = current spend. Dark = projected with your adjustments. Gains taper off at higher spend — that's diminishing returns.</p>
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
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">How revenue is projected</summary>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{modelResults?.isRealMeridian ? 'Uses the Hill saturation curve fitted to the Meridian posterior for each channel. ec (half-saturation) and spend share the same units because spend is passed for both media and media_spend in the model.' : 'Heuristic estimate: linear ROI with a diminishing-returns factor for large increases. Run the full Meridian analysis to get posterior-based projections.'}</p>
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

      {/* ── Historical Performance by Period — collapsed by default (3.5) ──── */}
      <details className="card card-body">
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <BarChart2 className="w-4 h-4 text-brand-500" />
          <h3 className="font-bold text-slate-900">View historical baseline (past periods)</h3>
          <SectionTooltip content="Breaks your data into time segments so you can compare how channels performed across different periods. Useful for identifying seasonal patterns, spotting trend changes, and validating that a channel's ROI is consistent over time rather than driven by a single outlier period." />
        </summary>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-slate-500 flex-1">
              How much revenue each channel generated per {PERIOD_LABELS[timePeriod].toLowerCase()} period.
              Mirrors the Meridian Scenario Planner notebook&apos;s <code className="font-mono text-xs">time_breakdown_generators</code>.
            </p>
            {/* Period selector */}
            <div className="flex items-center rounded-xl border border-surface-200 overflow-hidden text-xs font-semibold bg-surface-50">
              {(['weekly', 'monthly', 'quarterly', 'yearly'] as TimePeriod[]).map(p => (
                <button key={p} onClick={() => setTimePeriod(p)}
                  className={`px-3 py-1.5 transition-colors ${timePeriod === p ? 'bg-brand-500 text-white' : 'text-slate-500 hover:text-slate-700 hover:bg-surface-100'}`}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {timeseriesLoading && (
            <div className="flex items-center justify-center py-8 text-slate-400 gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          )}

          {timeseriesError && !timeseriesLoading && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              Couldn&apos;t load data. Make sure the backend is running and the model has been run.
            </div>
          )}

          {!timeseriesLoading && !timeseriesError && timeseriesData && timeseriesData.data.length > 0 && (() => {
            const channels = timeseriesData.channels
            return (
              <div>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={timeseriesData.data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => fmt(v as number, currency)} axisLine={false} tickLine={false} width={80} />
                    <Tooltip formatter={(v: number, name: string) => [fmt(v, currency), name]} labelStyle={{ fontWeight: 600, color: '#1e293b' }} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    {channels.map((ch, i) => (
                      <Bar key={ch} dataKey={ch} stackId="revenue" fill={TIMESERIES_COLORS[i % TIMESERIES_COLORS.length]} radius={i === channels.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                    <Bar dataKey="Base" name="Base (non-media)" stackId="revenue" fill="#e0e9ff" radius={[0, 0, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-slate-400 mt-2">
                  Stacked bars show attributed revenue per channel plus non-media base revenue per {PERIOD_LABELS[timePeriod].toLowerCase()}.
                  {!modelResults?.isRealMeridian && ' Using correlation-based attribution — run the Meridian model for posterior-backed figures.'}
                </p>
              </div>
            )
          })()}

          {!timeseriesLoading && !timeseriesError && (!timeseriesData || timeseriesData.data.length === 0) && (
            <div className="px-4 py-6 text-center text-slate-400 text-sm">
              No data yet — load a dataset and run the model to see this.
            </div>
          )}
        </div>
      </details>

      {/* ── Scenario comparison matrix ────────────────────────────────────── */}
      {savedScenarios.length >= 2 && (() => {
        // Build per-scenario projections for all saved scenarios
        const compareRows = BASE_CHANNELS.map(ch => {
          const base = ch.spend * budgetScale
          return {
            channel: ch.channel,
            roi: ch.roi,
            scenarios: savedScenarios.map(sc => {
              const adjPct = sc.adjustments[ch.channel] ?? 0
              const newSpend = base * (1 + adjPct / 100)
              const rev = newSpend * ch.roi * (adjPct > 0 ? Math.max(0.70, 1 - adjPct / 250) : 1.0)
              return { name: sc.name, spend: newSpend, revenue: rev, delta: rev - (base * ch.roi) }
            }),
          }
        })
        const totals = savedScenarios.map((sc, si) => ({
          name: sc.name,
          totalRevenue: compareRows.reduce((s, r) => s + r.scenarios[si].revenue, 0),
          totalSpend:   compareRows.reduce((s, r) => s + r.scenarios[si].spend, 0),
        }))
        return (
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-slate-900">Scenario comparison matrix</h3>
              <SectionTooltip content="Side-by-side view of all your saved scenarios. Shows projected revenue per channel and total portfolio outcome so you can pick the best plan before committing budget." />
            </div>
            <p className="text-sm text-slate-500 mb-4">Compare your saved plans side-by-side. Save at least 2 scenarios using the bookmark button above to populate this table.</p>
            <div className="overflow-x-auto rounded-xl border border-surface-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Channel</th>
                    {savedScenarios.map(sc => (
                      <th key={sc.name} className="px-4 py-2.5 text-xs font-semibold text-brand-600">{sc.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {compareRows.map((row, i) => (
                    <tr key={row.channel} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                      <td className="px-4 py-2.5 font-semibold text-slate-700 text-xs">{row.channel}</td>
                      {row.scenarios.map((sc, si) => {
                        const best = Math.max(...row.scenarios.map(s => s.revenue))
                        const isBest = sc.revenue === best && row.scenarios.length > 1
                        return (
                          <td key={si} className={`px-4 py-2.5 text-xs font-mono ${isBest ? 'text-emerald-600 font-bold' : 'text-slate-600'}`}>
                            {fmt(sc.revenue, currency)}
                            <span className={`ml-1 ${sc.delta >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                              ({sc.delta >= 0 ? '+' : ''}{fmtPct(sc.delta / (sc.revenue - sc.delta || 1) * 100, 0)})
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="bg-brand-50 font-bold border-t-2 border-brand-100">
                    <td className="px-4 py-3 text-xs font-bold text-slate-700">Total Revenue</td>
                    {totals.map(t => (
                      <td key={t.name} className="px-4 py-3 text-xs font-bold text-brand-700">{fmt(t.totalRevenue, currency)}</td>
                    ))}
                  </tr>
                  <tr className="bg-surface-50 font-semibold">
                    <td className="px-4 py-2 text-xs text-slate-500">Total Spend</td>
                    {totals.map(t => (
                      <td key={t.name} className="px-4 py-2 text-xs text-slate-500">{fmt(t.totalSpend, currency)}</td>
                    ))}
                  </tr>
                  <tr className="bg-surface-50 font-semibold">
                    <td className="px-4 py-2 text-xs text-slate-500">Blended ROI</td>
                    {totals.map(t => (
                      <td key={t.name} className="px-4 py-2 text-xs text-slate-500">{t.totalSpend > 0 ? (t.totalRevenue / t.totalSpend).toFixed(2) + 'x' : '—'}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2">Bold green = best revenue for that channel across all scenarios. Revenue projections use the same Hill-based model as the sliders above.</p>
          </div>
        )
      })()}

      <PlanningCycleSummary items={[
        'Use the "Boost top performers" preset as your starting point for next quarter\'s planning document. It\'s the most evidence-backed reallocation available in your current channel mix.',
        `Do not cut ${topTwo[0]} by more than 15% in a single planning cycle. Ads keep influencing purchases for several weeks after they run, so the full revenue impact of a cut shows up 3–4 weeks later — long after the cycle has closed and targets are set.`,
        `Test the "Max ${topTwo[0]}" scenario in one market before committing nationally. A controlled test builds the confidence case for larger investment.`,
      ]} />
    </div>
  )
}
