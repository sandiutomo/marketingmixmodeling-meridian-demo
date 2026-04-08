'use client'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { fmt } from '@/lib/format'

const CHANNEL_COLORS: Record<string, string> = {
  'TV': '#4361ee',
  'Paid Search': '#7209b7',
  'Social': '#f72585',
  'Display': '#4cc9f0',
  'Email': '#06d6a0',
}

interface SpendPoint {
  spend: number
  response: number
}

interface SpendResponseChartProps {
  channel: string
  data: SpendPoint[]
  currentSpend?: number
  optimalSpend?: number
  currency?: 'USD' | 'IDR'
}

export default function SpendResponseChart({ channel, data, currentSpend, optimalSpend, currency = 'USD' }: SpendResponseChartProps) {
  const color = CHANNEL_COLORS[channel] || '#4361ee'

  const snap = (target: number) => data.length
    ? data.reduce((best, p) => Math.abs(p.spend - target) < Math.abs(best.spend - target) ? p : best).spend
    : target
  const snappedCurrent  = currentSpend  != null ? snap(currentSpend)  : undefined
  const snappedOptimal  = optimalSpend  != null ? snap(optimalSpend)   : undefined

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
          <XAxis
            dataKey="spend"
            domain={[0, 'dataMax']}
            type="number"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickFormatter={v => fmt(v, currency)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickFormatter={v => fmt(v, currency)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(val: number) => [fmt(val as number, currency), 'Revenue']}
            labelFormatter={l => `Spend: ${fmt(Number(l), currency)}`}
          />
          <Line
            type="monotone"
            dataKey="response"
            stroke={color}
            strokeWidth={2.5}
            dot={false}
            name={channel}
          />
          {snappedCurrent != null && (
            <ReferenceLine
              x={snappedCurrent}
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="5 5"
              label={{ value: 'Current', position: 'insideTopRight', fontSize: 10, fill: '#ef4444' }}
            />
          )}
          {snappedOptimal != null && (
            <ReferenceLine
              x={snappedOptimal}
              stroke="#22c55e"
              strokeWidth={2}
              strokeDasharray="5 5"
              label={{ value: 'Recommended', position: 'insideBottomRight', fontSize: 10, fill: '#22c55e' }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-5 text-xs text-slate-500">
        {currentSpend && <span className="flex items-center gap-1.5"><span className="text-red-500 font-bold">●</span> Current spend ({fmt(currentSpend, currency)}/mo)</span>}
        {optimalSpend && <span className="flex items-center gap-1.5"><span className="text-green-600 font-bold">■</span> Recommended spend ({fmt(optimalSpend, currency)}/mo)</span>}
      </div>
    </div>
  )
}
