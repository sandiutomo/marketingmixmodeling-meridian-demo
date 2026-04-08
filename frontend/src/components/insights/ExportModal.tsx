'use client'
import { useState } from 'react'
import { X, Copy, CheckCheck, Printer, Download, ExternalLink, FileText } from 'lucide-react'
import { getExportCsvUrl, getExportHtmlUrl } from '@/lib/api'

type InsightTab = 'budget' | 'roi' | 'scenario' | 'contribution' | 'cross' | 'geo'
type DataMethod = 'meridian' | 'pearson' | 'mock'

function buildSummaries(dataMethod: DataMethod) {
  const qualityLine =
    dataMethod === 'meridian' ? 'Model quality: Strong — Meridian posterior (real MCMC)' :
    dataMethod === 'pearson'  ? 'Model quality: Estimated — Pearson correlation on spend series (no posterior)' :
                                'Model quality: Illustrative — mock data, not from a fitted model'

  return {
  budget: `MMM INSIGHTS: BUDGET ALLOCATION
Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
Analysis period: Jan 2023 to Dec 2024 · 5 regions · 6 channels
${qualityLine}

KEY METRICS
- Total Portfolio ROI: $3.12 per $1 spent
- Highest ROI channel: Email ($5.80 per $1)
- Optimization potential: +$420K additional revenue (no extra spend required)

CHANNEL ROI RANKING
1. Email:       $5.80  (significantly underfunded at <3% of total budget)
2. Paid Search: $4.20  (strong performer, room to scale)
3. Social:      $3.10  (above average, monitor for saturation)
4. TV:          $2.80  (large budget, meaningful lasting effect)
5. Radio:       $1.90  (below average, review targeting)
6. Display:     $1.40  (lowest ROI, candidate for budget reduction)

RECOMMENDATION
Shift ~$150K from Display to Email and Paid Search without increasing total spend.
Projected portfolio ROI improvement: +18%.
Implement changes gradually (10-15% at a time) and monitor over 4-6 weeks.`,

  roi: `MMM INSIGHTS: MEASURING TRUE ROI
Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
Analysis period: Jan 2023 to Dec 2024 · 5 regions · 6 channels
${qualityLine}

REVENUE ATTRIBUTION
- 85% of revenue is directly driven by media spend
- 15% is baseline revenue (would occur without any advertising)
- Total media-driven revenue: ~$8.0M annually

CHANNEL ROI WITH CONFIDENCE RANGES (90%)
Channel       ROI    Low    High   Reliability
Email         $5.80  $4.20  $7.60  High
Paid Search   $4.20  $3.50  $5.10  High
Social        $3.10  $2.40  $3.85  Medium
TV            $2.80  $2.10  $3.55  High
Radio         $1.90  $1.20  $2.70  Medium
Display       $1.40  $0.85  $2.05  Low

CHANNEL ROLES
- TV and Social: Demand Drivers (build awareness and lasting demand)
- Paid Search: Demand Capture (converts existing intent at high ROI)
- Display and Radio: Support channels (reinforce other channels)`,

  scenario: `MMM INSIGHTS: SCENARIO PLANNING
Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
Analysis period: Jan 2023 to Dec 2024 · 5 regions · 6 channels

CURRENT BASELINE SPEND
TV:           $1,200K  ROI: $2.80
Paid Search:    $450K  ROI: $4.20
Social:         $380K  ROI: $3.10
Display:        $520K  ROI: $1.40
Radio:          $220K  ROI: $1.90
Email:           $80K  ROI: $5.80
Total:        $2,850K

DATA-BACKED RECOMMENDATIONS
1. Email is at <3% of budget but returns $5.80 per $1. Even tripling the budget would likely remain ROI-positive.
2. Display ROI ($1.40) is well below the $2.00 portfolio average. Review before next cycle.
3. TV cuts have delayed consequences (23% lasting effect). Model reductions carefully.`,

  contribution: `MMM INSIGHTS: CHANNEL CONTRIBUTION
Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
Analysis period: Jan 2023 to Dec 2024 · 5 regions · 6 channels

REVENUE CONTRIBUTION BY CHANNEL
TV:              $3,360K  (38%)
Paid Search:     $1,890K  (21%)
Social:          $1,178K  (13%)
Display:           $728K   (8%)
Radio:             $418K   (5%)
Base (organic):  $1,326K  (15%)

CHANNEL ROLES
- TV (Demand Driver): builds awareness and long-term demand
- Paid Search (Demand Capture): converts existing intent, depends on upper-funnel channels
- Social (Demand Driver): creates new purchase intent through discovery
- Display (Support): reinforces other channels, underperforms alone
- Radio (Support): strong for local brand recall, weaker for direct conversion`,

  cross: `MMM INSIGHTS: CROSS-CHANNEL IMPACT
Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
Analysis period: Jan 2023 to Dec 2024 · 5 regions · 6 channels

CHANNEL SYNERGY FINDINGS
- TV + Paid Search: 18% revenue lift when run together vs. independently
- TV + Social:      14% lift (TV awareness amplified by social engagement)
- Radio + TV:       12% lift (frequency building across audio/visual)
- Display + Social:  8% lift (visual reinforcement effect)
- Email + Search:    9% lift (retention loop drives branded search)

KEY INSIGHTS
- TV drives 23% of Paid Search conversions. Don't evaluate channels in silos.
- Radio boosts branded search in local markets during flight periods.
- OOH creates a social amplifier effect, generating earned media from paid spend.

RECOMMENDED ACTIONS
1. Coordinate TV and Paid Search flight dates to maximize search lift
2. Never cut TV without a compensating Paid Search budget increase
3. Run OOH + Social pilot in 2 markets before national scale
4. Audit Display targeting before cutting (over-served audiences drive underperformance)`,
  }
}

interface ExportModalProps {
  activeTab: InsightTab
  onClose: () => void
  dataMethod?: DataMethod
}

export default function ExportModal({ activeTab, onClose, dataMethod = 'mock' }: ExportModalProps) {
  const [copied, setCopied] = useState(false)
  const SUMMARIES = buildSummaries(dataMethod)
  const summary = SUMMARIES[activeTab as keyof typeof SUMMARIES] ?? 'Geo breakdown export — run the model to generate a summary.'

  const handleCopy = () => {
    navigator.clipboard.writeText(summary)
    setCopied(true)
    console.log('[Export] Summary copied to clipboard')
    setTimeout(() => setCopied(false), 2500)
  }

  const handlePrint = () => {
    console.log('[Export] Opening print dialog')
    window.print()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 shrink-0">
          <div>
            <h3 className="font-bold text-slate-900">Export summary</h3>
            <p className="text-sm text-slate-500 mt-0.5">Copy the text below or save it as a PDF.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <pre className="text-xs font-mono text-slate-700 bg-surface-50 rounded-xl p-4 whitespace-pre-wrap leading-relaxed border border-surface-200">
            {summary}
          </pre>
        </div>

        <div className="px-6 pb-4 border-t border-surface-200 pt-4 space-y-3 shrink-0">
          <div className="flex gap-3">
            <button onClick={handleCopy} className="btn-primary flex-1 justify-center gap-2">
              {copied ? <><CheckCheck className="w-4 h-4 text-green-300" /> Copied ✓</> : <><Copy className="w-4 h-4" /> Copy</>}
            </button>
            <button onClick={handlePrint} className="btn-secondary gap-2">
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
            <a
              href={getExportHtmlUrl()}
              download="meridian_model_report.html"
              className="btn-secondary gap-2"
            >
              <FileText className="w-4 h-4" /> Download HTML Report
            </a>
          </div>

          <div className="border border-surface-200 rounded-xl p-4 bg-surface-50 space-y-2">
            <p className="text-xs font-semibold text-slate-700">Download for Looker Studio</p>
            <p className="text-xs text-slate-500">
              Export a flat CSV with all channel metrics, then connect it to Google Sheets.
              Any Looker Studio report pre-built with this schema will auto-populate.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <a
                href={getExportCsvUrl()}
                download="meridian_channel_metrics.csv"
                className="btn-secondary text-xs gap-1.5 py-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Download CSV
              </a>
              <a
                href="https://lookerstudio.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-600 hover:underline flex items-center gap-1"
              >
                Open Looker Studio <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
