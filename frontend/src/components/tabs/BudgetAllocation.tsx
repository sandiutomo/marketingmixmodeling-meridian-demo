'use client'
import { useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import ROIBarChart from '@/components/charts/ROIBarChart'
import InsightsPanel from '@/components/insights/InsightsPanel'
import CodeExecutionButton from '@/components/model/CodeExecutionButton'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import MeridianBadge from '@/components/ui/MeridianBadge'
import type { ModelResults, ChannelResult, HillChannelParams } from '@/lib/types'
import { getSaturationBadge } from '@/lib/types'
import { fmt, fmtDelta, fmtROI, fmtSignedPct } from '@/lib/format'
import { runOptimization } from '@/lib/api'
import InsightCodeCard from '@/components/ui/InsightCodeCard'

const MOCK_ROI_DATA = [
  { channel: 'Paid Search', roi: 4.2, spend: 450000, revenue: 1890000, color: '#7209b7', mroi: 2.73, saturationStatus: 'efficient' as const },
  { channel: 'Social',      roi: 3.1, spend: 380000, revenue: 1178000, color: '#f72585', mroi: 2.02, saturationStatus: 'efficient' as const },
  { channel: 'TV',          roi: 2.8, spend: 1200000, revenue: 3360000, color: '#4361ee', mroi: 1.40, saturationStatus: 'saturated' as const },
  { channel: 'Email',       roi: 5.8, spend: 80000,   revenue: 464000,  color: '#06d6a0', mroi: 3.77, saturationStatus: 'efficient' as const },
  { channel: 'Display',     roi: 1.4, spend: 520000,  revenue: 728000,  color: '#4cc9f0', mroi: 0.70, saturationStatus: 'saturated' as const },
  { channel: 'Radio',       roi: 1.9, spend: 220000,  revenue: 418000,  color: '#3a0ca3', mroi: 1.52, saturationStatus: 'room_to_grow' as const },
]

function buildOptCode(totalSpend: number) {
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

export default function BudgetAllocation({ modelResults }: { modelResults: ModelResults | null }) {
  const [optimized, setOptimized] = useState<ReturnType<typeof computeOptimizedAllocation> | null>(null)
  const [isRealMeridian, setIsRealMeridian] = useState(false)

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Where should your budget go?</h2>
        <p className="text-slate-500 mt-1">See which channels create the most impact per dollar, and get a recommended allocation based on your data.</p>
      </div>

      {!modelResults && (
        <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs font-medium text-amber-700">Sample data — run the analysis in Step 2 to see real numbers for your channels.</p>
        </div>
      )}

      <InsightCodeCard
        title="How budget insights are produced"
        description="Shows where to shift your budget based on which channels are delivering the best results."
        code={buildOptCode(totalSpend)}
      />

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
            <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
            <details className="mt-2 text-left">
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none text-center">How was this calculated?</summary>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{calc}</p>
            </details>
          </div>
        ))}
      </div>

      <div className="card card-body">
        <ROIBarChart data={roiData} portfolioRoi={portfolioRoi} currency={currency} isReal={modelResults?.isRealMeridian ?? false} />
        <div className="mt-4 p-4 bg-surface-50 rounded-xl">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">What you're seeing</p>
          <p className="text-sm text-slate-600">{highestRoiChannel.channel} returns {fmtROI(highestRoiChannel.roi, currency)} for every {currency === 'IDR' ? 'Rp 1,000' : '$1'} spent — the strongest in your mix. {lowestRoiChannel.channel} returns {fmtROI(lowestRoiChannel.roi, currency)}, below the portfolio average of {fmtROI(portfolioRoi, currency)}. Any channel significantly below the average is worth a closer look at targeting, creative, or audience overlap before the next planning cycle.</p>
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
            code={`import meridian
from meridian.model.model import Meridian
from meridian.model.spec import ModelSpec

# 1. Fit the model on historical spend + revenue data
mmm = Meridian(input_data=input_data, model_spec=ModelSpec())
mmm.sample_posterior(
    n_chains=4,
    n_adapt=500,
    n_burnin=500,
    n_keep=1000,
    seed=42,
)

# 2. Extract posterior ROI distribution for each channel
#    Shape: (n_samples, n_channels)
roi_samples = mmm.roi(by_reach=False, use_kpi=False)

# 3. Summarise: mean + 80% credible interval
roi_mean = roi_samples.mean(dim="sample")
roi_ci   = roi_samples.quantile([0.10, 0.90], dim="sample")

for ch in roi_mean.channel.values:
    mean = float(roi_mean.sel(channel=ch))
    lo   = float(roi_ci.sel(quantile=0.10, channel=ch))
    hi   = float(roi_ci.sel(quantile=0.90, channel=ch))
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

      <div className="card card-body">
        <h3 className="font-bold text-slate-900 mb-2">Optimize Your Budget Split</h3>
        <p className="text-sm text-slate-500 mb-4">Find the best way to spread your total budget across channels to get the most revenue out of what you're already spending.</p>
        <CodeExecutionButton
          label="Optimize Budget Allocation"
          tooltip="Figures out the best way to spread your budget across channels, using your actual performance data, while keeping each channel within a sensible spend range."
          whyItMatters="Instead of guessing where to move budget, this gives you a data-backed recommendation. You'll see exactly which channels are under- or over-funded relative to what they actually return."
          code={buildOptCode(totalSpend)}
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
            try {
              const res = await runOptimization(totalSpend)
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
                  <MeridianBadge isReal={isRealMeridian} />
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
                            <td className="px-4 py-3 font-semibold text-slate-800">{ch.label}</td>
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

      <InsightsPanel modelResults={modelResults} optimized={optimized} />

      <PlanningCycleSummary items={[
        `Shift 5–10% of ${optText.from} budget toward ${optText.to}. ${optText.from}'s ${fmtROI(optText.fromRoi, currency)} ROI is below the portfolio average of ${fmtROI(portfolioRoi, currency)}, and ${optText.to} has the strongest return in your current mix.`,
        'Move budget in steps of 10–15% at a time, not all at once. Large abrupt shifts make it harder to read the results clearly in your next model run.',
        'Re-run the model each quarter with fresh data. Channel performance shifts seasonally — last year\'s numbers can be out of date by the next planning cycle.',
      ]} />
    </div>
  )
}
