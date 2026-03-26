'use client'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { fmt, fmtPct } from '@/lib/format'
import MeridianBadge from '@/components/ui/MeridianBadge'

const PAID_COLORS = ['#4361ee', '#7209b7', '#f72585', '#4cc9f0', '#3a0ca3', '#06d6a0', '#ef233c', '#480ca8']
const BASE_COLOR   = '#fbbf24'  // amber — visually distinct from all paid channel colors

function getColor(channel: string, index: number) {
  return channel === 'Base (non-media)' ? BASE_COLOR : PAID_COLORS[index % PAID_COLORS.length]
}

interface ContributionPieChartProps {
  data: Array<{ channel: string; contribution: number; percentage: number }>
  currency?: 'USD' | 'IDR'
  isReal?: boolean
}

const CustomTooltip = ({ active, payload, currency }: any) => {
  if (active && payload?.length) {
    const d = payload[0].payload
    return (
      <div className="bg-white border border-surface-200 rounded-xl p-3 shadow-lg text-sm">
        <p className="font-semibold text-slate-900">{d.channel}</p>
        <p className="text-slate-600">{fmtPct(d.percentage)} of total revenue</p>
        <p className="text-slate-500 text-xs">{fmt(d.contribution, currency)} incremental</p>
      </div>
    )
  }
  return null
}

export default function ContributionPieChart({ data, currency = 'USD', isReal }: ContributionPieChartProps) {
  const total = data.reduce((s, d) => s + d.contribution, 0)
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-900">Channel Contribution Breakdown</h3>
          <MeridianBadge isReal={isReal} />
        </div>
        <p className="text-sm text-slate-500 mt-0.5">What percentage of your revenue each channel is actually driving</p>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="percentage" nameKey="channel" label={false}>
            {data.map((entry, index) => (
              <Cell key={index} fill={getColor(entry.channel, index)} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip currency={currency} />} />
        </PieChart>
      </ResponsiveContainer>
      {/* Legend with proper number formatting */}
      <div className="space-y-1.5">
        {data.map((d, i) => (
          <>
            {d.channel === 'Base (non-media)' && (
              <div key="divider" className="flex items-center gap-2 py-0.5">
                <div className="flex-1 border-t border-dashed border-slate-200" />
                <span className="text-xs text-slate-400 shrink-0">organic below</span>
                <div className="flex-1 border-t border-dashed border-slate-200" />
              </div>
            )}
            <div key={d.channel} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: getColor(d.channel, i) }} />
                <span className="text-slate-700 font-medium">{d.channel}</span>
              </div>
              <div className="flex items-center gap-3 text-right">
                <span className="text-slate-500 text-xs">{fmt(d.contribution, currency)}</span>
                <span className="font-semibold text-slate-800 w-10">{fmtPct(d.percentage)}</span>
              </div>
            </div>
          </>
        ))}
        <div className="flex items-center justify-between text-sm border-t border-surface-100 pt-1.5 mt-1">
          <span className="text-slate-500 font-medium">Total</span>
          <span className="font-bold text-slate-800">{fmt(total, currency)}</span>
        </div>
      </div>
    </div>
  )
}
