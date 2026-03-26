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
  opportunity: { icon: TrendingUp,    bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', badge: 'bg-green-100 text-green-700' },
  warning:     { icon: AlertTriangle, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  info:        { icon: Lightbulb,     bg: 'bg-blue-50',  border: 'border-blue-200',  text: 'text-blue-700',  badge: 'bg-blue-100 text-blue-700'  },
}
const LABELS = { opportunity: 'Opportunity', warning: 'Watch out', info: 'Insight' }

type OptimizedItem = { label: string; spendChange: number; spendChangePct: number; optimalSpend: number }

function buildInsights(modelResults: ModelResults | null, optimized?: OptimizedItem[] | null): Insight[] {
  if (!modelResults) {
    return [
      { id: '1', type: 'opportunity', title: 'Run the analysis to see insights', description: 'Complete model configuration and run the analysis to get channel-specific recommendations based on your data.', channel: undefined },
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
    description: `For every ${currency === 'IDR' ? 'Rp 1,000' : '$1'} you spend on ${top.label}, the model attributes ${fmtROI(top.roi, currency)} in revenue — ${fmtPct((top.roi / avg - 1) * 100, 0)} above your portfolio average of ${fmtROI(avg, currency)}.`,
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
      description: `${bottom.label}'s ${fmtROI(bottom.roi, currency)} ROI is ${fmtPct((1 - bottom.roi / avg) * 100, 0)} below the portfolio average. Adding more budget here produces less impact than other channels.`,
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
      description: `${lowConf.label}'s ROI estimate has a wide range (${fmtROI(lowConf.roi_ci_lower, currency)}–${fmtROI(lowConf.roi_ci_upper, currency)}). That means there isn't enough data yet to pin down the number precisely. Hold off on large budget moves for this channel until more data comes in.`,
      channel: lowConf.label,
    })
  }

  const highConf = sorted.find(ch => ch.confidence === 'High' && ch !== top)
  if (highConf) {
    insights.push({
      id: '4',
      type: 'info',
      title: `${highConf.label} estimates are highly reliable`,
      description: `${highConf.label}'s ${fmtROI(highConf.roi, currency)} ROI has a narrow range (${fmtROI(highConf.roi_ci_lower, currency)}–${fmtROI(highConf.roi_ci_upper, currency)}), which means the data consistently backs this number. You can act on it with confidence when planning budget changes.`,
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
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-slate-900">Key Insights & Recommendations</h3>
        <span className="text-xs text-slate-400">{items.length} {items.length === 1 ? 'finding' : 'findings'}</span>
      </div>
      {items.map((insight) => {
        const { icon: Icon, bg, border, text, badge } = TYPE_CONFIG[insight.type]
        return (
          <div key={insight.id} className={`px-4 py-3 ${bg} border ${border} rounded-xl`}>
            <div className="flex items-start gap-3">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${text}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`insight-badge ${badge}`}>{LABELS[insight.type]}</span>
                  {insight.channel && <span className="insight-badge bg-slate-100 text-slate-600">{insight.channel}</span>}
                  {insight.impact && <span className="text-xs font-medium text-slate-500">{insight.impact}</span>}
                </div>
                <p className={`font-semibold text-sm ${text}`}>{insight.title}</p>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{insight.description}</p>
                {insight.action && <p className="text-xs text-slate-500 mt-1 italic">{insight.action}</p>}
                {INSIGHT_CODE[insight.id] && (
                  <details className="mt-2">
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">how this is built</summary>
                    <CodeBlock code={INSIGHT_CODE[insight.id]} />
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
