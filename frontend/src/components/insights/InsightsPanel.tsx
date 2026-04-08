'use client'
import { TrendingUp, AlertTriangle, Lightbulb } from 'lucide-react'
import type { Insight, ModelResults } from '@/lib/types'
import { fmt, fmtDelta, fmtROI, fmtPct, fmtSignedPct } from '@/lib/format'
import CodeBlock from '@/components/ui/CodeBlock'

// How each insight is derived from the Meridian posterior (google-meridian 1.5.3)
const INSIGHT_CODE: Record<string, string> = {
  '1': `# Identify top ROI channel from posterior mean
summary = analyzer.summary_metrics(confidence_level=0.9)
roi = summary['roi'].sel(distribution='posterior', metric='mean')
# Exclude the aggregate row; find the channel with highest ROI
channels = [c for c in roi.channel.values if c != 'All Paid Channels']
top_channel = max(channels, key=lambda c: float(roi.sel(channel=c)))
top_roi = float(roi.sel(channel=top_channel))
portfolio_roi = float(roi.sel(channel='All Paid Channels'))
pct_above = (top_roi / portfolio_roi - 1) * 100
print(f"{top_channel}: {top_roi:.2f}x ROI — {pct_above:.0f}% above portfolio avg")`,

  '2': `# Find the lowest-ROI channel and flag underperformance
roi = summary['roi'].sel(distribution='posterior', metric='mean')
channels = [c for c in roi.channel.values if c != 'All Paid Channels']
bottom_channel = min(channels, key=lambda c: float(roi.sel(channel=c)))
bottom_roi = float(roi.sel(channel=bottom_channel))
portfolio_roi = float(roi.sel(channel='All Paid Channels'))
pct_below = (1 - bottom_roi / portfolio_roi) * 100
# Flag if bottom ROI is more than 15% below portfolio average
if bottom_roi < portfolio_roi * 0.85:
    print(f"{bottom_channel}: {pct_below:.0f}% below avg — consider reviewing spend")`,

  '3': `# Check which channels have wide credible intervals (low confidence)
summary = analyzer.summary_metrics(confidence_level=0.9)
roi = summary['roi'].sel(distribution='posterior')
for ch in [c for c in roi.channel.values if c != 'All Paid Channels']:
    lo  = float(roi.sel(channel=ch, metric='ci_lo'))
    hi  = float(roi.sel(channel=ch, metric='ci_hi'))
    avg = float(roi.sel(channel=ch, metric='mean'))
    width = hi - lo
    # Wide interval relative to mean → low confidence estimate
    print(f"{ch}: ROI {avg:.2f}  CI [{lo:.2f}, {hi:.2f}]  width={width:.2f}")`,

  '4': `# Surface channels with narrow credible intervals (high confidence)
summary = analyzer.summary_metrics(confidence_level=0.9)
roi = summary['roi'].sel(distribution='posterior')
for ch in [c for c in roi.channel.values if c != 'All Paid Channels']:
    lo  = float(roi.sel(channel=ch, metric='ci_lo'))
    hi  = float(roi.sel(channel=ch, metric='ci_hi'))
    avg = float(roi.sel(channel=ch, metric='mean'))
    cv  = (hi - lo) / avg   # relative width; small → high confidence
    if cv < 0.4:
        print(f"{ch}: narrow CI ({lo:.2f}–{hi:.2f}) — reliable, act with confidence")`,
}

const TYPE_CONFIG = {
  opportunity: { icon: TrendingUp,    accent: 'border-l-green-400',  text: 'text-green-700' },
  warning:     { icon: AlertTriangle, accent: 'border-l-amber-400',  text: 'text-amber-700' },
  info:        { icon: Lightbulb,     accent: 'border-l-blue-400',   text: 'text-blue-600'  },
}

type OptimizedItem = { label: string; spendChange: number; spendChangePct: number; optimalSpend: number }

function buildInsights(modelResults: ModelResults | null, optimized?: OptimizedItem[] | null): Insight[] {
  if (!modelResults) {
    return [
      { id: '1', type: 'opportunity', title: 'Run the model to see insights', description: 'Complete model configuration and run the model to get channel-specific recommendations based on your data.', channel: undefined },
    ]
  }
  const currency = modelResults.currency ?? 'USD'
  const sorted = [...modelResults.channels].sort((a, b) => b.roi - a.roi)
  const top    = sorted[0]
  const bottom = sorted[sorted.length - 1]
  const avg    = modelResults.portfolioRoi
  const insights: Insight[] = []

  const topOpt    = optimized?.find(o => o.label === top.label)
  const bottomOpt = optimized?.find(o => o.label === bottom.label)

  insights.push({
    id: '1',
    type: 'opportunity',
    title: `${top.label} is your strongest ROI driver`,
    description: `${fmtROI(top.roi, currency)} per ${currency === 'IDR' ? 'Rp 1,000' : '$1'} — ${fmtPct((top.roi / avg - 1) * 100, 0)} above portfolio average.`,
    action: topOpt
      ? `The optimizer recommends ${topOpt.spendChange >= 0 ? 'increasing' : 'decreasing'} ${top.label} by ${fmt(Math.abs(topOpt.spendChange), currency)} (${fmtSignedPct(topOpt.spendChangePct, 0)})`
      : `Consider moving 10–15% of ${bottom.label} budget to ${top.label}`,
    channel: top.label,
    impact: `${fmtDelta(bottom.spend * 0.1 * (top.roi - bottom.roi), currency)} estimated additional revenue`,
  })

  if (bottom.roi < avg * 0.85) {
    insights.push({
      id: '2',
      type: 'warning',
      title: `${bottom.label} is underperforming the portfolio`,
      description: `${fmtROI(bottom.roi, currency)} per ${currency === 'IDR' ? 'Rp 1,000' : '$1'} — ${fmtPct((1 - bottom.roi / avg) * 100, 0)} below portfolio average.`,
      action: bottomOpt
        ? `The optimizer recommends ${bottomOpt.spendChange <= 0 ? 'reducing' : 'increasing'} ${bottom.label} by ${fmt(Math.abs(bottomOpt.spendChange), currency)} (${fmtSignedPct(bottomOpt.spendChangePct, 0)})`
        : `Review ${bottom.label} targeting and creative. Consider redirecting spend to higher-ROI channels.`,
      channel: bottom.label,
      impact: `Potential savings of ${fmt(bottom.spend * 0.1, currency)}/cycle if reallocated`,
    })
  }

  const lowConf = modelResults.channels.find(ch => ch.confidence === 'Low')
  if (lowConf) {
    insights.push({
      id: '3',
      type: 'warning',
      title: `${lowConf.label} needs more data for reliable estimates`,
      description: `Wide confidence range (${fmtROI(lowConf.roi_ci_lower, currency)}–${fmtROI(lowConf.roi_ci_upper, currency)}). Hold off on large shifts until more data is available.`,
      channel: lowConf.label,
    })
  }

  const highConf = sorted.find(ch => ch.confidence === 'High' && ch !== top)
  if (highConf) {
    insights.push({
      id: '4',
      type: 'info',
      title: `${highConf.label} estimates are highly reliable`,
      description: `${fmtROI(highConf.roi, currency)} ROI with tight range (${fmtROI(highConf.roi_ci_lower, currency)}–${fmtROI(highConf.roi_ci_upper, currency)}) — data consistently supports this estimate.`,
      channel: highConf.label,
    })
  }

  return insights
}

interface InsightsPanelProps {
  modelResults?: ModelResults | null
  insights?: Insight[]
  optimized?: OptimizedItem[] | null
}

export default function InsightsPanel({ modelResults, insights, optimized }: InsightsPanelProps) {
  const items = insights ?? buildInsights(modelResults ?? null, optimized)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-slate-900">Key findings</h3>
        <span className="text-xs text-slate-400">{items.length} {items.length === 1 ? 'finding' : 'findings'}</span>
      </div>
      {items.map((insight) => {
        const { icon: Icon, accent, text } = TYPE_CONFIG[insight.type]
        return (
          <div key={insight.id} className={`bg-white border border-surface-200 border-l-4 ${accent} rounded-xl px-4 py-4 shadow-sm`}>
            <div className="flex items-start gap-3">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${text}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="font-bold text-sm text-slate-900">{insight.title}</p>
                  {insight.channel && <span className="insight-badge bg-slate-100 text-slate-500">{insight.channel}</span>}
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{insight.description}</p>
                {insight.action && <p className="text-xs font-medium text-slate-500 mt-2 leading-relaxed">{insight.action}</p>}
                {insight.impact && <p className="text-xs text-slate-400 mt-1">{insight.impact}</p>}
                {INSIGHT_CODE[insight.id] && (
                  <details className="mt-2">
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">How this is calculated</summary>
                    <div className="mt-1.5">
                      <CodeBlock code={INSIGHT_CODE[insight.id]} />
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
