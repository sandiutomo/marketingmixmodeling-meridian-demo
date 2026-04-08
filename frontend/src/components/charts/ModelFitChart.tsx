'use client'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { ModelFitResult } from '@/lib/types'

interface Props {
  data: ModelFitResult
  currency?: 'USD' | 'IDR'
}

function fmt(v: number, currency: 'USD' | 'IDR'): string {
  if (currency === 'IDR') {
    if (v >= 1e12) return `Rp${(v / 1e12).toFixed(1)}T`
    if (v >= 1e9)  return `Rp${(v / 1e9).toFixed(1)}B`
    if (v >= 1e6)  return `Rp${(v / 1e6).toFixed(1)}M`
    return `Rp${v.toLocaleString()}`
  }
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

// Show every Nth label to avoid crowding
function tickInterval(n: number): number {
  if (n <= 26) return 3
  if (n <= 52) return 7
  if (n <= 104) return 13
  return Math.ceil(n / 8)
}

function shortDate(iso: string): string {
  // "2022-01-03" → "Jan '22"
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  } catch {
    return iso
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null
  const ci_lower   = payload.find((p: { dataKey: string }) => p.dataKey === 'ci_lower')?.value ?? 0
  const ci_upper   = payload.find((p: { dataKey: string }) => p.dataKey === 'ci_upper')?.value ?? 0
  const actual     = payload.find((p: { dataKey: string }) => p.dataKey === 'actual')?.value
  const predicted  = payload.find((p: { dataKey: string }) => p.dataKey === 'predicted')?.value

  return (
    <div
      className="px-3 py-2 text-xs rounded shadow-sm"
      style={{ background: 'var(--color-parchment)', border: '1px solid var(--color-sage-border)' }}
    >
      <p className="font-semibold mb-1" style={{ color: 'var(--color-deep-olive)' }}>{label}</p>
      {actual !== undefined && (
        <p style={{ color: 'var(--color-deep-olive)' }}>
          Actual: <span className="font-medium">{fmt(actual, currency)}</span>
        </p>
      )}
      {predicted !== undefined && (
        <p style={{ color: 'var(--color-orange)' }}>
          Predicted: <span className="font-medium">{fmt(predicted, currency)}</span>
        </p>
      )}
      {ci_lower !== undefined && ci_upper !== undefined && (
        <p style={{ color: 'var(--color-sage-placeholder)' }}>
          90% CI: {fmt(ci_lower, currency)} – {fmt(ci_upper, currency)}
        </p>
      )}
    </div>
  )
}

export default function ModelFitChart({ data, currency = 'USD' }: Props) {
  if (!data.weeks.length) {
    return (
      <div className="flex items-center justify-center h-48 text-xs" style={{ color: 'var(--color-sage-placeholder)' }}>
        Run the model to see actual vs predicted revenue.
      </div>
    )
  }

  const rows = data.weeks.map((w, i) => ({
    week:      shortDate(w),
    actual:    data.actual[i] ?? 0,
    predicted: data.predicted[i] ?? 0,
    ci_lower:  data.ci_lower[i] ?? 0,
    ci_upper:  data.ci_upper[i] ?? 0,
    // ci_band is the range [lower, upper] used by Area
    ci_band:   [data.ci_lower[i] ?? 0, data.ci_upper[i] ?? 0] as [number, number],
  }))

  const n        = rows.length
  const interval = tickInterval(n)

  // Compute R² for inline annotation
  const mean_actual  = rows.reduce((s, r) => s + r.actual, 0) / n
  const ss_tot       = rows.reduce((s, r) => s + (r.actual - mean_actual) ** 2, 0)
  const ss_res       = rows.reduce((s, r) => s + (r.actual - r.predicted) ** 2, 0)
  const r2           = ss_tot > 0 ? Math.max(0, Math.min(1, 1 - ss_res / ss_tot)) : 0
  const r2Label      = `R² = ${(r2 * 100).toFixed(1)}%`

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs font-medium" style={{ color: 'var(--color-muted-olive)' }}>
          Weekly revenue: actual vs model-predicted
        </span>
        <div className="flex items-center gap-1.5">
          <span
            title={`R² (R-squared) measures how well the model explains your revenue. ${r2 >= 0.7 ? `${(r2 * 100).toFixed(0)}% is a strong fit — the model captures most of the week-to-week revenue patterns.` : r2 >= 0.5 ? `${(r2 * 100).toFixed(0)}% is moderate. The model explains roughly half the revenue variation. Adding more historical data or seasonality controls often improves this.` : `${(r2 * 100).toFixed(0)}% means the model is not yet explaining most of the revenue variation. Try extending the date range, adding a holdout, or including seasonality controls.`} A score above 70% is the target for confident budget decisions.`}
            className="text-xs px-2 py-0.5 rounded font-medium cursor-help"
            style={{
              background: r2 >= 0.7 ? 'var(--color-sage-cream)' : '#fff8f0',
              color: r2 >= 0.7 ? 'var(--color-deep-olive)' : 'var(--color-orange)',
              border: '1px solid var(--color-sage-border)',
            }}
          >
            {r2Label} fit
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-light-sage)" vertical={false} />

          <XAxis
            dataKey="week"
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            interval={interval}
            angle={n > 52 ? -30 : 0}
            textAnchor={n > 52 ? 'end' : 'middle'}
            height={n > 52 ? 36 : 20}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => fmt(v, currency)}
            width={68}
          />

          <Tooltip content={<CustomTooltip currency={currency} />} />

          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value: string) =>
              value === 'actual' ? 'Actual revenue'
              : value === 'predicted' ? 'Model predicted'
              : '90% CI'
            }
          />

          {/* Confidence interval shaded area */}
          <Area
            type="monotone"
            dataKey="ci_upper"
            stroke="transparent"
            fill="var(--color-orange)"
            fillOpacity={0.08}
            legendType="none"
            name="ci_upper"
            dot={false}
            activeDot={false}
          />
          <Area
            type="monotone"
            dataKey="ci_lower"
            stroke="transparent"
            fill="var(--color-parchment)"
            fillOpacity={1}
            legendType="none"
            name="ci_lower"
            dot={false}
            activeDot={false}
          />

          {/* Actual revenue line */}
          <Line
            type="monotone"
            dataKey="actual"
            name="actual"
            stroke="var(--color-deep-olive)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />

          {/* Model-predicted line */}
          <Line
            type="monotone"
            dataKey="predicted"
            name="predicted"
            stroke="var(--color-orange)"
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="space-y-1">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-sage-placeholder)' }}>
          <strong style={{ color: 'var(--color-muted-olive)' }}>Shaded band</strong> = the range the model is 90% confident the true revenue falls within. A tight band means high confidence; a wide band means the model is less certain about that period.
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-sage-placeholder)' }}>
          {data.is_real_meridian
            ? 'Predicted line comes from the real Meridian MCMC posterior: thousands of simulated revenue scenarios averaged together. When the predicted line tracks the actual line closely, it confirms the model has learned your campaign patterns well.'
            : 'Predicted line is estimated using correlation-based attribution. Run the full Meridian model to get a posterior-backed prediction with proper Bayesian confidence bands.'}
        </p>
        {(() => {
          const mean_a = rows.reduce((s, r) => s + r.actual, 0) / rows.length
          const ss_t   = rows.reduce((s, r) => s + (r.actual - mean_a) ** 2, 0)
          const ss_r   = rows.reduce((s, r) => s + (r.actual - r.predicted) ** 2, 0)
          const r2v    = ss_t > 0 ? Math.max(0, Math.min(1, 1 - ss_r / ss_t)) : 0
          const r2pct  = (r2v * 100).toFixed(0)
          const msg    = r2v >= 0.7
            ? `R2 = ${r2pct}% — strong fit. The model explains most revenue variation, so the channel ROI estimates on the next page are well-supported.`
            : r2v >= 0.5
            ? `R2 = ${r2pct}% — moderate fit. The model explains roughly half the revenue variation. ROI estimates are directionally useful, but consider adding more data or seasonality controls to tighten them.`
            : `R2 = ${r2pct}% — low fit. The predicted line is missing a lot of the actual revenue pattern. Budget decisions based on these estimates carry more uncertainty. Extend the date range or add control variables to improve this before acting on the numbers.`
          return (
            <p className="text-xs px-2.5 py-1.5 rounded-lg leading-relaxed" style={{ background: r2v >= 0.7 ? 'var(--color-sage-cream)' : '#fff8f0', color: r2v >= 0.7 ? 'var(--color-deep-olive)' : 'var(--color-orange)', border: '1px solid var(--color-sage-border)' }}>
              {msg}
            </p>
          )
        })()}
      </div>
    </div>
  )
}
