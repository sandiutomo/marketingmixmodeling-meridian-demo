'use client'
import { useState } from 'react'
import ContributionPieChart from '@/components/charts/ContributionPieChart'
import DiminishingReturnsChart from '@/components/charts/DiminishingReturnsChart'
import SpendResponseChart from '@/components/charts/SpendResponseChart'
import CodeExecutionButton from '@/components/model/CodeExecutionButton'
import PlanningCycleSummary from '@/components/insights/PlanningCycleSummary'
import { getResults } from '@/lib/api'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import AdstockPanel from '@/components/insights/AdstockPanel'
import MeridianBadge from '@/components/ui/MeridianBadge'
import type { ModelResults, HillChannelParams } from '@/lib/types'
import { getSaturationBadge } from '@/lib/types'
import { fmt, fmtROI } from '@/lib/format'

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
roi_mean = summary_ds["roi"].sel(distribution="posterior", metric="mean")
roi_lo   = summary_ds["roi"].sel(distribution="posterior", metric="ci_low")
roi_hi   = summary_ds["roi"].sel(distribution="posterior", metric="ci_high")

# Revenue contribution per channel (incremental_outcome = sales caused by spend)
contribution = summary_ds["incremental_outcome"].sel(
    distribution="posterior", metric="mean"
)

print(roi_mean)
print(contribution)
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

/** Generate a spend-response curve using the Hill saturation function.
 *  revenue = maxResponse × spend^slope / (ec^slope + spend^slope)
 *  Falls back to an exponential approximation if Hill params are not available.
 */
function generateCurve(
  saturation: number,
  hillParams?: HillChannelParams | null,
) {
  const points = 40
  if (hillParams && hillParams.ec && hillParams.slope && hillParams.maxResponse) {
    const { ec, slope, maxResponse } = hillParams
    const maxSpend = ec * 4  // show up to 4× the half-saturation point
    return Array.from({ length: points }, (_, j) => {
      const spend = (maxSpend / points) * (j + 1)
      const spendSlope = Math.pow(spend, slope)
      const ecSlope    = Math.pow(ec, slope)
      const response   = maxResponse * spendSlope / (ecSlope + spendSlope)
      return { spend: Math.round(spend), response: Math.round(response) }
    })
  }
  // Fallback: exponential approximation
  return Array.from({ length: points }, (_, j) => {
    const spend = (saturation / points) * (j + 1) * 3 / 2.5
    const response = saturation * (1 - Math.exp(-2.5 * spend / saturation))
    return { spend: Math.round(spend), response: Math.round(response) }
  })
}

export default function MeasuringROI({ modelResults }: { modelResults: ModelResults | null }) {
  type RoiRow = { channel: string; roi: number; roi_ci_lower: number; roi_ci_upper: number; spend: number; revenue: number; confidence: 'High' | 'Medium' | 'Low'; mroi?: number; saturationRatio?: number; saturationStatus?: 'saturated' | 'efficient' | 'room_to_grow'; __mock__?: boolean }
  const [roiResults, setRoiResults] = useState<RoiRow[] | null>(null)
  const [selectedCurveIdx, setSelectedCurveIdx] = useState(0)
  const isUsingMock = roiResults?.some(r => r[USING_MOCK_FLAG as keyof typeof r])
  const currency = modelResults?.currency ?? 'USD'

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
          carryover: halfLife ? `~${halfLife}w half-life` : '—',
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
      <div>
        <h2 className="text-2xl font-bold text-slate-900">What's actually driving your revenue?</h2>
        <p className="text-slate-500 mt-1">Break down which channels are genuinely moving the needle, meaning they drove sales that wouldn't have happened without them.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card card-body">
          <ContributionPieChart data={contributionData} currency={modelResults?.currency ?? 'USD'} isReal={modelResults?.isRealMeridian} />
          <div className="mt-4 p-4 bg-surface-50 rounded-xl">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Why it matters</p>
            {modelResults ? (() => {
              const basePct = Math.round(modelResults.baseRevenue / modelResults.totalRevenue * 100)
              const mediaPct = 100 - basePct
              return <p className="text-sm text-slate-600">{basePct}% of your revenue would happen anyway, even with zero ads. The remaining {mediaPct}% is directly driven by your media spend — that's what your advertising is actually worth.</p>
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
        const curveData = generateCurve(saturation, chHillParams)
        return (
          <div className="card card-body">
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900">Spend-Response Curves</h3>
                <MeridianBadge isReal={modelResults?.isRealMeridian} />
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
        <h3 className="font-bold text-slate-900 mb-1">Generate Full ROI Report</h3>
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
          variant="secondary"
        />
      </div>

      {roiResults && (
        <>
          <div className="card card-body">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ROI by Channel (90% confidence ranges)</p>
                <MeridianBadge isReal={modelResults?.isRealMeridian} />
              </div>
              {isUsingMock && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Sample data — run analysis for real values</span>
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
                  <p className="text-xs text-slate-400 mt-1">Bar shows 90% confidence range · Dot shows point estimate</p>
                </div>
              )
            })()}
            <div className="overflow-x-auto rounded-xl border border-surface-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Channel</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">ROI</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500" title="Return on the next dollar spent — lower than ROI means the channel is approaching saturation">mROI</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Range</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Spend</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Revenue</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Reliability</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Saturation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {roiResults.map((r, i) => {
                    const satBadge = getSaturationBadge(r.saturationStatus ?? 'efficient')
                    return (
                      <tr key={r.channel} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/50'}>
                        <td className="px-4 py-3 font-semibold text-slate-800">{r.channel}</td>
                        <td className="px-4 py-3 font-bold text-brand-600">{fmtROI(r.roi, currency)}</td>
                        <td className="px-4 py-3 text-slate-500">{fmtROI(r.mroi ?? r.roi * 0.65, currency)}</td>
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
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2">ROI = historical average return · mROI = return on the next dollar · Saturation = how close the channel is to its efficiency ceiling</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(() => {
              const avgRoi = roiResults.reduce((s, r) => s + r.roi, 0) / roiResults.length
              const hiThresh = avgRoi * 1.2
              const loThresh = avgRoi * 0.8
              return [
                { icon: TrendingUp,    color: 'text-green-600 bg-green-50', title: 'Invest more',    channels: roiResults.filter(r => r.roi >= hiThresh).map(r => r.channel), tip: `ROI above ${fmtROI(hiThresh, currency)} (120% of portfolio average). Strong returns — prioritize in next planning cycle.` },
                { icon: AlertTriangle, color: 'text-amber-600 bg-amber-50', title: 'Hold & monitor', channels: roiResults.filter(r => r.roi >= loThresh && r.roi < hiThresh).map(r => r.channel), tip: `ROI within 20% of portfolio average (${fmtROI(avgRoi, currency)}). Solid performer — test incremental budget changes before committing.` },
                { icon: AlertTriangle, color: 'text-red-500 bg-red-50',    title: 'Review & reduce', channels: roiResults.filter(r => r.roi < loThresh).map(r => r.channel), tip: `ROI below ${fmtROI(loThresh, currency)} (80% of portfolio average). Investigate targeting, creative, or audience overlap before next flight.` },
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
            {carryover !== '—' && <p className="text-xs text-slate-400 mt-2">Lasting effect: <strong className="text-slate-600">{carryover}</strong> of impact carries into future weeks</p>}
          </div>
        ))}
      </div>

      {modelResults?.adstockParams && modelResults.adstockParams.length > 0 && (
        <AdstockPanel adstockParams={modelResults.adstockParams} />
      )}

      <PlanningCycleSummary items={(() => {
        if (!roiResults) return [
          'Prioritize channels with tight confidence intervals for your largest budget shifts. High-reliability channels have the narrowest ranges — the data strongly supports their ROI estimates.',
          'Hold off on large cuts to low-reliability channels until you run a holdout test or collect another quarter of data. Wide CI ranges need more signal before making confident moves.',
          'Share confidence ranges with your finance partner when presenting the plan. Decisions made from point estimates alone are the most common cause of misaligned marketing investment.',
        ]
        const highConf = roiResults.filter(r => r.confidence === 'High').map(r => r.channel)
        const lowConf  = roiResults.filter(r => r.confidence === 'Low').map(r => r.channel)
        return [
          `Prioritize channels with tight confidence intervals for your largest budget shifts.${highConf.length ? ` ${highConf.join(' and ')} have the narrowest ranges — the data strongly supports their ROI estimates.` : ''}`,
          lowConf.length ? `Hold off on large ${lowConf.join('/')} cuts until you run a holdout test or collect another quarter of data. Low reliability means the ROI estimate has a wide range — more signal needed before making confident moves.` : 'All channels have at least medium reliability — directionally safe to act on, but validate with holdout tests before large shifts.',
          'Share confidence ranges with your finance partner when presenting the plan. Decisions made from point estimates alone are the most common cause of misaligned marketing investment.',
        ]
      })()} />
    </div>
  )
}
