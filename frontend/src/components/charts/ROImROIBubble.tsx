'use client'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Label,
} from 'recharts'
import type { MROIChannel } from '@/lib/types'

interface Props {
  data: MROIChannel[]
  currency?: 'USD' | 'IDR'
}

function fmtSpend(v: number, currency: 'USD' | 'IDR'): string {
  if (currency === 'IDR') {
    if (v >= 1e9) return `Rp${(v / 1e9).toFixed(1)}B`
    if (v >= 1e6) return `Rp${(v / 1e6).toFixed(1)}M`
    return `Rp${v.toLocaleString()}`
  }
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

const MIN_BUBBLE = 8
const MAX_BUBBLE = 36

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, currency }: any) {
  if (!active || !payload?.length) return null
  const d: MROIChannel = payload[0]?.payload
  if (!d) return null

  const satStatus = d.mroi < d.roi * 0.55
    ? { label: 'Saturated', color: '#dc2626' }
    : d.mroi < d.roi * 0.80
    ? { label: 'Efficient', color: '#d97706' }
    : { label: 'Room to grow', color: '#16a34a' }

  return (
    <div
      className="px-3 py-2 text-xs rounded shadow-sm space-y-1"
      style={{ background: 'var(--color-parchment)', border: '1px solid var(--color-sage-border)', minWidth: 160 }}
    >
      <p className="font-semibold" style={{ color: 'var(--color-deep-olive)' }}>{d.channel}</p>
      <p style={{ color: 'var(--color-muted-olive)' }}>ROI: <span className="font-medium">{d.roi.toFixed(2)}x</span></p>
      <p style={{ color: 'var(--color-orange)' }}>mROI: <span className="font-medium">{d.mroi.toFixed(2)}x</span></p>
      <p style={{ color: 'var(--color-muted-olive)' }}>Spend: <span className="font-medium">{fmtSpend(d.spend, currency)}</span></p>
      <p>
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{ background: satStatus.color + '15', color: satStatus.color }}
        >
          {satStatus.label}
        </span>
      </p>
    </div>
  )
}

// Custom dot renderer — size encodes spend; label inside
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BubbleDot(props: any) {
  const { cx, cy, payload } = props
  const d: MROIChannel = payload
  const r = payload.bubbleR  // recharts doesn't auto-map bubbleR to r; read from payload directly
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={d.color} fillOpacity={0.75} stroke={d.color} strokeWidth={1.5} />
      {r >= 16 && (
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: 9, fill: '#fff', fontWeight: 600, pointerEvents: 'none' }}>
          {d.channel.split(' ')[0]}
        </text>
      )}
    </g>
  )
}

export default function ROImROIBubble({ data, currency = 'USD' }: Props) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-48 text-xs" style={{ color: 'var(--color-sage-placeholder)' }}>
        Run the model to see ROI vs mROI analysis.
      </div>
    )
  }

  // Scale bubble size by spend
  const maxSpend = Math.max(...data.map(d => d.spend), 1)
  const rows = data.map(d => ({
    ...d,
    bubbleR: MIN_BUBBLE + (MAX_BUBBLE - MIN_BUBBLE) * Math.sqrt(d.spend / maxSpend),
  }))

  const portfolioROI  = data.reduce((s, d) => s + d.roi * d.spend, 0) / (data.reduce((s, d) => s + d.spend, 0) || 1)
  const portfolioMROI = data.reduce((s, d) => s + d.mroi * d.spend, 0) / (data.reduce((s, d) => s + d.spend, 0) || 1)

  const maxAxis = Math.ceil(Math.max(...data.map(d => Math.max(d.roi, d.mroi))) * 1.2)

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted-olive)' }}>
            ROI vs Marginal ROI — bubble size = spend
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-sage-placeholder)' }}>
            Channels below the diagonal are approaching saturation — their last dollar returns less than average.
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 16, right: 16, bottom: 32, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-light-sage)" />

          <XAxis
            type="number"
            dataKey="roi"
            domain={[0, maxAxis]}
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v.toFixed(1)}x`}
          >
            <Label
              value="Average ROI"
              offset={-8}
              position="insideBottom"
              style={{ fontSize: 10, fill: 'var(--color-muted-olive)' }}
            />
          </XAxis>
          <YAxis
            type="number"
            dataKey="mroi"
            domain={[0, maxAxis]}
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v.toFixed(1)}x`}
          >
            <Label
              value="Marginal ROI (last $1)"
              angle={-90}
              position="insideLeft"
              offset={12}
              style={{ fontSize: 10, fill: 'var(--color-muted-olive)' }}
            />
          </YAxis>

          <Tooltip content={<CustomTooltip currency={currency} />} />

          {/* Diagonal — mROI = ROI (equilibrium) */}
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: maxAxis, y: maxAxis }]}
            stroke="var(--color-sage-border)"
            strokeDasharray="4 3"
            label={{ value: 'mROI = ROI', position: 'insideTopLeft', fontSize: 9, fill: 'var(--color-sage-placeholder)' }}
          />

          {/* Portfolio averages */}
          <ReferenceLine
            x={portfolioROI}
            stroke="var(--color-deep-olive)"
            strokeDasharray="3 2"
            strokeOpacity={0.4}
          />
          <ReferenceLine
            y={portfolioMROI}
            stroke="var(--color-deep-olive)"
            strokeDasharray="3 2"
            strokeOpacity={0.4}
          />

          <Scatter
            data={rows}
            shape={<BubbleDot />}
            // Recharts passes r via the shape but we control it via bubbleR field:
            // overriding with a custom shape ignores the built-in radius system
          />
        </ScatterChart>
      </ResponsiveContainer>

      <div className="flex gap-4 text-[10px]" style={{ color: 'var(--color-sage-placeholder)' }}>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-px border-t border-dashed" style={{ borderColor: 'var(--color-sage-border)' }} />
          Diagonal: mROI = ROI
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 opacity-40" style={{ background: 'var(--color-deep-olive)' }} />
          Portfolio averages
        </span>
        <span>Bubble size = spend</span>
      </div>
    </div>
  )
}
