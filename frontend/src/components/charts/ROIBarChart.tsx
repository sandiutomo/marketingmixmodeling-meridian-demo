'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { getSaturationBadge } from '@/lib/types'
import type { ChannelResult, DataMethod } from '@/lib/types'
import { fmtROI, fmtSignedPct } from '@/lib/format'
import DataMethodBadge from '@/components/ui/DataMethodBadge'

interface ROIBarChartProps {
  data: Array<{ channel: string; roi: number; color?: string; saturationStatus?: ChannelResult['saturationStatus'] }>
  portfolioRoi?: number
  currency?: 'USD' | 'IDR'
  dataMethod?: DataMethod
}

const CustomTooltip = ({ active, payload, portfolioRoi, currency }: any) => {
  if (active && payload?.length) {
    const d = payload[0].payload
    const vs = portfolioRoi ? fmtSignedPct((d.roi / portfolioRoi - 1) * 100, 0) : null
    const satBadge = d.saturationStatus ? getSaturationBadge(d.saturationStatus) : null
    return (
      <div className="bg-white border border-surface-200 rounded-xl p-3 shadow-lg text-sm">
        <p className="font-semibold text-slate-900">{d.channel}</p>
        <p className="text-slate-600">{fmtROI(d.roi, currency)}<span className="text-slate-400"> per {currency === 'IDR' ? 'Rp 1,000' : '$1'} spent</span></p>
        {vs && portfolioRoi && (
          <p className={`text-xs mt-1 ${d.roi >= portfolioRoi ? 'text-green-600' : 'text-amber-600'}`}>
            {vs} vs portfolio avg
          </p>
        )}
        {satBadge && (
          <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mt-1.5 ${satBadge.color}`}>{satBadge.text}</span>
        )}
      </div>
    )
  }
  return null
}

export default function ROIBarChart({ data, portfolioRoi, currency = 'USD', dataMethod = 'mock' }: ROIBarChartProps) {
  const sorted = [...data].sort((a, b) => b.roi - a.roi)
  const avg = portfolioRoi ?? (data.reduce((s, d) => s + d.roi, 0) / data.length)
  const strongThreshold = avg * 1.3
  const weakThreshold   = avg * 0.7

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-900">ROI by Channel</h3>
          <DataMethodBadge method={dataMethod} />
        </div>
        <p className="text-sm text-slate-500 mt-0.5">Revenue per {currency === 'IDR' ? 'Rp 1,000' : '$1'} spent — after removing what would have happened without any ads</p>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={sorted} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
          <XAxis dataKey="channel" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fmtROI(v, currency)} />
          <Tooltip content={<CustomTooltip portfolioRoi={avg} currency={currency} />} />
          <ReferenceLine y={avg} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `Portfolio avg: ${fmtROI(avg, currency)}`, position: 'right', fontSize: 10, fill: '#64748b' }} />
          <Bar dataKey="roi" radius={[6, 6, 0, 0]}>
            {sorted.map((entry) => (
              <Cell
                key={entry.channel}
                fill={entry.color ?? (entry.roi >= strongThreshold ? '#22c55e' : entry.roi <= weakThreshold ? '#f97316' : '#4361ee')}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-slate-400 mt-1">
        Channels above the portfolio average ({fmtROI(avg, currency)}) outperform your portfolio. Channels below may benefit from reallocation.
      </p>
    </div>
  )
}
