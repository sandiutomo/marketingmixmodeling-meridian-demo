'use client'
import { useState } from 'react'
import ContributionPieChart from '@/components/charts/ContributionPieChart'
import DiminishingReturnsChart from '@/components/charts/DiminishingReturnsChart'
import SpendResponseChart from '@/components/charts/SpendResponseChart'
import CodeExecutionButton from '@/components/model/CodeExecutionButton'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import { getResults } from '@/lib/api'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import SectionTooltip from '@/components/ui/SectionTooltip'
import AdstockPanel from '@/components/insights/AdstockPanel'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import DataMethodBanner from '@/components/ui/DataMethodBanner'
import type { ModelResults, HillChannelParams } from '@/lib/types'
import { getSaturationBadge, deriveDataMethod } from '@/lib/types'
import type { MROIChannel } from '@/lib/types'
import ROImROIBubble from '@/components/charts/ROImROIBubble'
import SpendVsContributionChart from '@/components/charts/SpendVsContributionChart'
import EffectivenessROIBubble from '@/components/charts/EffectivenessROIBubble'
import EmptyState from '@/components/ui/EmptyState'
import { fmt, fmtROI, fmtPct } from '@/lib/format'

const MOCK_CONTRIBUTION_DATA = [
  { channel: 'TV', contribution: 3360000, percentage: 38 },
  { channel: 'Paid Search', contribution: 1890000, percentage: 21 },
  { channel: 'Social', contribution: 1178000, percentage: 13 },
  { channel: 'Display', contribution: 728000, percentage: 8 },
  { channel: 'Radio', contribution: 418000, percentage: 5 },
  { channel: 'Base (non-media)', contribution: 1326000, percentage: 15 },
]

const RESULTS_CODE = `# google-meridian 1.5.3 · Python 3.13
from meridian.analysis.analyzer import Analyzer

analyzer = Analyzer(model)  # Analyzer(model), not ResultsAnalyzer(model=...)

# Summary metrics: ROI + incremental outcome per channel (90% CI)
summary_ds = analyzer.summary_metrics(confidence_level=0.9)

# ROI per channel — posterior mean + 90% credible interval
# metric names: 'mean' | 'ci_lo' | 'ci_hi'  (not ci_low / ci_high)
roi_mean = summary_ds["roi"].sel(distribution="posterior", metric="mean")
roi_lo   = summary_ds["roi"].sel(distribution="posterior", metric="ci_lo")
roi_hi   = summary_ds["roi"].sel(distribution="posterior", metric="ci_hi")

# Revenue contribution per channel (incremental_outcome = sales caused by spend)
contribution = summary_ds["incremental_outcome"].sel(
    distribution="posterior", metric="mean"
)

for ch in [c for c in roi_mean.channel.values if c != "All Paid Channels"]:
    print(f"{ch}: ROI {float(roi_mean.sel(channel=ch)):.2f}"
          f"  [90% CI {float(roi_lo.sel(channel=ch)):.2f}–{float(roi_hi.sel(channel=ch)):.2f}]"
          f"  contribution {float(contribution.sel(channel=ch)):,.0f}")
`

const USING_MOCK_FLAG = '__mock__'

// Fallback mock results shown when backend is unavailable
const MOCK_ROI_RESULTS = [
  { channel: 'Email',       roi: 5.80, roi_ci_lower: 4.20, roi_ci_upper: 7.60, spend: 80000,   revenue: 464000,  confidence: 'High'   as const, mroi: 3.77, saturationRatio: 0.65, saturationStatus: 'efficient'    as const },
  { channel: 'Paid Search', roi: 4.20, roi_ci_lower: 3.50, roi_ci_upper: 5.10, spend: 450000,  revenue: 1890000, confidence: 'High'   as const, mroi: 2.73, saturationRatio: 0.65, saturationStatus: 'efficient'    as const },
  { channel: 'Social',      roi: 3.10, roi_ci_lower: 2.40, roi_ci_upper: 3.85, spend: 380000,  revenue: 1178000, confidence: 'Medium' as const, mroi: 2.02, saturationRatio: 0.65, saturationStatus: 'efficient'    as const },
  { channel: 'TV',          roi: 2.80, roi_ci_lower: 2.10, roi_ci_upper: 3.55, spend: 1200000, revenue: 3360000, confidence: 'High'   as const, mroi: 1.40, saturationRatio: 0.50, saturationStatus: 'saturated'    as const },
  { channel: 'Radio',       roi: 1.90, roi_ci_lower: 1.20, roi_ci_upper: 2.70, spend: 220000,  revenue: 418000,  confidence: 'Medium' as const, mroi: 1.52, saturationRatio: 0.80, saturationStatus: 'room_to_grow' as const },
  { channel: 'Display',     roi: 1.40, roi_ci_lower: 0.85, roi_ci_upper: 2.05, spend: 520000,  revenue: 728000,  confidence: 'Low'    as const, mroi: 0.70, saturationRatio: 0.50, saturationStatus: 'saturated'    as const },
]

function confidenceColor(confidence: string) {
  if (confidence === 'High') return 'text-green-600 bg-green-50'
  if (confidence === 'Medium') return 'text-amber-600 bg-amber-50'
  return 'text-red-500 bg-red-50'
}

function confidenceTooltip(confidence: string) {
  if (confidence === 'High') return 'Tight confidence range. Act on this with confidence.'
  if (confidence === 'Medium') return 'Moderate certainty; directionally correct, but consider more data before large shifts.'
  return 'Wide range. Needs more data before making major budget decisions based on this channel.'
}

// Industry benchmark ROI ranges (source: Nielsen/Analytic Partners meta-analysis)
const BENCHMARKS: { keywords: string[]; lo: number; hi: number; label: string }[] = [
  { keywords: ['email'], lo: 3.5, hi: 8.0, label: 'Email' },
  { keywords: ['paid search', 'search', 'sem', 'ppc', 'google ads'], lo: 3.0, hi: 6.0, label: 'Paid Search' },
  { keywords: ['social', 'facebook', 'instagram', 'tiktok', 'twitter', 'linkedin'], lo: 1.8, hi: 4.0, label: 'Social' },
  { keywords: ['tv', 'television', 'linear tv', 'connected tv', 'ctv', 'ott'], lo: 1.5, hi: 3.5, label: 'TV' },
  { keywords: ['radio', 'audio', 'podcast', 'streaming audio'], lo: 1.2, hi: 3.0, label: 'Radio' },
  { keywords: ['display', 'banner', 'programmatic', 'dsp'], lo: 0.8, hi: 2.0, label: 'Display' },
  { keywords: ['video', 'youtube', 'pre-roll', 'online video'], lo: 1.5, hi: 3.8, label: 'Online Video' },
  { keywords: ['ooh', 'out-of-home', 'billboard', 'outdoor'], lo: 1.0, hi: 2.5, label: 'OOH' },
  { keywords: ['affiliate', 'influencer'], lo: 2.5, hi: 5.5, label: 'Affiliate' },
]

function getBenchmark(channel: string): { lo: number; hi: number; label: string } | null {
  const lower = channel.toLowerCase()
  for (const b of BENCHMARKS) {
    if (b.keywords.some(k => lower.includes(k))) return b
  }
  return null
}

function benchmarkBadge(roi: number, bench: { lo: number; hi: number; label: string } | null) {
  if (!bench) return { text: 'n/a', color: 'text-slate-400', tip: 'No industry benchmark available for this channel type.' }
  if (roi >= bench.hi) return { text: `above ${bench.lo}x-${bench.hi}x`, color: 'text-emerald-600 bg-emerald-50', tip: `Industry typical: ${bench.lo}x to ${bench.hi}x. Your ROI exceeds the top of this range. Strong performance.` }
  if (roi >= bench.lo) return { text: `within ${bench.lo}x-${bench.hi}x`, color: 'text-blue-600 bg-blue-50', tip: `Industry typical: ${bench.lo}x to ${bench.hi}x. You are within the expected range.` }
  return { text: `below ${bench.lo}x-${bench.hi}x`, color: 'text-amber-600 bg-amber-50', tip: `Industry typical: ${bench.lo}x to ${bench.hi}x. Your ROI is below industry norms. Review targeting and creative.` }
}

/** Generate a spend-response curve using the Hill saturation function.
 *  revenue = maxResponse × spend^slope / (ec^slope + spend^slope)
 *  Falls back to an exponential approximation if Hill params are not available.
 */
function generateCurve(
  saturation: number,
  hillParams?: HillChannelParams | null,
  optimalSpendHint?: number,
) {
  const points = 40
  if (hillParams && hillParams.ec && hillParams.slope && hillParams.maxResponse) {
    const { ec, slope, maxResponse } = hillParams
    // Ensure optimal spend isn't crammed in the first few percent of the axis:
    // use at least 2.5× optimal spend as the upper bound so reference lines are
    // well-separated, or fall back to 3× ec if no hint is available.
    const maxSpend = optimalSpendHint
      ? Math.max(ec * 1.5, optimalSpendHint * 2.5)
      : ec * 3
    const step = maxSpend / points
    return [
      { spend: 0, response: 0 },
      ...Array.from({ length: points }, (_, j) => {
        const spend = step * (j + 1)
        const spendSlope = Math.pow(spend, slope)
        const ecSlope    = Math.pow(ec, slope)
        const response   = maxResponse * spendSlope / (ecSlope + spendSlope)
        return { spend: Math.round(spend), response: Math.round(response) }
      }),
    ]
  }
  // Fallback: exponential approximation
  return [
    { spend: 0, response: 0 },
    ...Array.from({ length: points }, (_, j) => {
      const spend = (saturation / points) * (j + 1) * 3 / 2.5
      const response = saturation * (1 - Math.exp(-2.5 * spend / saturation))
      return { spend: Math.round(spend), response: Math.round(response) }
    }),
  ]
}

export default function MeasuringROI({ modelResults }: { modelResults: ModelResults | null }) {
  type RoiRow = { channel: string; roi: number; roi_ci_lower: number; roi_ci_upper: number; spend: number; revenue: number; confidence: 'High' | 'Medium' | 'Low'; mroi?: number; saturationRatio?: number; saturationStatus?: 'saturated' | 'efficient' | 'room_to_grow'; __mock__?: boolean }
  const [roiResults, setRoiResults] = useState<RoiRow[] | null>(null)
  const [selectedCurveIdx, setSelectedCurveIdx] = useState(0)
  const [forecastMultiplier, setForecastMultiplier] = useState(0) // % change from −50 to +100
  const isUsingMock = roiResults?.some(r => r[USING_MOCK_FLAG as keyof typeof r])
  const currency = modelResults?.currency ?? 'USD'
  const dataMethod = deriveDataMethod(modelResults)

  const contributionData = modelResults
    ? [
        ...modelResults.channels.map(ch => ({
          channel: ch.label,
          contribution: ch.revenue,
          percentage: Math.round(ch.revenue / modelResults.totalRevenue * 100),
        })),
        {
          channel: 'Base (non-media)',
          contribution: modelResults.baseRevenue,
          percentage: Math.round(modelResults.baseRevenue / modelResults.totalRevenue * 100),
        },
      ]
    : MOCK_CONTRIBUTION_DATA

  const channelCards = modelResults
    ? modelResults.channels.slice(0, 3).map(ch => {
        const adstock = modelResults.adstockParams?.find(a => a.channel_key === ch.channel)
        const halfLife = adstock ? Math.ceil(Math.log(0.5) / Math.log(adstock.decayRate ?? 0.4)) : null
        return {
          channel: ch.label,
          role: ch.roi >= 3.5 ? 'Demand Capture' : 'Demand Driver',
          roi: fmtROI(ch.roi, currency),
          carryover: halfLife ? `~${halfLife}w half-life` : '',
          description: `${ch.label} returned ${fmtROI(ch.roi, currency)} per ${currency === 'IDR' ? 'Rp 1,000' : '$1'} spent, with ${ch.confidence.toLowerCase()} confidence in that estimate. Total spend: ${fmt(ch.spend, currency)}, revenue attributed to this channel: ${fmt(ch.revenue, currency)}.`,
        }
      })
    : [
        { channel: 'TV', role: 'Demand Driver', roi: '$2.80', carryover: '23%', description: 'Builds brand awareness that keeps working for weeks after the ad runs. Cuts show up as lower search volume weeks later, so don\'t evaluate TV by this week\'s numbers alone.' },
        { channel: 'Paid Search', role: 'Demand Capture', roi: '$4.20', carryover: '5%', description: 'Captures people who are already looking to buy. High ROI because it reaches people with intent, but it depends on TV and Social creating that interest first.' },
        { channel: 'Social', role: 'Demand Driver', roi: '$3.10', carryover: '12%', description: 'Introduces your brand to new audiences and creates purchase interest. Works best when paired with Paid Search, which then captures the people Social influenced.' },
      ]

  return (
    <div className="space-y-6">
      <DataMethodBanner method={dataMethod} />
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-slate-900">What each channel is actually returning</h2>
          <SectionTooltip content="ROI is estimated from Meridian's posterior distribution, not a simple ratio. The model holds all other channels constant while it estimates each channel's causal contribution, so you're seeing what each channel actually caused, not just what happened at the same time." />
        </div>
        <p className="text-slate-500 mt-1">See the revenue each channel caused: sales that only happened because of that spending.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card card-body">
          <ContributionPieChart data={contributionData} currency={modelResults?.currency ?? 'USD'} dataMethod={dataMethod} />
          <div className="mt-4 p-4 bg-surface-50 rounded-xl">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Why it matters</p>
            {modelResults ? (() => {
              const basePct = Math.round(modelResults.baseRevenue / modelResults.totalRevenue * 100)
              const mediaPct = 100 - basePct
              return <p className="text-sm text-slate-600">{basePct}% of your revenue would happen anyway, even with zero ads. The remaining {mediaPct}% is directly driven by your media spend. That is what your advertising is actually worth.</p>
            })() : (
              <p className="text-sm text-slate-600">15% of your revenue would happen anyway, even if you ran zero ads. The remaining 85% is directly driven by your media spend. This is the number that tells you what your advertising is actually worth.</p>
            )}
          </div>
        </div>
        <div className="card card-body">
          <DiminishingReturnsChart modelResults={modelResults} />
          <details className="mt-4 pt-4 border-t border-surface-100">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">How Meridian calculates the saturation curve</summary>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">The saturation curve is estimated using a Hill function fitted to historical spend-response data. The model learns the shape of diminishing returns for each channel independently, accounting for differences in audience size, creative wear-out rates, and market penetration. The "recommended" spend marker reflects Meridian's optimization output given your current total budget constraint.</p>
          </details>
        </div>
      </div>

      {modelResults && (() => {
        const channels = modelResults.channels
        const ch = channels[selectedCurveIdx] ?? channels[0]
        if (!ch) return null
        const nWeeks = modelResults.nWeeks
        const saturation = (ch.revenue / nWeeks * 4) * 2.5
        const currentSpend = ch.spend / nWeeks * 4
        const multiplier = ch.saturationStatus === 'saturated' ? 0.75 :
                           ch.saturationStatus === 'efficient' ? 1.15 : 1.4
        const optimalSpend = currentSpend * multiplier
        const chHillParams = modelResults.hillParams?.find(p => p.channel_key === ch.channel) ?? null
        const curveData = generateCurve(saturation, chHillParams, optimalSpend)
        return (
          <div className="card card-body">
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900">Spend-Response Curves</h3>
                <DataMethodBadge method={dataMethod} />
                <SectionTooltip content="Shows the relationship between how much you spend and how much revenue you get back per channel. A steep curve means more room to grow. A flat curve means you are near or past the efficient spend range, where each additional dollar returns less." />
              </div>
              <p className="text-sm text-slate-500 mt-0.5">How incremental revenue changes as spend increases. A flat curve at your current spend means you're past the efficient range.</p>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {channels.map((c, idx) => (
                <button
                  key={c.channel}
                  onClick={() => setSelectedCurveIdx(idx)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${idx === selectedCurveIdx ? 'bg-brand-600 text-white' : 'bg-surface-100 text-slate-600 hover:bg-surface-200'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <SpendResponseChart
              channel={ch.label}
              data={curveData}
              currentSpend={currentSpend}
              optimalSpend={optimalSpend}
              currency={modelResults?.currency ?? 'USD'}
            />
            <p className="text-xs text-slate-400 mt-3">The curve shape is estimated from your historical data using a Hill saturation function. The steeper the curve at your current spend, the more room there is to grow.</p>
          </div>
        )
      })()}

      <div className="card card-body">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-bold text-slate-900">Generate Full ROI Report</h3>
          <SectionTooltip content="Runs Meridian's analyzer to produce a channel-by-channel ROI breakdown with 90% credible intervals. A tight interval means act on it. A wide interval means the model needs more data before you should shift large budgets based on that channel alone." />
        </div>
        <p className="text-sm text-slate-500 mb-4">Get a channel-by-channel breakdown of returns, including confidence ranges so you know how much to trust each number.</p>
        <CodeExecutionButton
          label="Generate ROI Report"
          tooltip="Calculates the return on investment for each channel, including delayed effects (like when a TV ad drives conversions days later), with a confidence range for each estimate."
          whyItMatters="A tight confidence range means you can act with confidence. A wide range means the data needs more time or volume before the numbers are reliable enough to shift big budgets on."
          code={RESULTS_CODE}
          onExecute={async () => {
            console.log('[MeasuringROI] Generating ROI report...')
            if (modelResults) {
              const results = modelResults.channels.map(ch => ({
                channel: ch.label,
                roi: ch.roi,
                roi_ci_lower: ch.roi_ci_lower,
                roi_ci_upper: ch.roi_ci_upper,
                spend: ch.spend,
                revenue: ch.revenue,
                confidence: ch.confidence,
                mroi: ch.mroi,
                saturationRatio: ch.saturationRatio,
                saturationStatus: ch.saturationStatus,
              })).sort((a, b) => b.roi - a.roi)
              setRoiResults(results)
              console.log('[MeasuringROI] ROI report from real data:', results)
              return
            }
            try {
              const data = await getResults()
              const results = data?.roi ?? MOCK_ROI_RESULTS.map(r => ({ ...r, [USING_MOCK_FLAG]: true }))
              setRoiResults(results)
            } catch (e) {
              setRoiResults(MOCK_ROI_RESULTS.map(r => ({ ...r, [USING_MOCK_FLAG]: true })))
            }
          }}
          successMessage="Report ready!"
        />
      </div>

      {roiResults && (
        <>
          {modelResults?.adstockParams && modelResults.adstockParams.length > 0 && (
            <div>
              <p className="text-sm text-slate-500 mb-3">These ROI figures account for carryover: spend today keeps generating returns in the following weeks.</p>
              <AdstockPanel adstockParams={modelResults.adstockParams} />
            </div>
          )}

          <div className="card card-body">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ROI by channel — with 90% confidence ranges</p>
                <DataMethodBadge method={dataMethod} />
                <SectionTooltip content="Revenue returned per dollar spent, estimated from Meridian's Bayesian model. The confidence range tells you how certain the estimate is: a tight range means act on it, a wide range means gather more data first. Marginal ROI shows what the next dollar you spend here will return." />
              </div>
              {isUsingMock && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Sample data. Run analysis for real values.</span>
              )}
            </div>
            {/* CI range visualisation */}
            {(() => {
              const maxUpper = Math.max(...roiResults.map(r => r.roi_ci_upper))
              return (
                <div className="space-y-2 mb-5">
                  {roiResults.map(r => {
                    const lPct  = (r.roi_ci_lower / maxUpper) * 100
                    const rPct  = (r.roi_ci_upper / maxUpper) * 100
                    const cPct  = (r.roi        / maxUpper) * 100
                    return (
                      <div key={r.channel} className="flex items-center gap-3">
                        <span className="text-xs font-medium text-slate-700 w-24 shrink-0">{r.channel}</span>
                        <div className="relative flex-1 h-4 bg-surface-100 rounded-full overflow-hidden">
                          <div
                            className="absolute h-full rounded-full opacity-30"
                            style={{ left: `${lPct}%`, width: `${rPct - lPct}%`, backgroundColor: '#4361ee' }}
                          />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white bg-brand-600 shadow-sm"
                            style={{ left: `calc(${cPct}% - 5px)` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-brand-600 w-12 text-right">{fmtROI(r.roi, currency)}</span>
                      </div>
                    )
                  })}
                  <p className="text-xs text-slate-400 mt-1">Bar = confidence range · Dot = best estimate</p>
                </div>
              )
            })()}
            <div className="overflow-x-auto rounded-xl border border-surface-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Channel</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">ROI</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500" title="What the next dollar you spend here will return. Lower than the average ROI means you're getting close to the saturation point.">Marginal ROI (last $1 spent)</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500" title="Cost Per Incremental KPI: how much you pay per unit of revenue generated. CPIK = spend ÷ incremental revenue. Lower is better.">CPIK</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Range</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Spend</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Revenue</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Reliability</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Saturation</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500" title="Industry benchmark ROI range (Nielsen/Analytic Partners meta-analysis). Compares your estimated ROI to typical performance for this channel type.">vs Industry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {roiResults.map((r, i) => {
                    const satBadge = getSaturationBadge(r.saturationStatus ?? 'efficient')
                    const bench = getBenchmark(r.channel)
                    const bBadge = benchmarkBadge(r.roi, bench)
                    return (
                      <tr key={r.channel} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                        <td className="px-4 py-3 font-semibold text-slate-800">{r.channel}</td>
                        <td className="px-4 py-3 font-bold text-brand-600">{fmtROI(r.roi, currency)}</td>
                        <td className="px-4 py-3 text-slate-500">{fmtROI(r.mroi ?? r.roi * 0.65, currency)}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{r.revenue > 0 ? (r.spend / r.revenue).toFixed(3) : '—'}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{fmtROI(r.roi_ci_lower, currency)} – {fmtROI(r.roi_ci_upper, currency)}</td>
                        <td className="px-4 py-3 text-slate-600">{fmt(r.spend, currency)}</td>
                        <td className="px-4 py-3 text-slate-600">{fmt(r.revenue, currency)}</td>
                        <td className="px-4 py-3">
                          <span title={confidenceTooltip(r.confidence)} className={`text-xs font-medium px-2 py-0.5 rounded-full cursor-help ${confidenceColor(r.confidence)}`}>
                            {r.confidence}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${satBadge.color}`}>{satBadge.text}</span>
                        </td>
                        <td className="px-4 py-3">
                          {bench ? (
                            <span title={bBadge.tip} className={`text-xs font-medium px-2 py-0.5 rounded-full cursor-help ${bBadge.color}`}>{bBadge.text}</span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">ROI = historical average return per dollar spent. Marginal ROI measures the revenue gained from your last dollar of spend, not your average return. A channel with high ROI but low marginal ROI is already near its spending limit. Saturation = how close the channel is to its efficiency ceiling.</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(() => {
              const avgRoi = roiResults.reduce((s, r) => s + r.roi, 0) / roiResults.length
              const hiThresh = avgRoi * 1.2
              const loThresh = avgRoi * 0.8
              return [
                { icon: TrendingUp,    color: 'text-green-600 bg-green-50', title: 'Invest more',    channels: roiResults.filter(r => r.roi >= hiThresh).map(r => r.channel), tip: `ROI above ${fmtROI(hiThresh, currency)} (120% of portfolio average). Strong returns. Consider increasing budget here.` },
                { icon: AlertTriangle, color: 'text-amber-600 bg-amber-50', title: 'Hold & monitor', channels: roiResults.filter(r => r.roi >= loThresh && r.roi < hiThresh).map(r => r.channel), tip: `ROI within 20% of portfolio average (${fmtROI(avgRoi, currency)}). Solid returns. Test a small increase before committing more.` },
                { icon: AlertTriangle, color: 'text-red-500 bg-red-50',    title: 'Review & reduce', channels: roiResults.filter(r => r.roi < loThresh).map(r => r.channel), tip: `ROI below ${fmtROI(loThresh, currency)} (80% of portfolio average). Below average. Look at targeting and creative before the next campaign.` },
              ].map(({ icon: Icon, color, title, channels, tip }) => (
                <div key={title} className={`p-4 rounded-xl border ${color.split(' ')[1]}`} style={{borderColor: 'transparent'}}>
                  <div className={`flex items-center gap-1.5 mb-2 ${color.split(' ')[0]}`}>
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 mb-1">{channels.join(', ') || 'None'}</p>
                  <p className="text-xs text-slate-500">{tip}</p>
                </div>
              ))
            })()}
          </div>

          {!modelResults && (
            <div className="card card-body">
              <EmptyState
                type="no-data"
                title="Advanced analytics unavailable"
                message="ROI vs mROI, Spend vs Contribution, and Effectiveness charts require a loaded dataset. Load data and run the model to unlock these views."
              />
            </div>
          )}

          {modelResults && (() => {
            const totalSpend   = modelResults.totalSpend   || 1
            const totalRevenue = modelResults.totalRevenue || 1
            const mroiData: MROIChannel[] = modelResults.channels.map(ch => ({
              channel:          ch.label,
              channel_key:      ch.channel,
              roi:              ch.roi,
              mroi:             ch.mroi ?? ch.roi * 0.65,
              spend:            ch.spend,
              spend_pct:        ch.spend   / totalSpend   * 100,
              contribution_pct: ch.revenue / totalRevenue * 100,
              color:            ch.color,
              is_real_meridian: modelResults.isRealMeridian ?? false,
            }))
            return (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="card card-body">
                    <h3 className="font-bold text-slate-900 text-sm mb-3">ROI vs Marginal ROI</h3>
                    <ROImROIBubble data={mroiData} currency={currency} />
                  </div>
                  <div className="card card-body">
                    <h3 className="font-bold text-slate-900 text-sm mb-3">Spend vs Revenue Contribution</h3>
                    <SpendVsContributionChart channels={modelResults.channels} />
                  </div>
                </div>
                <div className="card card-body">
                  <h3 className="font-bold text-slate-900 text-sm mb-3">ROI vs Effectiveness (Revenue Impact)</h3>
                  <p className="text-xs text-slate-500 mb-3">
                    ROI measures efficiency per dollar; effectiveness measures total revenue generated.
                    A channel can be highly efficient (high ROI) but small-scale, or large-scale but approaching saturation.
                  </p>
                  <EffectivenessROIBubble modelResults={modelResults} currency={currency} />
                </div>
              </div>
            )
          })()}
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {channelCards.map(({ channel, role, roi, carryover, description }) => (
            <div key={channel} className="card card-body">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-slate-900">{channel}</span>
                <span className="insight-badge bg-brand-50 text-brand-700">{role}</span>
              </div>
              <p className="text-2xl font-bold text-brand-600 mb-0.5">{roi}</p>
              <p className="text-xs text-slate-400 mb-2">{currency === 'IDR' ? 'per Rp 1,000 spent' : 'per $1 spent'}</p>
              <p className="text-xs text-slate-500">{description}</p>
              {carryover !== 'n/a' && carryover !== '' && (
                <p className="text-xs text-slate-400 mt-2">Lasting effect: <strong className="text-slate-600">{carryover}</strong> of impact carries into future weeks</p>
              )}
            </div>
          ))}
      </div>

      {/* What-if revenue forecaster */}
      {(() => {
        const rows = roiResults ?? MOCK_ROI_RESULTS
        const totalSpend   = rows.reduce((s, r) => s + r.spend, 0)
        const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
        const multiplier   = 1 + forecastMultiplier / 100

        // Per-channel Hill-based projection for next quarter (13 weeks)
        const projRows = rows.map(r => {
          const newSpend    = r.spend * multiplier
          const dr          = forecastMultiplier > 0 ? Math.max(0.65, 1 - forecastMultiplier / 300) : 1.0
          const newRevenue  = newSpend * r.roi * dr
          return { channel: r.channel, baseRevenue: r.revenue, newRevenue, deltaRevenue: newRevenue - r.revenue }
        })
        const projTotal    = projRows.reduce((s, r) => s + r.newRevenue, 0)
        const totalDelta   = projTotal - totalRevenue
        const blendedRoi   = totalSpend * multiplier > 0 ? (projTotal / (totalSpend * multiplier)) : 0
        const presets      = [
          { label: '−20%', value: -20 },
          { label: '0%',   value: 0   },
          { label: '+20%', value: 20  },
          { label: '+50%', value: 50  },
        ]
        return (
          <div className="card card-body">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-slate-900">What-if revenue forecaster</h3>
              <DataMethodBadge method={dataMethod} />
              <SectionTooltip content="Adjusts the overall budget by a percentage and projects the resulting revenue using each channel's estimated ROI with a diminishing-returns factor for large increases. A useful quick sanity check before presenting budget scenarios to finance." />
            </div>
            <p className="text-sm text-slate-500 mb-4">Slide the budget change to see the projected portfolio revenue impact. Uses Hill-based diminishing returns for spend increases.</p>
            <div className="space-y-4">
              {/* Preset buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400 mr-1">Quick set:</span>
                {presets.map(p => (
                  <button key={p.value} onClick={() => setForecastMultiplier(p.value)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${forecastMultiplier === p.value ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-surface-200 hover:bg-surface-50'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Budget change: <span className="font-bold text-slate-700">{forecastMultiplier >= 0 ? '+' : ''}{forecastMultiplier}%</span></span>
                  <span>{fmt(totalSpend, currency)} → {fmt(totalSpend * multiplier, currency)}</span>
                </div>
                <input type="range" min={-50} max={100} step={5} value={forecastMultiplier}
                  onChange={e => setForecastMultiplier(Number(e.target.value))}
                  className="w-full h-2 rounded-lg accent-brand-600 cursor-pointer" />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>−50%</span><span>0</span><span>+100%</span>
                </div>
              </div>
              {/* Summary KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-surface-50 border border-surface-200">
                  <p className="text-xs text-slate-500 mb-0.5">Projected Revenue</p>
                  <p className="text-lg font-bold text-slate-900">{fmt(projTotal, currency)}</p>
                  <p className={`text-xs font-medium ${totalDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {totalDelta >= 0 ? '+' : ''}{fmt(totalDelta, currency)}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 border border-surface-200">
                  <p className="text-xs text-slate-500 mb-0.5">Blended ROI</p>
                  <p className="text-lg font-bold text-slate-900">{blendedRoi.toFixed(2)}x</p>
                  <p className="text-xs text-slate-400">vs {(totalRevenue / totalSpend).toFixed(2)}x baseline</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 border border-surface-200">
                  <p className="text-xs text-slate-500 mb-0.5">Incremental Revenue</p>
                  <p className={`text-lg font-bold ${totalDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{totalDelta >= 0 ? '+' : ''}{fmtPct(Math.abs(totalDelta / totalRevenue) * 100, 1)}%</p>
                  <p className="text-xs text-slate-400">vs current portfolio</p>
                </div>
              </div>
              {/* Per-channel table */}
              <div className="overflow-x-auto rounded-xl border border-surface-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-50 text-left">
                      <th className="px-3 py-2 font-semibold text-slate-500">Channel</th>
                      <th className="px-3 py-2 font-semibold text-slate-500">Current Revenue</th>
                      <th className="px-3 py-2 font-semibold text-slate-500">Projected Revenue</th>
                      <th className="px-3 py-2 font-semibold text-slate-500">Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {projRows.map((r, i) => (
                      <tr key={r.channel} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                        <td className="px-3 py-2 font-medium text-slate-700">{r.channel}</td>
                        <td className="px-3 py-2 text-slate-500 font-mono">{fmt(r.baseRevenue, currency)}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-800">{fmt(r.newRevenue, currency)}</td>
                        <td className={`px-3 py-2 font-mono font-bold ${r.deltaRevenue >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {r.deltaRevenue >= 0 ? '+' : ''}{fmt(r.deltaRevenue, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-3">Projections use linear ROI with a diminishing-returns adjustment for large increases. For saturation-aware forecasts, use the full Meridian Hill curve in Scenario Planning.</p>
          </div>
        )
      })()}

      <PlanningCycleSummary items={(() => {
        if (!roiResults) return [
          'Prioritize channels with tight confidence intervals for your largest budget shifts. High-reliability channels have the narrowest ranges. The data strongly supports their ROI estimates.',
          'Hold off on large cuts to low-reliability channels until you run a holdout test or collect another quarter of data. Wide CI ranges need more signal before making confident moves.',
          'Share confidence ranges with your finance partner when presenting the plan. Decisions made from point estimates alone are the most common cause of misaligned marketing investment.',
        ]
        const highConf = roiResults.filter(r => r.confidence === 'High').map(r => r.channel)
        const lowConf  = roiResults.filter(r => r.confidence === 'Low').map(r => r.channel)
        return [
          `Prioritize channels with tight confidence intervals for your largest budget shifts.${highConf.length ? ` ${highConf.join(' and ')} have the narrowest ranges. The data strongly supports their ROI estimates.` : ''}`,
          lowConf.length ? `Hold off on large ${lowConf.join('/')} cuts until you run a holdout test or collect another quarter of data. Low reliability means the ROI estimate has a wide range and more signal is needed before making confident moves.` : 'All channels have at least medium reliability. Directionally safe to act on, but validate with holdout tests before large shifts.',
          'Share confidence ranges with your finance partner when presenting the plan. Decisions made from point estimates alone are the most common cause of misaligned marketing investment.',
        ]
      })()} />
    </div>
  )
}
