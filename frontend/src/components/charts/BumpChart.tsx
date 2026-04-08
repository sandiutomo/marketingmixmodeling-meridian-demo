'use client'
/**
 * BumpChart — Channel contribution rank over time
 *
 * Mirrors Meridian's visualizer.MediaSummary.plot_channel_contribution_bump_chart()
 * Shows how each channel's revenue contribution *rank* shifts across time periods.
 * Reveals seasonal channel dynamics (e.g., TV dominates Q4; Search dominates Q2).
 */
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export interface BumpDataPoint {
  period: string
  [channel: string]: string | number
}

interface Props {
  data: BumpDataPoint[]
  channels: Array<{ key: string; label: string; color: string }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const sorted = [...payload].sort((a, b) => (a.value as number) - (b.value as number))

  return (
    <div
      className="px-3 py-2 text-xs rounded shadow-sm space-y-1 min-w-[140px]"
      style={{ background: 'var(--color-parchment)', border: '1px solid var(--color-sage-border)' }}
    >
      <p className="font-semibold pb-1 border-b border-slate-200" style={{ color: 'var(--color-deep-olive)' }}>{label}</p>
      {sorted.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          #{p.value} {p.name}
        </p>
      ))}
    </div>
  )
}

export default function BumpChart({ data, channels }: Props) {
  if (!data.length || !channels.length) {
    return (
      <div className="flex items-center justify-center h-48 text-xs" style={{ color: 'var(--color-sage-placeholder)' }}>
        Not enough data to show rank changes.
      </div>
    )
  }

  const numChannels = channels.length

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium" style={{ color: 'var(--color-muted-olive)' }}>
        Channel contribution rank over time — lower rank = higher contribution
      </p>
      <p className="text-[11px]" style={{ color: 'var(--color-sage-placeholder)' }}>
        Tracks how each channel&apos;s share of total revenue shifts across periods. A channel moving up (rank decreasing) is gaining importance.
      </p>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            reversed
            domain={[1, numChannels]}
            ticks={Array.from({ length: numChannels }, (_, i) => i + 1)}
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `#${v}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend formatter={(v) => <span style={{ fontSize: 10, color: 'var(--color-muted-olive)' }}>{v}</span>} />
          {channels.map(ch => (
            <Line
              key={ch.key}
              type="monotone"
              dataKey={ch.key}
              name={ch.label}
              stroke={ch.color}
              strokeWidth={2}
              dot={{ r: 5, fill: ch.color, strokeWidth: 0 }}
              activeDot={{ r: 7 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
