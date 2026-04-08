'use client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, LabelList, ResponsiveContainer, Cell,
} from 'recharts'
import type { ChannelResult } from '@/lib/types'

interface Props {
  channels: ChannelResult[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const spendRow  = payload.find((p: { dataKey: string }) => p.dataKey === 'spend_pct')
  const contribRow = payload.find((p: { dataKey: string }) => p.dataKey === 'contribution_pct')
  const roiRow    = payload.find((p: { dataKey: string }) => p.dataKey === 'roi')

  return (
    <div
      className="px-3 py-2 text-xs rounded shadow-sm space-y-1"
      style={{ background: 'var(--color-parchment)', border: '1px solid var(--color-sage-border)' }}
    >
      <p className="font-semibold" style={{ color: 'var(--color-deep-olive)' }}>{label}</p>
      {spendRow   && <p style={{ color: 'var(--color-muted-olive)' }}>Spend: <span className="font-medium">{spendRow.value?.toFixed(1)}%</span></p>}
      {contribRow && <p style={{ color: 'var(--color-orange)' }}>Contribution: <span className="font-medium">{contribRow.value?.toFixed(1)}%</span></p>}
      {roiRow     && <p style={{ color: 'var(--color-muted-olive)' }}>ROI: <span className="font-medium">{roiRow.value?.toFixed(2)}x</span></p>}
      {spendRow && contribRow && (
        <p style={{ color: 'var(--color-sage-placeholder)' }}>
          {(contribRow.value - spendRow.value) >= 0
            ? `+${(contribRow.value - spendRow.value).toFixed(1)}pp over-performing`
            : `${(contribRow.value - spendRow.value).toFixed(1)}pp under-performing`}
        </p>
      )}
    </div>
  )
}

export default function SpendVsContributionChart({ channels }: Props) {
  if (!channels.length) {
    return (
      <div className="flex items-center justify-center h-40 text-xs" style={{ color: 'var(--color-sage-placeholder)' }}>
        No channel data available.
      </div>
    )
  }

  const totalSpend   = channels.reduce((s, c) => s + c.spend, 0) || 1
  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0) || 1

  const rows = channels
    .map(c => ({
      channel:          c.label,
      spend_pct:        parseFloat((c.spend / totalSpend * 100).toFixed(1)),
      contribution_pct: parseFloat((c.revenue / totalRevenue * 100).toFixed(1)),
      roi:              c.roi,
      color:            c.color,
      over:             c.revenue / totalRevenue > c.spend / totalSpend,
    }))
    .sort((a, b) => b.contribution_pct - a.contribution_pct)

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--color-muted-olive)' }}>
          Budget share vs Revenue contribution
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-sage-placeholder)' }}>
          Channels where contribution % &gt; spend % are over-performing their budget allocation.
        </p>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={rows}
          margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
          barCategoryGap="25%"
          barGap={3}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-light-sage)" vertical={false} />
          <XAxis
            dataKey="channel"
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v}%`}
            domain={[0, 'dataMax + 5']}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="square"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
            formatter={(value: string) =>
              value === 'spend_pct' ? '% of budget' : '% of attributed revenue'
            }
          />

          {/* Reference line at equal distribution (for context) */}
          <ReferenceLine
            y={100 / rows.length}
            stroke="var(--color-sage-border)"
            strokeDasharray="3 2"
          />

          <Bar dataKey="spend_pct" name="spend_pct" fill="var(--color-sage-border)" radius={[2, 2, 0, 0]}>
            {rows.map((r, i) => (
              <Cell key={i} fill="var(--color-light-sage)" />
            ))}
          </Bar>

          <Bar dataKey="contribution_pct" name="contribution_pct" radius={[2, 2, 0, 0]}>
            {rows.map((r, i) => (
              <Cell key={i} fill={r.over ? r.color : r.color + '80'} />
            ))}
            <LabelList
              dataKey="contribution_pct"
              position="top"
              style={{ fontSize: 9, fill: 'var(--color-muted-olive)' }}
              formatter={(v: number) => `${v}%`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="flex gap-4 text-[10px]" style={{ color: 'var(--color-sage-placeholder)' }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ background: 'var(--color-light-sage)' }} />
          Budget share
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ background: 'var(--color-orange)' }} />
          Revenue contribution (solid = over-performing)
        </span>
      </div>
    </div>
  )
}
