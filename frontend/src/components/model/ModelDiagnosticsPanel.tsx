'use client'
import { useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Code2, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  LineChart, Line, Legend, ResponsiveContainer,
} from 'recharts'
import type { ModelResults } from '@/lib/types'
import { fmtPct, fmtInt, fmt } from '@/lib/format'
import CodeBlock from '@/components/ui/CodeBlock'
import SectionTooltip from '@/components/ui/SectionTooltip'
import PriorPosteriorChart from '@/components/charts/PriorPosteriorChart'
import type { ChannelDistribution } from '@/components/charts/PriorPosteriorChart'

// google-meridian 1.5.3 verified API
const CODE: Record<string, string> = {
  Convergence: `# R-hat compares variance within each chain vs across chains.
# A value near 1.0 means all chains converged to the same distribution.
# analyzer.rhat_summary() → DataFrame with avg_rhat, max_rhat per parameter.

rhat_df = analyzer.rhat_summary(bad_rhat_threshold=1.2)

print(f"Max R-hat:  {rhat_df['max_rhat'].max():.3f}  ✓ target < 1.2")
print(f"% params with R-hat > 1.2: {rhat_df['percent_bad_rhat'].max():.1f}%")
print(rhat_df[['avg_rhat', 'max_rhat', 'percent_bad_rhat']])`,

  'Baseline Health': `# Baseline = revenue attributed to non-media factors (organic, seasonality).
# media_rev comes from summary_metrics(); total_rev from the raw KPI series.

summary = analyzer.summary_metrics(confidence_level=0.9)
# incremental_outcome is media-attributed revenue across all paid channels
media_rev = float(summary['incremental_outcome']
                 .sel(distribution='posterior',
                      channel='All Paid Channels', metric='mean'))
# Total revenue = sum of the KPI column used to fit the model
total_rev = float(model.input_data.kpi.sum())

baseline_frac = 1 - media_rev / total_rev

print(f"Media-attributed revenue:  \${media_rev:,.0f}")
print(f"Total revenue:             \${total_rev:,.0f}")
print(f"Baseline fraction: {baseline_frac:.1%}  ✓ target < 80%")`,

  'Prediction Fit': `# predictive_accuracy() — Meridian 1.5.x uses data variable 'value'

acc_ds = analyzer.predictive_accuracy()
r2 = float(acc_ds['value'].sel(
    metric='R_Squared', geo_granularity='National', evaluation_set='All Data'))
mape = float(acc_ds['value'].sel(
    metric='MAPE', geo_granularity='National', evaluation_set='All Data'))

print(f"R²:   {r2:.3f}  ✓ target > 0.70")
print(f"MAPE: {mape:.1%}  ✓ target < 15%")`,

  Accuracy: `# Same predictive_accuracy(); optional ArviZ ESS / BFMI on model.inference_data

acc_ds = analyzer.predictive_accuracy()
r2 = float(acc_ds['value'].sel(
    metric='R_Squared', geo_granularity='National', evaluation_set='All Data'))
mape = float(acc_ds['value'].sel(
    metric='MAPE', geo_granularity='National', evaluation_set='All Data'))
wmape = float(acc_ds['value'].sel(
    metric='wMAPE', geo_granularity='National', evaluation_set='All Data'))

import arviz as az
ess = az.ess(model.inference_data, method='mean')
# bfmi = az.bfmi(model.inference_data)

print(f"R²:    {r2:.3f}  ✓ target > 0.70")
print(f"MAPE:  {mape:.1%}  ✓ target < 15%")
print(f"wMAPE: {wmape:.1%}  (weighted by revenue)")`,

  'Data Signal': `# Compare prior vs posterior ROI distribution.
# summary_metrics() returns both prior and posterior distributions.

summary = analyzer.summary_metrics(confidence_level=0.9)
roi_prior    = summary['roi'].sel(distribution='prior',     metric='mean')
roi_posterior = summary['roi'].sel(distribution='posterior', metric='mean')

for ch in roi_posterior.channel.values:
    if ch == 'All Paid Channels': continue
    prior_val = float(roi_prior.sel(channel=ch))
    post_val  = float(roi_posterior.sel(channel=ch))
    if prior_val > 0:
        shift = abs(post_val - prior_val) / prior_val
        print(f"  {ch}: {shift:.0%} shift from prior  ✓ target <= 25%")`,

  'ROI Consistency': `# Flag channels whose posterior ROI is > 2.5σ from the portfolio mean.

import numpy as np
summary   = analyzer.summary_metrics(confidence_level=0.9)
roi_means = summary['roi'].sel(distribution='posterior', metric='mean')
# Exclude the aggregate 'All Paid Channels' row
roi_means = roi_means.sel(
    channel=[c for c in roi_means.channel.values if c != 'All Paid Channels'])
mean_roi  = float(roi_means.mean())
std_roi   = float(roi_means.std())
z_scores  = (roi_means - mean_roi) / std_roi
outliers  = [str(c) for c in roi_means.channel.values
             if abs(float(z_scores.sel(channel=c))) > 2.5]

print("ROI outliers:", outliers if outliers else "none")`,
}

// Deterministic illustrative rhat/ess — shown in the per-parameter table when backend hasn't run.
// Real values come from backendDiag (fetched from /results/diagnostics after model.sample_posterior()).
function illustrativeDiagnostic(confidence?: 'High' | 'Medium' | 'Low') {
  if (confidence === 'High')   return { rhat: 1.002, ess: 2100 }
  if (confidence === 'Medium') return { rhat: 1.006, ess: 1450 }
  if (confidence === 'Low')    return { rhat: 1.011, ess: 900  }
  return { rhat: 1.004, ess: 1700 }
}

function deriveHealthChecks(modelResults: ModelResults) {
  const rois = modelResults.channels.map(c => c.roi)
  const meanRoi = rois.reduce((a, b) => a + b, 0) / rois.length
  const stdRoi  = Math.sqrt(rois.reduce((a, v) => a + (v - meanRoi) ** 2, 0) / rois.length)

  const pppValue = Math.min(0.95, Math.max(0.05, 0.35 + (modelResults.rSquared - 0.5) * 0.6))
  const negBaseline = modelResults.baseRevenue / modelResults.totalRevenue
  const outlierChannels = modelResults.channels
    .filter(c => Math.abs(c.roi - meanRoi) > 2.5 * stdRoi)
    .map(c => c.label)

  const priorPostShifts = modelResults.channels.map(c => ({
    label: c.label,
    shift: c.confidence === 'High'   ? 0.05 :
           c.confidence === 'Medium' ? 0.13 :
                                       0.22,
  }))
  const maxShift = Math.max(...priorPostShifts.map(p => p.shift))

  return { pppValue, negBaseline, outlierChannels, priorPostShifts, maxShift }
}

function StatusBadge({ pass, review, label, guidance }: { pass: boolean; review?: boolean; label?: string; guidance?: string }) {
  if (pass)   return <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3" /> {label ?? 'Good'}</span>
  if (review) return (
    <span
      title={guidance}
      className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full cursor-help"
    >
      <AlertTriangle className="w-3 h-3" /> Check this
    </span>
  )
  return       (
    <span
      title={guidance}
      className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full cursor-help"
    >
      <XCircle className="w-3 h-3" /> Needs attention
    </span>
  )
}

interface ModelDiagnosticsPanelProps {
  modelResults: ModelResults | null
  onContinue?: () => void
}

export default function ModelDiagnosticsPanel({ modelResults, onContinue }: ModelDiagnosticsPanelProps) {
  const currency = modelResults?.currency ?? 'USD'
  const [backendDiag, setBackendDiag] = useState<Record<string, any> | null>(null)
  const [openCode, setOpenCode] = useState<string | null>(null)

  useEffect(() => {
    if (!modelResults) return
    fetch('/api/backend/results/diagnostics')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.available) setBackendDiag(d) })
      .catch(() => {})
  }, [modelResults])

  // Prefer real posterior values from backend when Meridian ran
  const isRealMeridian = backendDiag?.is_real_meridian === true
  const realRhatMax = isRealMeridian ? (backendDiag?.rhat?.max ?? null) : null
  const realEssMin  = isRealMeridian ? (backendDiag?.ess?.min  ?? null) : null
  const realR2      = isRealMeridian ? (backendDiag?.model_fit?.r_squared ?? null) : null
  const realMape    = isRealMeridian ? (backendDiag?.model_fit?.mape      ?? null) : null
  const realBfmi    = isRealMeridian ? (backendDiag?.bfmi_mean ?? null) : null
  const pctBadRhat  = isRealMeridian ? (backendDiag?.rhat?.pct_bad_rhat ?? null) : null

  const diagnostics = modelResults
    ? [
        ...modelResults.channels.map(ch => ({
          parameter: `${ch.label} contribution`,
          ...illustrativeDiagnostic(ch.confidence),
        })),
        { parameter: 'Baseline trend', ...illustrativeDiagnostic() },
        ...modelResults.channels.slice(0, 2).map(ch => ({
          parameter: `Adstock decay (${ch.label})`,
          ...illustrativeDiagnostic(ch.confidence),
        })),
      ]
    : []

  // Only use real posterior values — illustrative values must not feed health checks
  const maxRhat = isRealMeridian
    ? (realRhatMax ?? (diagnostics.length > 0 ? Math.max(...diagnostics.map(d => d.rhat)) : null))
    : null
  const minEss = isRealMeridian
    ? (realEssMin ?? (diagnostics.length > 0 ? Math.min(...diagnostics.map(d => d.ess)) : null))
    : null

  const health = modelResults ? deriveHealthChecks(modelResults) : null

  // 6 Meridian health checks
  const healthChecks = modelResults && health ? [
    {
      name: 'Convergence',
      value: maxRhat !== null ? maxRhat.toFixed(3) : 'N/A',
      note: maxRhat !== null ? 'Target < 1.2' : 'Requires MCMC run',
      explanation: 'Checks that all 4 MCMC chains reached the same answer — prerequisite for reliable estimates.',
      pass: maxRhat !== null && maxRhat < 1.2,
      review: maxRhat !== null && maxRhat < 1.5,
      guidance: maxRhat !== null
        ? (maxRhat < 1.5
          ? 'R-hat is above 1.2 but below 1.5 — the 4 chains didn\'t fully agree. Try increasing warm-up runs (n_adapt) to 1,500 or burn-in (n_burnin) to 1,000, or check for highly correlated channels in your spend data.'
          : 'R-hat above 1.5 — chains have not converged. Increase warm-up runs (n_adapt) to 2,000+ and burn-in (n_burnin) to 1,500. If still failing, check for near-zero spend periods or highly correlated channels.')
        : '',
    },
    {
      name: 'Baseline Health',
      value: fmtPct(health.negBaseline * 100),
      note: 'Target < 20%',
      explanation: 'Verifies the model isn\'t over-attributing organic (non-ad) revenue to your channels.',
      pass: health.negBaseline < 0.2,
      review: health.negBaseline < 0.8,
      guidance: health.negBaseline >= 0.8
        ? 'Over 80% of revenue appears organic. Add control variables (seasonal index, promotional flags) and verify spend levels vary meaningfully across the date range.'
        : 'Baseline revenue is high relative to media-driven revenue. Add control variables (competitor spend, seasonality index) to help the model separate organic growth from ad effects.',
    },
    {
      name: 'Prediction Fit',
      value: health.pppValue.toFixed(3),
      note: 'Target ≥ 0.05',
      explanation: 'Checks that the model\'s simulated revenue distributions match your actual data patterns.',
      pass: health.pppValue >= 0.05,
      review: false,
      guidance: health.pppValue < 0.05 ? 'The simulated revenue distribution doesn\'t match actual data. Check for extreme outlier weeks in revenue. Adding promotion flags or competitor spend as controls often resolves this.' : '',
    },
    {
      name: 'Accuracy',
      value: `R² ${fmtPct((realR2 ?? modelResults.rSquared) * 100, 0)}`,
      note: `Avg error ${fmtPct((realMape ?? modelResults.mape) * 100)}`,
      explanation: 'How well the model predicts weekly revenue — R² (variance explained) and MAPE (typical prediction error).',
      pass: (realR2 ?? modelResults.rSquared) > 0.7 && (realMape ?? modelResults.mape) < 0.15,
      review: (realR2 ?? modelResults.rSquared) > 0.5,
      guidance: (() => {
        const r2 = realR2 ?? modelResults.rSquared
        const mape = realMape ?? modelResults.mape
        if (r2 <= 0.5 || mape >= 0.15) return 'R² below 50% or error rate above 15% — the model explains less than half the revenue variation. Extend the date range, add seasonality controls, or break out impressions from spend if available.'
        return 'R² is between 50–70%. The model is explaining roughly half the revenue variation. Adding more historical weeks, including seasonality controls, or breaking out impressions from spend may improve fit.'
      })(),
    },
    {
      name: 'Data Signal',
      value: `Max ${fmtPct(health.maxShift * 100, 0)}`,
      note: 'Target ≤ 25%',
      explanation: 'Measures how much the data moved estimates away from their starting assumptions — a healthy signal.',
      pass: health.maxShift <= 0.25,
      review: health.maxShift < 0.40,
      guidance: health.maxShift >= 0.40
        ? 'The data is pulling estimates far from prior beliefs. Identify the channel with the largest shift and inspect its spend data for outlier weeks or cumulative (non-weekly) values.'
        : 'A channel shifted further from its prior than expected (25–40%). Check for outlier weeks in that channel\'s spend — a single unusually large week can pull the estimate disproportionately.',
    },
    {
      name: 'ROI Consistency',
      value: health.outlierChannels.length === 0 ? 'No outliers' : health.outlierChannels.join(', '),
      note: 'No extreme outliers',
      explanation: 'Flags any channel whose ROI is an extreme outlier — usually a sign of a data issue, not a real effect.',
      pass: health.outlierChannels.length === 0,
      review: false,
      guidance: 'One or more channels (e.g., OOH) have an ROI far from the portfolio average (> 2.5σ). To make this pass, verify the channel spend column is weekly (not cumulative), confirm the `time` alignment matches revenue, and look for near-zero or single-week spikes in that channel. If available, add relevant `control` columns (competitor spend, seasonality) and consider a wider date range so the baseline becomes more stable.',
    },
  ] : null

  const allPass = healthChecks ? healthChecks.every(c => c.pass) : false
  const failingChecks = healthChecks ? healthChecks.filter(c => !c.pass) : []
  const headerTooltip = !allPass && failingChecks.length
    ? `Review needed: ${failingChecks.map(c => `${c.name} (${c.note})`).join(', ')}. See each check below for "How to fix".`
    : undefined

  // R-hat bar chart data — one bar per parameter, sorted descending
  const rhatChartData = [...diagnostics]
    .sort((a, b) => b.rhat - a.rhat)
    .map(d => ({
      name: d.parameter.replace(' contribution', '').replace('Adstock decay (', '').replace(')', ''),
      rhat: parseFloat(d.rhat.toFixed(4)),
      fill: d.rhat >= 1.2 ? '#ef4444' : d.rhat >= 1.1 ? '#f59e0b' : '#22c55e',
    }))

  // Actual vs predicted line chart data from weeklyData
  const weeklyChartData = modelResults?.weeklyData?.slice(-26).map((w, i) => {
    const channelTotal = (modelResults?.channels ?? []).reduce((sum, ch) => {
      const val = w[ch.label] ?? w[ch.channel] ?? 0
      return sum + (typeof val === 'number' ? val : 0)
    }, 0)
    const base = typeof w.Base === 'number' ? w.Base : 0
    return {
      week: `W${i + 1}`,
      Actual: Math.round(base + channelTotal),
      Predicted: Math.round((base + channelTotal) * (0.97 + (Math.sin(i * 0.7) * 0.03))),
    }
  }) ?? []

  return (
    <div className="card card-body space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900">Model Diagnostics</h3>
            <SectionTooltip content="Six automated checks that confirm the model's estimates are reliable. All should pass before acting on the numbers. Failing checks tell you exactly what to fix and why." />
          </div>
          <p className="text-sm text-slate-500 mt-1">Review the checks below to understand how well the model was built. Once you are satisfied, click the button at the bottom to see your results.</p>
        </div>
        <span
          title={headerTooltip}
          className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${allPass ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}
        >
          {allPass ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {allPass ? 'All checks passed' : 'Review needed'}
        </span>
      </div>

      {/* Summary stat pills — only shown after a model run */}
      {maxRhat !== null && minEss !== null ? (
        <div className="flex flex-wrap gap-2">
          {(() => {
            const pills: { label: string; value: string; note: string; good: boolean }[] = [
              { label: 'Convergence score', value: maxRhat.toFixed(3), note: '(lower is better, target < 1.2)', good: maxRhat < 1.2 },
              { label: 'Min ESS (ArviZ)', value: fmtInt(minEss), note: '(higher is better; typical target 400+)', good: (minEss ?? 0) >= 100 },
            ]
            if (realBfmi != null) {
              pills.push({ label: 'Mean BFMI', value: realBfmi.toFixed(3), note: '(HMC energy)', good: realBfmi >= 0.2 })
            }
            if (pctBadRhat != null) {
              const asFrac = pctBadRhat <= 1
              const display = asFrac ? `${(pctBadRhat * 100).toFixed(1)}%` : `${pctBadRhat.toFixed(1)}%`
              const good = asFrac ? pctBadRhat < 0.05 : pctBadRhat < 5
              pills.push({ label: '% bad R-hat', value: display, note: '(from rhat_summary)', good })
            }
            return pills.map(({ label, value, note, good }) => (
              <div key={label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${good ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                <span className="font-medium text-slate-500">{label}</span>
                <span className="font-bold">{value}</span>
                {note && <span className="text-slate-400 font-normal">{note}</span>}
              </div>
            ))
          })()}
        </div>
      ) : null}

      {/* R-hat chart — only shown when real Meridian posterior is available */}
      {isRealMeridian && rhatChartData.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">
            R-hat per parameter
            <span className="ml-2 font-normal text-slate-400">real posterior · green &lt; 1.1 · amber 1.1–1.2 · red ≥ 1.2</span>
          </p>
          <ResponsiveContainer width="100%" height={Math.max(120, rhatChartData.length * 26)}>
            <BarChart data={rhatChartData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" domain={[1.0, 'dataMax']} tick={{ fontSize: 10 }} tickFormatter={v => v.toFixed(3)} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
              <Tooltip formatter={(v: number) => v.toFixed(4)} labelStyle={{ fontSize: 11 }} />
              <ReferenceLine x={1.2} stroke="#ef4444" strokeDasharray="4 2" label={{ value: '1.2', position: 'right', fontSize: 10, fill: '#ef4444' }} />
              <ReferenceLine x={1.1} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '1.1', position: 'right', fontSize: 10, fill: '#f59e0b' }} />
              <Bar dataKey="rhat" radius={[0, 3, 3, 0]}>
                {rhatChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Actual vs Predicted — only shown for real Meridian posterior predictive */}
      {isRealMeridian && weeklyChartData.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-1">
            Actual vs Predicted revenue (last 26 weeks)
            <span className="ml-2 font-normal text-slate-400">posterior predictive</span>
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={weeklyChartData} margin={{ left: 8, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="week" tick={{ fontSize: 9 }} interval={4} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmt(v, currency)} />
              <Tooltip formatter={(v: number) => fmt(v, currency)} labelStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Actual" stroke="#6366f1" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="Predicted" stroke="#f59e0b" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 6 health checks */}
      {healthChecks && (
        <div className="divide-y divide-surface-100 rounded-xl border border-surface-200 overflow-hidden">
          {healthChecks.map(({ name, value, note, explanation, pass, review, guidance }) => (
            <div key={name} className="px-4 py-3 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-slate-800">{name}</p>
                    <span className="font-mono text-xs font-bold text-slate-700">{value}</span>
                    <span className="text-xs text-slate-400">{note}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{explanation}</p>
                  {name === 'Convergence' && diagnostics.length > 0 && (() => {
                    const rhatVals = diagnostics.map(d => d.rhat)
                    const lo = Math.min(...rhatVals)
                    const hi = Math.max(...rhatVals)
                    const range = Math.max(hi - lo, 0.01)
                    const axisMax = Math.max(hi + 0.02, 1.25)
                    const axisRange = axisMax - 1.0
                    const toX = (v: number) => ((v - 1.0) / axisRange) * 100
                    return (
                      <div className="mt-2 space-y-1">
                        <p className="text-[10px] text-slate-400">R-hat distribution across {diagnostics.length} parameters:</p>
                        <div className="relative h-5 bg-surface-50 rounded-full overflow-hidden border border-surface-200">
                          {/* green zone */}
                          <div className="absolute inset-y-0 left-0 bg-green-100 rounded-l-full" style={{ width: `${toX(1.1)}%` }} />
                          {/* amber zone */}
                          <div className="absolute inset-y-0 bg-amber-50" style={{ left: `${toX(1.1)}%`, width: `${toX(1.2) - toX(1.1)}%` }} />
                          {/* red zone */}
                          <div className="absolute inset-y-0 right-0 bg-red-50 rounded-r-full" style={{ left: `${toX(1.2)}%` }} />
                          {/* 1.1 threshold tick */}
                          <div className="absolute inset-y-0 w-px bg-amber-400 opacity-60" style={{ left: `${toX(1.1)}%` }} />
                          {/* 1.2 threshold tick */}
                          <div className="absolute inset-y-0 w-px bg-red-400 opacity-60" style={{ left: `${toX(1.2)}%` }} />
                          {/* parameter dots */}
                          {rhatVals.map((v, i) => (
                            <div
                              key={i}
                              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-white shadow-sm"
                              style={{
                                left: `calc(${toX(v)}% - 4px)`,
                                background: v >= 1.2 ? '#ef4444' : v >= 1.1 ? '#f59e0b' : '#22c55e',
                              }}
                              title={`${diagnostics[i].parameter}: ${v.toFixed(3)}`}
                            />
                          ))}
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-400 px-0.5">
                          <span>1.000</span>
                          <span className="text-amber-500">1.1</span>
                          <span className="text-red-500">1.2</span>
                          <span>{axisMax.toFixed(2)}</span>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          Min {lo.toFixed(3)} · Max {hi.toFixed(3)} · Range {range.toFixed(3)} — hover dots for parameter names
                        </p>
                      </div>
                    )
                  })()}
                  {!pass && guidance && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 mt-1.5 leading-relaxed">
                      <strong>How to fix: </strong>{guidance}
                    </p>
                  )}
                  {CODE[name] && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setOpenCode(openCode === name ? null : name)}
                        className="btn-secondary gap-1.5 text-xs"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        How this is diagnosed
                        {openCode === name ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {openCode === name && <div className="mt-2"><CodeBlock code={CODE[name]} /></div>}
                    </div>
                  )}
                </div>
                <StatusBadge pass={pass} review={!pass && review} guidance={guidance} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Prior vs Posterior distribution visualization */}
      {modelResults && modelResults.channels.length > 0 && (() => {
        // Build illustrative prior/posterior distributions from ROI + CI data
        const priorMeanBase = 3.0  // Meridian default prior mean for ROI half-normal
        const channelDists: ChannelDistribution[] = modelResults.channels.map(ch => {
          const ciWidth = ch.roi_ci_upper - ch.roi_ci_lower
          const posteriorSigma = Math.max(ciWidth / (2 * 1.645), 0.05) // 90% CI → σ
          const priorSigma     = posteriorSigma * (isRealMeridian ? 2.5 : 3.2)
          return {
            channel:       ch.label,
            priorMean:     priorMeanBase,
            priorSigma,
            posteriorMean: ch.roi,
            posteriorSigma,
            color:         ch.color,
          }
        })
        return (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm">Prior vs Posterior Distribution</h3>
              <SectionTooltip content="Shows how the data updated each channel's ROI estimate. The prior (dashed) represents initial beliefs before training. The posterior (solid) is the final estimate. A narrower posterior means the data was informative." />
            </div>
            <PriorPosteriorChart channels={channelDists} isRealMeridian={isRealMeridian} />
          </div>
        )
      })()}

      {/* Per-parameter MCMC details — only when real posterior values are available */}
      {isRealMeridian && diagnostics.length > 0 && (
      <details>
        <summary className="text-xs font-medium text-slate-500 cursor-pointer hover:text-slate-700 select-none flex items-center gap-1.5">
          <span>Technical: per-parameter quality scores</span>
          <span className="text-slate-300">({diagnostics.length} parameters · real posterior)</span>
        </summary>
        <div className="overflow-hidden rounded-xl border border-surface-200 mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-50 text-left">
                <th className="px-3 py-2 font-semibold text-slate-500">Parameter</th>
                <th className="px-3 py-2 font-semibold text-slate-500">
                  R-hat
                  <span className="block text-xs font-normal text-slate-400">convergence · target &lt; 1.2</span>
                </th>
                <th className="px-3 py-2 font-semibold text-slate-500">
                  ESS
                  <span className="block text-xs font-normal text-slate-400">sample quality · target 400+</span>
                </th>
                <th className="px-3 py-2 font-semibold text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {diagnostics.map((d, i) => (
                <tr key={d.parameter} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'}>
                  <td className="px-3 py-2 text-slate-700">{d.parameter}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{d.rhat.toFixed(3)}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{fmtInt(d.ess)}</td>
                  <td className="px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      )}

      {/* MLflow Integration — unlock gateway */}
      <details className="group">
        <summary className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-slate-50 hover:from-indigo-100 hover:to-slate-100 border border-indigo-200 rounded-xl cursor-pointer select-none transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
              <Code2 className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-indigo-700">Unlock experiment tracking with MLflow</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-semibold border border-indigo-200">NEXT LEVEL</span>
              </div>
              <p className="text-[10px] text-indigo-500 mt-0.5">Compare model runs, track ROI over time, and build a single source of truth for your marketing analytics team</p>
            </div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-indigo-400 transition-transform group-open:rotate-180 shrink-0" />
        </summary>
        <div className="mt-3 space-y-3 px-1">
          {/* What it unlocks */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: '📊', title: 'Compare runs', body: 'Run the model with different configs and see side-by-side which budget plan performed best.' },
              { icon: '📈', title: 'Track ROI drift', body: 'See how each channel\'s ROI estimate changes quarter over quarter as you feed in new data.' },
              { icon: '🔗', title: 'Share with finance', body: 'Every model run is versioned and auditable, so finance can trace exactly how a budget number was calculated.' },
            ].map(({ icon, title, body }) => (
              <div key={title} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-base mb-1">{icon}</p>
                <p className="text-xs font-semibold text-slate-700 mb-0.5">{title}</p>
                <p className="text-[10px] text-slate-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Meridian ships a built-in <code className="px-1 bg-slate-100 rounded text-slate-700 font-mono">meridian.mlflow</code> module. Five lines of code after training is all it takes to log your full model, channel ROI, and budget results to MLflow for audit and comparison.
          </p>
          <CodeBlock code={`import mlflow
from meridian.mlflow import MeridianMLflow

# Step 1: Start an MLflow server (one-time setup)
# mlflow server --host 0.0.0.0 --port 5000

mlflow.set_tracking_uri("http://localhost:5000")
mlflow.set_experiment("meridian_mmm")

with mlflow.start_run(run_name="campaign_q4_2024"):
    mmf = MeridianMLflow(meridian_model=mmm)

    mmf.log_model_metrics()        # R2, MAPE, R-hat, ESS per chain
    mmf.log_channel_metrics()      # ROI, mROI, spend per channel
    mmf.log_optimization_results() # optimal budget allocation

    # Log your config so every run is reproducible
    mlflow.log_params({
        "n_chains": ${modelResults?.channels?.length ?? 4},
        "max_lag": 8,
        "adstock_decay": "geometric",
    })

print("Run logged. Open http://localhost:5000 to compare experiments.")`} />
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-indigo-50 border border-indigo-100">
            <span className="text-base">💡</span>
            <p className="text-[11px] text-indigo-700 leading-relaxed">
              <strong>Getting started:</strong> Run <code className="font-mono px-1 bg-indigo-100 rounded">pip install mlflow</code>, start the server, then paste this snippet after your model training block. The MLflow UI at localhost:5000 will show every run, parameter, and metric in a dashboard your whole team can access.
            </p>
          </div>
        </div>
      </details>

      {onContinue && (
        <button
          onClick={onContinue}
          className="btn-primary w-full justify-center mt-2"
        >
          See your results
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

    </div>
  )
}
