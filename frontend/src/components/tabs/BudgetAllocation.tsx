'use client'
import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Settings2, Target } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import SectionTooltip from '@/components/ui/SectionTooltip'
import ROIBarChart from '@/components/charts/ROIBarChart'
import CodeExecutionButton from '@/components/model/CodeExecutionButton'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import type { ModelResults, ChannelResult, HillChannelParams, ChannelConstraint, SaturationResult } from '@/lib/types'
import { getSaturationBadge, deriveDataMethod } from '@/lib/types'
import SaturationHeatmap from '@/components/charts/SaturationHeatmap'
import { fetchSaturation } from '@/lib/api'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import DataMethodBanner from '@/components/ui/DataMethodBanner'
import { fmt, fmtDelta, fmtROI, fmtSignedPct } from '@/lib/format'
import { runOptimizationWithConstraints } from '@/lib/api'
import InsightCodeCard from '@/components/ui/InsightCodeCard'

const MOCK_ROI_DATA = [
  { channel: 'Paid Search', roi: 4.2, spend: 450000, revenue: 1890000, color: '#7209b7', mroi: 2.73, saturationStatus: 'efficient' as const },
  { channel: 'Social',      roi: 3.1, spend: 380000, revenue: 1178000, color: '#f72585', mroi: 2.02, saturationStatus: 'efficient' as const },
  { channel: 'TV',          roi: 2.8, spend: 1200000, revenue: 3360000, color: '#4361ee', mroi: 1.40, saturationStatus: 'saturated' as const },
  { channel: 'Email',       roi: 5.8, spend: 80000,   revenue: 464000,  color: '#06d6a0', mroi: 3.77, saturationStatus: 'efficient' as const },
  { channel: 'Display',     roi: 1.4, spend: 520000,  revenue: 728000,  color: '#4cc9f0', mroi: 0.70, saturationStatus: 'saturated' as const },
  { channel: 'Radio',       roi: 1.9, spend: 220000,  revenue: 418000,  color: '#3a0ca3', mroi: 1.52, saturationStatus: 'room_to_grow' as const },
]

type BudgetMode = 'fixed' | 'target_roi' | 'target_mroi'

function buildOptCode(totalSpend: number, mode: BudgetMode = 'fixed', targetValue = 3.0) {
  if (mode === 'target_roi') {
    return `# google-meridian 1.5.3 · Python 3.13
from meridian.analysis.optimizer import BudgetOptimizer

opt = BudgetOptimizer(meridian=model)

# Target ROI mode: find the budget required to reach a specific portfolio ROI
result = opt.optimize(
    fixed_budget=False,
    target_roi=${targetValue.toFixed(1)},            # desired portfolio ROI
    spend_constraint_lower=0.05,
    spend_constraint_upper=0.50,
)

print(f"Budget needed for {targetValue.toFixed(1)}x ROI: {result.optimal_budget:,.0f}")
opt_spend = result.optimized_data["spend"]
for ch in opt_spend.channel.values:
    print(f"  {ch}: {float(opt_spend.sel(channel=ch)):,.0f}")
`
  }
  if (mode === 'target_mroi') {
    return `# google-meridian 1.5.3 · Python 3.13
from meridian.analysis.optimizer import BudgetOptimizer

opt = BudgetOptimizer(meridian=model)

# Target mROI mode: spend until marginal returns fall to a floor value
result = opt.optimize(
    fixed_budget=False,
    target_mroi=${targetValue.toFixed(1)},           # stop spending when last $1 returns this much
    spend_constraint_lower=0.05,
    spend_constraint_upper=0.50,
)

print(f"Budget where marginal ROI = {targetValue.toFixed(1)}x: {result.optimal_budget:,.0f}")
opt_spend = result.optimized_data["spend"]
for ch in opt_spend.channel.values:
    print(f"  {ch}: {float(opt_spend.sel(channel=ch)):,.0f}")
`
  }
  return `# google-meridian 1.5.3 · Python 3.13
from meridian.analysis.optimizer import BudgetOptimizer

opt = BudgetOptimizer(meridian=model)  # meridian= not model=

result = opt.optimize(
    budget=${totalSpend.toLocaleString('en-US').replace(/,/g, '_')},
    fixed_budget=True,
    spend_constraint_lower=0.05,   # min 5% of budget per channel
    spend_constraint_upper=0.50,   # max 50% of budget per channel
)

# Optimal spend per channel
opt_spend = result.optimized_data["spend"]
for ch in opt_spend.channel.values:
    print(f"{ch}: {float(opt_spend.sel(channel=ch)):,.0f}")
`
}

// Hill saturation curve: response(spend) = maxResponse × spend^slope / (ec^slope + spend^slope)
// This is the same function Meridian fits per channel in its posterior
function hillResponse(spend: number, ec: number, slope: number, maxResponse: number): number {
  if (spend <= 0 || maxResponse <= 0 || ec <= 0) return 0
  const s = Math.pow(spend, slope)
  return maxResponse * s / (Math.pow(ec, slope) + s)
}

// Hill curve derivative — marginal return at a given spend level
// This is what Meridian's BudgetOptimizer uses to decide where the next dollar goes
function hillMarginalReturn(spend: number, ec: number, slope: number, maxResponse: number): number {
  if (spend <= 0 || ec <= 0 || maxResponse <= 0) return 0
  const ecS = Math.pow(ec, slope)
  const xS  = Math.pow(spend, slope)
  return maxResponse * slope * ecS * Math.pow(spend, slope - 1) / Math.pow(ecS + xS, 2)
}

function computeOptimizedAllocation(
  channels: ChannelResult[],
  totalSpend: number,
  hillParams?: HillChannelParams[],
) {
  const floorPerCh = totalSpend * 0.05        // min 5% of total budget per channel (Meridian spend_constraint_lower)
  const ceiling    = totalSpend * 0.50        // max 50% of total budget per channel (Meridian spend_constraint_upper)

  // Build Hill-curve scale factors so revenue projections are calibrated to actual data
  const hills = channels.map(ch => {
    const h = hillParams?.find(p => p.channel_key === ch.channel)
    if (h && h.ec != null && h.slope != null && h.maxResponse != null && h.ec > 0 && h.maxResponse > 0) {
      const { ec, slope, maxResponse } = h
      const curveNow = hillResponse(ch.spend, ec, slope, maxResponse)
      return { ec, slope, maxResponse, scale: curveNow > 0 ? ch.revenue / curveNow : 1 }
    }
    return null
  })

  // Iterative gradient equalization — mirrors what scipy.optimize.minimize does in Meridian:
  // Repeatedly move a small amount of budget from the lowest-mROI channel to the highest-mROI
  // channel until marginal returns are equalized. This converges to the true optimum.
  const spends = channels.map(ch => ch.spend)
  const STEP = totalSpend * 0.001  // move 0.1% of budget per iteration
  const ITERATIONS = 2000

  // Must multiply by scale to get TRUE marginal revenue (not raw Hill curve units)
  const getMROI = (i: number, s: number) => {
    const h = hills[i]
    if (h) return h.scale * hillMarginalReturn(s, h.ec, h.slope, h.maxResponse)
    return Math.max(0.01, channels[i].mroi ?? channels[i].roi) / Math.max(s, 1) * channels[i].spend
  }

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const mrois  = spends.map((s, i) => getMROI(i, s))
    const sorted = mrois.map((m, i) => ({ m, i })).sort((a, b) => a.m - b.m)
    const gap = sorted[sorted.length - 1].m - sorted[0].m
    if (gap / Math.max(sorted[sorted.length - 1].m, 1e-10) < 0.001) break  // <0.1% relative gap — converged

    // Find the best unconstrained pair: lowest-mROI channel that can give, highest that can receive
    let moved = false
    for (let li = 0; li < sorted.length && !moved; li++) {
      for (let hi = sorted.length - 1; hi > li && !moved; hi--) {
        const lo = sorted[li].i, h = sorted[hi].i
        const move = Math.min(STEP, spends[lo] - floorPerCh, ceiling - spends[h])
        if (move > 0) { spends[lo] -= move; spends[h] += move; moved = true }
      }
    }
    if (!moved) break  // all pairs constrained — truly stuck
  }

  const result = channels.map((ch, i) => {
    const optSpend = Math.max(floorPerCh, Math.min(ceiling, spends[i]))
    const h = hills[i]
    const optRevenue = h
      ? hillResponse(optSpend, h.ec, h.slope, h.maxResponse) * h.scale
      : optSpend * ch.roi * Math.max(0.75, 1 - Math.max(0, optSpend - ch.spend) / Math.max(ch.spend, 1) * 0.3)

    return {
      ...ch,
      optimalSpend: optSpend,
      optimalRevenue: optRevenue,
      spendChange: optSpend - ch.spend,
      spendChangePct: ch.spend > 0 ? ((optSpend - ch.spend) / ch.spend) * 100 : 0,
    }
  })

  // Safety: if optimizer couldn't beat current allocation, return current (already optimal)
  const currentTotalRev  = channels.reduce((s, c) => s + c.revenue, 0)
  const optimizedTotalRev = result.reduce((s, c) => s + c.optimalRevenue, 0)
  if (optimizedTotalRev < currentTotalRev) {
    return channels.map(ch => ({
      ...ch,
      optimalSpend: ch.spend,
      optimalRevenue: ch.revenue,
      spendChange: 0,
      spendChangePct: 0,
    }))
  }

  return result
}

/** Validate per-channel constraints: min < max, both in [0,1]. */
function validateConstraint(c: ChannelConstraint): string | null {
  if (c.min_ratio < 0 || c.min_ratio > 1) return 'Min must be between 0 and 100%'
  if (c.max_ratio < 0 || c.max_ratio > 1) return 'Max must be between 0 and 100%'
  if (c.min_ratio >= c.max_ratio) return 'Min% must be less than Max%'
  return null
}

export default function BudgetAllocation({ modelResults }: { modelResults: ModelResults | null }) {
  const [optimized, setOptimized] = useState<ReturnType<typeof computeOptimizedAllocation> | null>(null)
  const [isRealMeridian, setIsRealMeridian] = useState(false)
  const [showConstraints, setShowConstraints] = useState(false)
  const [useOptimalFrequency, setUseOptimalFrequency] = useState(false)
  const [maxFrequency, setMaxFrequency] = useState(10)
  // channel display name → ChannelConstraint
  const [channelConstraints, setChannelConstraints] = useState<Record<string, ChannelConstraint>>({})
  const [constraintErrors, setConstraintErrors] = useState<Record<string, string>>({})
  const [saturation, setSaturation] = useState<SaturationResult | null>(null)
  const [showSaturation, setShowSaturation] = useState(false)
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('fixed')
  const [targetValue, setTargetValue] = useState(3.0)

  useEffect(() => {
    if (!modelResults) { setSaturation(null); return }
    fetchSaturation().then(setSaturation).catch(() => setSaturation(null))
  }, [modelResults])

  const roiData = modelResults
    ? modelResults.channels.map(ch => ({ channel: ch.label, roi: ch.roi, spend: ch.spend, revenue: ch.revenue, color: ch.color, saturationStatus: ch.saturationStatus, roi_ci_lower: ch.roi_ci_lower, roi_ci_upper: ch.roi_ci_upper, confidence: ch.confidence }))
    : MOCK_ROI_DATA

  const portfolioRoi = modelResults ? modelResults.portfolioRoi : 3.12
  const highestRoiChannel = roiData.reduce((best, ch) => ch.roi > best.roi ? ch : best, roiData[0])
  const lowestRoiChannel  = roiData.reduce((worst, ch) => ch.roi < worst.roi ? ch : worst, roiData[0])
  const optimizationPotential = modelResults
    ? modelResults.channels
        .filter(ch => ch.roi > modelResults.portfolioRoi * 1.2)
        .reduce((sum, ch) => sum + ch.revenue * 0.15, 0)
    : 420000

  const currency   = modelResults?.currency ?? 'USD'
  const totalSpend = modelResults?.totalSpend ?? MOCK_ROI_DATA.reduce((a, c) => a + c.spend, 0)

  const optText = (() => {
    const fromCh = lowestRoiChannel
    const toCh   = highestRoiChannel
    return {
      from:    fromCh.channel,
      to:      toCh.channel,
      fromRoi: fromCh.roi,
      toRoi:   toCh.roi,
    }
  })()

  const dataMethod = deriveDataMethod(modelResults)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900">Where should your budget go?</h2>
          <SectionTooltip content="Uses the same total spend you're already committing, then finds a better split across channels. The goal is to shift dollars away from saturated or low-ROI channels toward channels with more room to grow." />
        </div>
        <p className="text-slate-500 mt-1">See which channels create the most impact per dollar, and get a recommended allocation based on your data.</p>
      </div>

      <DataMethodBanner method={dataMethod} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: 'Total Portfolio ROI', value: fmtROI(portfolioRoi, currency), sub: currency === 'IDR' ? 'per Rp 1,000 spent' : 'per $1 spent', color: 'text-brand-600',
            calc: 'Total media-driven revenue ÷ total media spend across all channels and regions. This is a blended average; individual channels vary significantly above and below this figure.',
          },
          {
            label: 'Highest ROI Channel', value: highestRoiChannel.channel, sub: `${fmtROI(highestRoiChannel.roi, currency)} per ${currency === 'IDR' ? 'Rp 1,000' : '$1'}`, color: 'text-green-600',
            calc: `${highestRoiChannel.channel}'s ROI is calculated as incremental revenue attributed to its spend ÷ total spend. It is high partly because of strong correlation between spend and revenue in the data.`,
          },
          {
            label: 'Optimization Potential',
            value: `+${fmt(optimizationPotential, currency)}`,
            sub: 'additional revenue possible', color: 'text-purple-600',
            calc: 'Estimated extra revenue from shifting the same total budget away from your lowest-ROI channels toward your highest-ROI ones. No new spend required — just a different split.',
          },
        ].map(({ label, value, sub, color, calc }) => (
          <div key={label} className="card card-body text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <p className="text-xs text-slate-500 font-medium">{label}</p>
              <SectionTooltip content={calc} />
            </div>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ROI by Channel</p>
          <SectionTooltip content="Each bar is the return on investment for that channel: how much revenue it generated per dollar spent, based on Meridian's Bayesian attribution. Channels above the dashed line beat the portfolio average. Use this to see at a glance where budget is working and where it is not. Click Optimize below to get the model's recommended reallocation." />
        </div>
        <div className="card card-body">
        {(() => {
          const investMore = roiData.filter(ch => ch.roi > portfolioRoi * 1.15 && ch.saturationStatus !== 'saturated')
          const review     = roiData.filter(ch => ch.roi < portfolioRoi * 0.85 || ch.saturationStatus === 'saturated')
          return (investMore.length > 0 || review.length > 0) ? (
            <div className="flex gap-3 flex-wrap mb-4">
              {investMore.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                  <span className="text-xs font-medium text-green-700">Scale up:</span>
                  <span className="text-xs text-green-600">{investMore.map(c => c.channel).join(', ')}</span>
                </div>
              )}
              {review.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-xs font-medium text-amber-700">Review:</span>
                  <span className="text-xs text-amber-600">{review.map(c => c.channel).join(', ')}</span>
                </div>
              )}
            </div>
          ) : null
        })()}
        <ROIBarChart data={roiData} portfolioRoi={portfolioRoi} currency={currency} dataMethod={dataMethod} />
        <div className="mt-4 p-4 bg-brand-50 border border-brand-100 rounded-xl">
          <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-1.5">What this means for your budget</p>
          <p className="text-sm text-slate-700 leading-relaxed font-medium">{highestRoiChannel.channel} returns {fmtROI(highestRoiChannel.roi, currency)} for every {currency === 'IDR' ? 'Rp 1,000' : '$1'} spent, the strongest in your mix.<br />
           {lowestRoiChannel.channel} returns {fmtROI(lowestRoiChannel.roi, currency)}, below the portfolio average of {fmtROI(portfolioRoi, currency)}.<br />
            Any channel significantly below the average is worth a closer look at targeting, creative, or audience overlap before the next planning cycle.</p>
        </div>
        {/* Credible interval table — surfaced here so budget decisions have reliability context */}
        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">ROI Reliability (90% credible intervals)</p>
          <p className="text-xs text-slate-400 mb-3">A tight range means the data strongly supports this number. A wide range means more spend history is needed before making large shifts.</p>
          <div className="overflow-hidden rounded-xl border border-surface-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-slate-500">Channel</th>
                  <th className="px-4 py-2 text-xs font-semibold text-slate-500">ROI</th>
                  <th className="px-4 py-2 text-xs font-semibold text-slate-500">90% Range</th>
                  <th className="px-4 py-2 text-xs font-semibold text-slate-500">Reliability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {[...roiData].sort((a, b) => b.roi - a.roi).map((ch, i) => {
                  const conf = (ch as any).confidence ?? (((ch as any).roi_ci_upper - (ch as any).roi_ci_lower) / ch.roi < 0.4 ? 'High' : ((ch as any).roi_ci_upper - (ch as any).roi_ci_lower) / ch.roi < 0.8 ? 'Medium' : 'Low')
                  const confColor = conf === 'High' ? 'text-green-600 bg-green-50' : conf === 'Medium' ? 'text-amber-600 bg-amber-50' : 'text-red-500 bg-red-50'
                  const lo = (ch as any).roi_ci_lower
                  const hi = (ch as any).roi_ci_upper
                  return (
                    <tr key={ch.channel} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{ch.channel}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">{fmtROI(ch.roi, currency)}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">
                        {lo != null && hi != null ? `${fmtROI(lo, currency)} – ${fmtROI(hi, currency)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${confColor}`}>{conf}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-100 border-t-2 border-surface-200">
                  <td className="px-4 py-2.5 text-xs font-bold text-slate-600">Portfolio ROI</td>
                  <td className="px-4 py-2.5 font-mono font-bold text-brand-600">{fmtROI(portfolioRoi, currency)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 italic" colSpan={2}>
                    Spend-weighted average — not a simple average of channel ROIs.{' '}
                    Total attributed revenue ÷ total spend.{' '}
                    High-spend channels (e.g. TV) pull this figure toward their ROI.
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="mt-2">
          <InsightCodeCard
            title="How ROI is calculated"
            description="Meridian fits a Bayesian model to separate the revenue each channel genuinely caused from revenue that would have happened anyway (baseline, seasonality). Each ROI figure comes with a credible interval — a wide range means the model needs more data; a tight range means you can act on it."
            code={`from meridian.analysis.analyzer import Analyzer

# analyzer wraps the fitted Meridian model object
analyzer = Analyzer(mmm)

# summary_metrics() returns an xarray Dataset with dimensions:
#   distribution (prior | posterior), channel, metric (mean | ci_lo | ci_hi | ...)
summary = analyzer.summary_metrics(confidence_level=0.80)

roi = summary['roi'].sel(distribution='posterior')

for ch in roi.channel.values:
    if ch == 'All Paid Channels':
        continue
    mean = float(roi.sel(channel=ch, metric='mean'))
    lo   = float(roi.sel(channel=ch, metric='ci_lo'))
    hi   = float(roi.sel(channel=ch, metric='ci_hi'))
    print(f"{ch}: ROI = {mean:.2f}  [80% CI: {lo:.2f} – {hi:.2f}]")

# Example output:
# tv:          ROI = 2.41  [80% CI: 1.87 – 2.98]
# social:      ROI = 3.75  [80% CI: 3.10 – 4.42]
# search:      ROI = 5.12  [80% CI: 4.55 – 5.71]
# ooh:         ROI = 1.63  [80% CI: 1.20 – 2.08]
# ecommerce:   ROI = 4.88  [80% CI: 4.21 – 5.56]`}
          />
        </div>
        </div>
      </div>

      <div className="card card-body">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-bold text-slate-900">Optimize Your Budget Split</h3>
          <SectionTooltip content="Instead of guessing where to move budget, this gives you a data-backed recommendation. You'll see exactly which channels are under- or over-funded relative to what they actually return." />
        </div>
        <p className="text-sm text-slate-500 mb-4">Find the best way to spread your total budget across channels to get the most revenue out of what you're already spending.</p>

        {/* ── Advanced Constraints Panel ───────────────────────────────────── */}
        <div className="mb-4 border border-slate-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowConstraints(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-700 hover:bg-slate-800 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-slate-300" />
              <span className="text-sm font-semibold text-slate-100">Advanced constraints</span>
              {Object.keys(channelConstraints).length > 0 && (
                <span className="text-xs bg-brand-400/20 text-brand-200 px-2 py-0.5 rounded-full font-medium">
                  {Object.keys(channelConstraints).length} active
                </span>
              )}
            </div>
            {showConstraints ? <ChevronUp className="w-4 h-4 text-slate-300" /> : <ChevronDown className="w-4 h-4 text-slate-300" />}
          </button>

          {showConstraints && (
            <div className="px-4 py-4 space-y-4 border-t border-surface-200">
              <p className="text-xs text-slate-500">
                Set per-channel spend bounds as a percentage of total budget. Channels without constraints use the global defaults (5% floor, 50% cap). Mirrors Meridian&apos;s <code className="font-mono text-xs">ChannelConstraintRel</code>.
              </p>

              {/* Per-channel min/max table */}
              <div className="overflow-hidden rounded-xl border border-surface-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-50 text-left">
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500">Channel</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500">Min %</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500">Max %</th>
                      <th className="px-3 py-2 text-xs font-semibold text-slate-500 w-8">Reset</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {roiData.map((ch, i) => {
                      const constraint = channelConstraints[ch.channel] ?? { min_ratio: 0.05, max_ratio: 0.50 }
                      const err = constraintErrors[ch.channel]
                      return (
                        <tr key={ch.channel} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                          <td className="px-3 py-2 font-medium text-slate-700 text-sm">{ch.channel}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1} max={99} step={1}
                                value={Math.round(constraint.min_ratio * 100)}
                                aria-label={`${ch.channel} minimum spend percentage`}
                                onChange={e => {
                                  const minR = Math.max(0, Math.min(99, parseInt(e.target.value) || 0)) / 100
                                  const newC: ChannelConstraint = { min_ratio: minR, max_ratio: constraint.max_ratio }
                                  const err = validateConstraint(newC)
                                  setConstraintErrors(prev => err ? { ...prev, [ch.channel]: err } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== ch.channel)))
                                  setChannelConstraints(prev => ({ ...prev, [ch.channel]: newC }))
                                }}
                                className="w-16 px-2 py-1 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-300 font-mono text-right"
                              />
                              <span className="text-xs text-slate-400">%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={1} max={100} step={1}
                                value={Math.round(constraint.max_ratio * 100)}
                                aria-label={`${ch.channel} maximum spend percentage`}
                                onChange={e => {
                                  const maxR = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) / 100
                                  const newC: ChannelConstraint = { min_ratio: constraint.min_ratio, max_ratio: maxR }
                                  const err = validateConstraint(newC)
                                  setConstraintErrors(prev => err ? { ...prev, [ch.channel]: err } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== ch.channel)))
                                  setChannelConstraints(prev => ({ ...prev, [ch.channel]: newC }))
                                }}
                                className="w-16 px-2 py-1 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-300 font-mono text-right"
                              />
                              <span className="text-xs text-slate-400">%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => {
                                setChannelConstraints(prev => {
                                  const next = { ...prev }
                                  delete next[ch.channel]
                                  return next
                                })
                                setConstraintErrors(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== ch.channel)))
                              }}
                              className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                              title="Reset to default"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Show validation errors */}
              {Object.entries(constraintErrors).map(([ch, err]) => (
                <p key={ch} className="text-xs text-red-500">{ch}: {err}</p>
              ))}

              {/* RF Frequency toggle */}
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-700">Optimal frequency (RF channels)</p>
                  <p className="text-xs text-slate-500 mt-0.5">Enable frequency-aware optimization for reach-and-frequency channels (e.g. YouTube). Requires RF data in the loaded dataset. Mirrors the notebook&apos;s <code className="font-mono text-xs">use_optimal_frequency</code> parameter.</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 mt-1">
                  <button
                    onClick={() => setUseOptimalFrequency(v => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-300 ${useOptimalFrequency ? 'bg-brand-500' : 'bg-surface-300'}`}
                    aria-label="Toggle optimal frequency"
                    role="switch"
                    aria-checked={useOptimalFrequency}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${useOptimalFrequency ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                  {useOptimalFrequency && (
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-slate-500">Max freq:</label>
                      <input
                        type="number"
                        min={1} max={30} step={1}
                        value={maxFrequency}
                        aria-label="Maximum frequency"
                        onChange={e => setMaxFrequency(Math.max(1, parseInt(e.target.value) || 10))}
                        className="w-14 px-2 py-1 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-300 font-mono text-right"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Budget mode selector ──────────────────────────────────────── */}
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-700">Optimization mode</span>
            <SectionTooltip content={
        <>
      Fixed budget: redistribute the same total spend for maximum revenue.
      <br />
      Target ROI: find what budget achieves a specific portfolio return.
      <br />
      Target mROI: find the budget where your last dollar still meets a minimum return threshold.
        </>
  }
/>
          </div>
          <div className="flex gap-2">
            {([
              { id: 'fixed',      label: 'Fixed budget',  desc: 'Best split for current spend' },
              { id: 'target_roi', label: 'Target ROI',    desc: 'Budget needed for a ROI goal' },
              { id: 'target_mroi',label: 'Target mROI',   desc: 'Spend until diminishing returns' },
            ] as { id: BudgetMode; label: string; desc: string }[]).map(m => (
              <button
                key={m.id}
                onClick={() => setBudgetMode(m.id)}
                className={`flex-1 px-3 py-2 rounded-xl border text-left transition-colors ${
                  budgetMode === m.id
                    ? 'border-brand-400 bg-brand-50 text-brand-700'
                    : 'border-surface-200 bg-white text-slate-600 hover:bg-surface-50'
                }`}
              >
                <p className="text-xs font-semibold">{m.label}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>

          {budgetMode !== 'fixed' && (
            <div className="flex items-center gap-3 px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl">
              <label className="text-sm text-slate-600 shrink-0">
                {budgetMode === 'target_roi' ? 'Target portfolio ROI' : 'Minimum marginal ROI'}
              </label>
              <input
                type="number"
                min={0.5} max={20} step={0.1}
                value={targetValue}
                onChange={e => setTargetValue(Math.max(0.5, parseFloat(e.target.value) || 1))}
                className="w-20 px-2 py-1 text-sm border border-brand-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-300 font-mono text-right"
              />
              <span className="text-sm text-slate-500">×</span>
              <p className="text-xs text-slate-400">
                {budgetMode === 'target_roi'
                  ? `Find the budget required to achieve a ${targetValue.toFixed(1)}x portfolio ROI.`
                  : `Spend up to the point where the last dollar returns ≥ ${targetValue.toFixed(1)}×.`}
              </p>
            </div>
          )}
        </div>

        <CodeExecutionButton
          label="Optimize Budget Allocation"
          tooltip="Figures out the best way to spread your budget across channels, using your actual performance data, while keeping each channel within a sensible spend range."
          whyItMatters="Instead of guessing where to move budget, this gives you a data-backed recommendation.You'll see exactly which channels are under- or over-funded relative to what they actually return."
          code={buildOptCode(totalSpend, budgetMode, targetValue)}
          onExecute={async () => {
            const channels = modelResults?.channels ?? MOCK_ROI_DATA.map(d => ({
              channel: d.channel.toLowerCase().replace(' ', '_'),
              label: d.channel,
              roi: d.roi,
              roi_ci_lower: d.roi * 0.75,
              roi_ci_upper: d.roi * 1.25,
              spend: d.spend,
              revenue: d.revenue,
              confidence: 'Medium' as const,
              color: d.color,
              mroi: d.mroi,
              saturationRatio: d.mroi / d.roi,
              saturationStatus: d.saturationStatus,
            }))

            // Validate constraints before sending
            const validConstraints = Object.fromEntries(
              Object.entries(channelConstraints).filter(([ch, c]) => !validateConstraint(c))
            )

            const modeScenario = budgetMode === 'target_roi'
              ? { fixed_budget: false, target_roi: targetValue }
              : budgetMode === 'target_mroi'
              ? { fixed_budget: false, target_mroi: targetValue }
              : undefined

            try {
              const res = await runOptimizationWithConstraints(
                totalSpend,
                Object.keys(validConstraints).length > 0 ? validConstraints : undefined,
                useOptimalFrequency || undefined,
                useOptimalFrequency ? maxFrequency : undefined,
                modeScenario,
              )
              setIsRealMeridian(res.is_real_meridian === true)
              const alloc: Array<{ channel: string; current_spend: number; optimal_spend: number; change: number; change_pct: number }> =
                res.optimal_allocation ?? []
              const mapped = alloc.map(a => {
                const ch = channels.find(c => c.label === a.channel) ?? {
                  channel: a.channel.toLowerCase().replace(/\s+/g, '_'),
                  label: a.channel,
                  roi: 2.0, roi_ci_lower: 1.5, roi_ci_upper: 2.5,
                  spend: a.current_spend, revenue: a.current_spend * 2.0,
                  confidence: 'Medium' as const, color: '#94a3b8',
                  mroi: 1.0, saturationRatio: 0.5, saturationStatus: 'efficient' as const,
                }
                // Use linear revenue model: spend × ROI with mild diminishing-returns
                // haircut for increases only. Hill params are estimated, not real posteriors,
                // so Hill-curve projection introduces more error than it corrects.
                const spendIncrease = Math.max(0, a.optimal_spend - ch.spend) / Math.max(ch.spend, 1)
                const optimalRevenue = a.optimal_spend * ch.roi * Math.max(0.85, 1 - spendIncrease * 0.15)
                return {
                  ...ch,
                  spend: a.current_spend,
                  optimalSpend: a.optimal_spend,
                  optimalRevenue,
                  spendChange: a.change,
                  spendChangePct: a.change_pct,
                }
              })
              setOptimized(mapped)
            } catch {
              setOptimized(computeOptimizedAllocation(channels, totalSpend, modelResults?.hillParams))
            }
          }}
          successMessage="Optimization complete!"
        />

        {optimized && (() => {
          const currentRev  = optimized.reduce((a, c) => a + c.revenue, 0)
          const optimalRev  = optimized.reduce((a, c) => a + c.optimalRevenue, 0)
          const totalSpend  = optimized.reduce((a, c) => a + c.spend, 0)
          const currentRoi  = currentRev / totalSpend
          const optimalRoi  = optimalRev / totalSpend
          const revGain     = optimalRev - currentRev
          return (
            <div className="mt-5 space-y-5">
              {/* Per-channel table */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Spend Reallocation by Channel</p>
                  <DataMethodBadge method={isRealMeridian ? 'meridian' : 'pearson'} />
                </div>
                <div className="overflow-hidden rounded-xl border border-surface-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-50 text-left">
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Channel</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Current</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Optimal</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Change</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Saturation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {optimized.sort((a, b) => b.spendChange - a.spendChange).map((ch, i) => {
                        const satBadge = getSaturationBadge(ch.saturationStatus)
                        const up = ch.spendChange > 500
                        const dn = ch.spendChange < -500
                        return (
                          <tr key={ch.label} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                            <td className="px-4 py-3 font-semibold text-slate-800">
                            <span>{ch.label}</span>
                            {channelConstraints[ch.label] && (
                              <span className="ml-1.5 text-xs bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded font-medium">constrained</span>
                            )}
                          </td>
                            <td className="px-4 py-3 text-slate-600">{fmt(ch.spend, currency)}</td>
                            <td className="px-4 py-3 font-semibold text-slate-700">{fmt(ch.optimalSpend, currency)}</td>
                            <td className="px-4 py-3">
                              <span className={`flex items-center gap-1 text-sm font-semibold ${up ? 'text-green-600' : dn ? 'text-red-500' : 'text-slate-400'}`}>
                                {up ? <TrendingUp className="w-3.5 h-3.5" /> : dn ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                                {fmtDelta(ch.spendChange, currency)} ({fmtSignedPct(ch.spendChangePct, 0)})
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${satBadge.color}`}>{satBadge.text}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface-100 border-t-2 border-surface-200">
                        <td className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Total</td>
                        <td className="px-4 py-3 font-bold text-slate-800">{fmt(optimized.reduce((a, c) => a + c.spend, 0), currency)}</td>
                        <td className="px-4 py-3 font-bold text-slate-800">{fmt(optimized.reduce((a, c) => a + c.optimalSpend, 0), currency)}</td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="text-xs text-slate-400 mt-2">Allocation shifts budget toward higher-performing channels based on observed ROI from your dataset. Run the backend with Python 3.11+ to enable Meridian's <code className="font-mono">BudgetOptimizer</code> for full posterior-based optimization.</p>
              </div>

              {/* Spend delta bar chart */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Budget reallocation — current vs optimal</p>
                <div className="bg-white border border-surface-200 rounded-xl p-4">
                  <ResponsiveContainer width="100%" height={Math.max(160, optimized.length * 44)}>
                    <BarChart
                      data={[...optimized].sort((a, b) => b.optimalSpend - a.optimalSpend).map(ch => ({
                        name: ch.label,
                        current: Math.round(ch.spend),
                        optimal: Math.round(ch.optimalSpend),
                        delta: Math.round(ch.spendChange),
                        color: ch.color,
                      }))}
                      layout="vertical"
                      margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
                      barCategoryGap="25%"
                      barGap={3}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-light-sage)" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={v => currency === 'IDR' ? `Rp${(v/1e6).toFixed(0)}M` : `$${(v/1000).toFixed(0)}K`}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={80}
                        tick={{ fontSize: 11, fill: 'var(--color-muted-olive)' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <RechartTooltip
                        formatter={(value: number, name: string) => [
                          currency === 'IDR'
                            ? `Rp${(value/1e6).toFixed(1)}M`
                            : `$${(value/1000).toFixed(0)}K`,
                          name === 'current' ? 'Current spend' : 'Optimal spend',
                        ]}
                        contentStyle={{ background: 'var(--color-parchment)', border: '1px solid var(--color-sage-border)', fontSize: 12 }}
                      />
                      <Legend
                        iconType="square"
                        iconSize={8}
                        wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                        formatter={(v: string) => v === 'current' ? 'Current spend' : 'Optimal spend'}
                      />
                      <ReferenceLine x={0} stroke="var(--color-sage-border)" />
                      <Bar dataKey="current" fill="var(--color-light-sage)" radius={[0, 2, 2, 0]} />
                      <Bar dataKey="optimal" radius={[0, 2, 2, 0]}>
                        {[...optimized].sort((a, b) => b.optimalSpend - a.optimalSpend).map((ch, i) => (
                          <Cell key={i} fill={ch.spendChange > 500 ? ch.color : ch.spendChange < -500 ? ch.color + '60' : ch.color + '90'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-slate-400 mt-2">Gray = current spend · Colored = optimal spend (brighter = increase, muted = decrease)</p>
                </div>
              </div>

              {/* Summary comparison */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Summary: Current vs. Optimized</p>
                <div className="overflow-hidden rounded-xl border border-surface-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-50 text-left">
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Metric</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Current</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Optimized</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Change</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      <tr className="bg-white">
                        <td className="px-4 py-3 text-slate-600">Total Budget</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{fmt(totalSpend, currency)}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{fmt(totalSpend, currency)}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">No change</td>
                      </tr>
                      <tr className="bg-surface-50/50">
                        <td className="px-4 py-3 text-slate-600">Portfolio ROI</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{fmtROI(currentRoi, currency)}</td>
                        <td className={`px-4 py-3 font-mono font-bold ${optimalRoi >= currentRoi ? 'text-green-700' : 'text-red-600'}`}>{fmtROI(optimalRoi, currency)}</td>
                        <td className={`px-4 py-3 text-sm font-semibold ${optimalRoi >= currentRoi ? 'text-green-600' : 'text-red-500'}`}>{fmtSignedPct((optimalRoi / currentRoi - 1) * 100)}</td>
                      </tr>
                      <tr className="bg-white">
                        <td className="px-4 py-3 text-slate-600">Revenue from Ads</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{fmt(currentRev, currency)}</td>
                        <td className={`px-4 py-3 font-mono font-bold ${optimalRev >= currentRev ? 'text-green-700' : 'text-red-600'}`}>{fmt(optimalRev, currency)}</td>
                        <td className={`px-4 py-3 text-sm font-semibold ${revGain >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtDelta(revGain, currency)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Saturation Frontier — collapsible */}
      {saturation && saturation.channels.length > 0 && (
        <div className="card card-body">
          <button
            onClick={() => setShowSaturation(v => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-sm font-semibold text-slate-700">Saturation Frontier</span>
            {showSaturation ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {showSaturation && (
            <div className="mt-4">
              <SaturationHeatmap data={saturation} currency={currency} />
            </div>
          )}
        </div>
      )}

      <PlanningCycleSummary items={[
        `Shift 5–10% of ${optText.from} budget toward ${optText.to}. ${optText.from}'s ${fmtROI(optText.fromRoi, currency)} ROI is below the portfolio average of ${fmtROI(portfolioRoi, currency)}, and ${optText.to} has the strongest return in your current mix.`,
        'Move budget in steps of 10–15% at a time, not all at once. Large abrupt shifts make it harder to read the results clearly in your next model run.',
        'Re-run the model each quarter with fresh data. Channel performance shifts seasonally — last year\'s numbers can be out of date by the next planning cycle.',
      ]} />
    </div>
  )
}
