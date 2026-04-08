'use client'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Label,
} from 'recharts'
import type { ModelResults } from '@/lib/types'
import { fmt } from '@/lib/format'

interface Props {
  modelResults: ModelResults
  currency?: 'USD' | 'IDR'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, currency }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null

  return (
    <div
      className="px-3 py-2 text-xs rounded shadow-sm space-y-1"
      style={{
        background: 'var(--color-parchment)',
        border: '1px solid var(--color-sage-border)',
        minWidth: 160,
      }}
    >
      <p className="font-semibold" style={{ color: 'var(--color-deep-olive)' }}>{d.label}</p>
      <p style={{ color: 'var(--color-muted-olive)' }}>
        ROI: <span className="font-medium">{d.roi.toFixed(2)}x</span>
      </p>
      <p style={{ color: 'var(--color-orange)' }}>
        Effectiveness: <span className="font-medium">{fmt(d.revenue, currency)}</span>
      </p>
      <p style={{ color: 'var(--color-muted-olive)' }}>
        Spend: <span className="font-medium">{fmt(d.spend, currency)}</span>
      </p>
      <p className="text-[10px] pt-0.5 border-t border-slate-200 mt-1" style={{ color: 'var(--color-sage-placeholder)' }}>
        {d.roi >= d.portfolioRoi && d.revenue >= d.avgRevenue
          ? 'High efficiency + high impact — scale carefully'
          : d.roi >= d.portfolioRoi
          ? 'Efficient but small — strong ROI, limited budget'
          : d.revenue >= d.avgRevenue
          ? 'High impact but diminishing — near saturation'
          : 'Under-performing — review before next cycle'}
      </p>
    </div>
  )
}

const MIN_R = 8
const MAX_R = 36

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BubbleDot(props: any) {
  const { cx, cy, payload } = props
  const r = payload.bubbleR  // recharts doesn't auto-map bubbleR to r; read from payload directly
  return (
    <g>
      <circle
        cx={cx} cy={cy} r={r}
        fill={payload.color} fillOpacity={0.75}
        stroke={payload.color} strokeWidth={1.5}
      />
      {r >= 16 && (
        <text
          x={cx} y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 9, fill: '#fff', fontWeight: 600, pointerEvents: 'none' }}
        >
          {payload.label.split(' ')[0]}
        </text>
      )}
    </g>
  )
}

export default function EffectivenessROIBubble({ modelResults, currency = 'USD' }: Props) {
  const { channels, portfolioRoi } = modelResults

  const maxSpend = Math.max(...channels.map(c => c.spend), 1)
  const avgRevenue = channels.reduce((s, c) => s + c.revenue, 0) / (channels.length || 1)

  const rows = channels.map(ch => ({
    label:       ch.label,
    roi:         ch.roi,
    revenue:     ch.revenue,
    spend:       ch.spend,
    color:       ch.color,
    portfolioRoi,
    avgRevenue,
    bubbleR: MIN_R + (MAX_R - MIN_R) * Math.sqrt(ch.spend / maxSpend),
  }))

  const maxRoi     = Math.ceil(Math.max(...channels.map(c => c.roi)) * 1.25)
  const maxRevenue = Math.max(...channels.map(c => c.revenue)) * 1.15

  if (!channels.length) {
    return (
      <div className="flex items-center justify-center h-48 text-xs" style={{ color: 'var(--color-sage-placeholder)' }}>
        Run the model to see effectiveness analysis.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium" style={{ color: 'var(--color-muted-olive)' }}>
        ROI vs Revenue Contribution — bubble size = spend
      </p>
      <p className="text-[11px]" style={{ color: 'var(--color-sage-placeholder)' }}>
        High ROI + high revenue = star channels. High revenue + low ROI = saturated. High ROI + low revenue = underfunded.
      </p>

      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 16, right: 24, bottom: 48, left: 64 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-light-sage)" />

          <XAxis
            type="number"
            dataKey="roi"
            domain={[0, maxRoi]}
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v.toFixed(1)}x`}
            label={{ value: 'ROI (efficiency)', position: 'insideBottom', offset: -32, style: { fontSize: 10, fill: 'var(--color-muted-olive)' } }}
          />

          <YAxis
            type="number"
            dataKey="revenue"
            domain={[0, maxRevenue]}
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={v => {
              if (currency === 'IDR') {
                if (v >= 1e9) return `Rp${(v / 1e9).toFixed(1)}B`
                if (v >= 1e6) return `Rp${(v / 1e6).toFixed(1)}M`
                return `Rp${v.toLocaleString()}`
              }
              if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
              if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
              return `$${v.toFixed(0)}`
            }}
            label={{ value: 'Revenue driven', angle: -90, position: 'insideLeft', offset: -48, style: { fontSize: 10, fill: 'var(--color-muted-olive)' } }}
          />

          <Tooltip content={<CustomTooltip currency={currency} />} />

          {/* Portfolio ROI threshold */}
          <ReferenceLine
            x={portfolioRoi}
            stroke="var(--color-deep-olive)"
            strokeDasharray="3 2"
            strokeOpacity={0.45}
            label={{ value: `Portfolio avg ${portfolioRoi.toFixed(1)}x`, position: 'top', fontSize: 9, fill: 'var(--color-muted-olive)' }}
          />

          {/* Average revenue threshold */}
          <ReferenceLine
            y={avgRevenue}
            stroke="var(--color-deep-olive)"
            strokeDasharray="3 2"
            strokeOpacity={0.45}
            label={{ value: 'Avg revenue', position: 'right', fontSize: 9, fill: 'var(--color-muted-olive)' }}
          />

          <Scatter data={rows} shape={<BubbleDot />} />
        </ScatterChart>
      </ResponsiveContainer>

      <div className="flex gap-4 text-[10px]" style={{ color: 'var(--color-sage-placeholder)' }}>
        <span>Bubble size = spend</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 opacity-40" style={{ background: 'var(--color-deep-olive)' }} />
          Portfolio averages
        </span>
      </div>
    </div>
  )
}
