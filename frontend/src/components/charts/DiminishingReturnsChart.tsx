'use client'
import { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { ModelResults } from '@/lib/types'
import { fmt, fmtROI, currencySymbol } from '@/lib/format'
import MeridianBadge from '@/components/ui/MeridianBadge'

const FALLBACK_CHANNEL_DATA = [
  { channel: 'TV',          saturation: 850000,  currentSpend: 1200, recommendedSpend: 1000, color: '#4361ee', roi: 2.80, saturationStatus: 'saturated'    as const },
  { channel: 'Paid Search', saturation: 620000,  currentSpend: 450,  recommendedSpend: 560,  color: '#7209b7', roi: 4.20, saturationStatus: 'efficient'    as const },
  { channel: 'Social',      saturation: 480000,  currentSpend: 380,  recommendedSpend: 420,  color: '#f72585', roi: 3.10, saturationStatus: 'efficient'    as const },
  { channel: 'Display',     saturation: 310000,  currentSpend: 520,  recommendedSpend: 280,  color: '#4cc9f0', roi: 1.40, saturationStatus: 'room_to_grow' as const },
]

function generateCurve(saturation: number, currentSpendK: number, roi: number) {
  const L = saturation
  const S = currentSpendK * 1000
  const currentRevenue = roi * S
  const ratio = Math.min(0.999, Math.max(0.001, currentRevenue / L))
  const k = -Math.log(1 - ratio) / Math.max(1, S)

  const maxSpendK = Math.max(currentSpendK * 2.5, 100)
  const step = maxSpendK / 40
  const pts = []
  for (let i = 0; i <= 40; i++) {
    const spendK = i * step
    const response = L * (1 - Math.exp(-k * spendK * 1000))
    pts.push({ spend: Math.round(spendK), response: Math.round(response) })
  }
  return { pts, k }
}

function getStatus(saturationStatus: 'saturated' | 'efficient' | 'room_to_grow' | undefined) {
  if (saturationStatus === 'saturated')
    return { label: 'Overspending',            color: 'text-red-600 bg-red-50 border-red-100',     desc: 'Adding budget here returns very little. The curve has flattened — consider reallocating to a less saturated channel.' }
  if (saturationStatus === 'efficient')
    return { label: 'Near the efficient limit', color: 'text-amber-600 bg-amber-50 border-amber-100', desc: 'In the efficient zone. Small increases still return well, but gains will taper from here.' }
  return { label: 'Room to grow',               color: 'text-green-600 bg-green-50 border-green-100', desc: 'Well below saturation. Increasing budget here should return proportionally.' }
}

interface Props {
  modelResults: ModelResults | null
}

export default function DiminishingReturnsChart({ modelResults }: Props) {
  const currency = modelResults?.currency ?? 'USD'
  const sym = currencySymbol(currency)

  const channelData = useMemo(() => {
    if (!modelResults) return FALLBACK_CHANNEL_DATA
    const portfolioRoi = modelResults.portfolioRoi
    return modelResults.channels.map(ch => {
      const monthlySpend = (ch.spend / modelResults.nWeeks * 4) / 1000
      const saturation = (ch.revenue / modelResults.nWeeks * 4) * 2.5
      const multiplier = ch.saturationStatus === 'room_to_grow' ? 1.35
                       : ch.saturationStatus === 'saturated'    ? 0.70
                       : ch.roi > portfolioRoi * 1.1            ? 1.15 : 0.95
      const recommendedSpend = Math.round(monthlySpend * multiplier)
      return {
        channel:          ch.label,
        saturation,
        currentSpend:     Math.round(monthlySpend),
        recommendedSpend,
        color:            ch.color,
        roi:              ch.roi,
        saturationStatus: ch.saturationStatus,
      }
    })
  }, [modelResults])

  const [selected, setSelected] = useState<string>(channelData[0].channel)

  const ch = channelData.find(c => c.channel === selected) ?? channelData[0]
  const { pts: data } = generateCurve(ch.saturation, ch.currentSpend, ch.roi)

  function niceStep(max: number, targetTicks = 6) {
    const raw = max / targetTicks
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
    return Math.ceil(raw / mag) * mag
  }

  const maxResponse = Math.max(...data.map(d => d.response))
  const yTickStep  = niceStep(maxResponse * 1.12)
  const yMax       = Math.ceil(maxResponse * 1.12 / yTickStep) * yTickStep
  const yTicks     = Array.from({ length: Math.floor(yMax / yTickStep) + 1 }, (_, i) => i * yTickStep)
  const yFmt       = (v: number) => v === 0 ? '0' : fmt(v, currency)

  const maxSpendK  = Math.max(...data.map(d => d.spend))
  const xTickStep  = niceStep(maxSpendK)
  const xMax       = Math.ceil(maxSpendK / xTickStep) * xTickStep
  const xTicks     = Array.from({ length: Math.floor(xMax / xTickStep) + 1 }, (_, i) => i * xTickStep)
  const xFmt       = (v: number) => v === 0 ? '0' : fmt(v * 1000, currency)

  const snapToData = (targetK: number) => data.reduce((best, p) =>
    Math.abs(p.spend - targetK) < Math.abs(best.spend - targetK) ? p : best
  ).spend
  const snappedCurrent     = snapToData(ch.currentSpend)
  const snappedRecommended = snapToData(ch.recommendedSpend)

  const status = getStatus(ch.saturationStatus)
  const isOverspending = ch.currentSpend > ch.recommendedSpend
  const spendDeltaK = Math.abs(ch.currentSpend - ch.recommendedSpend)
  const revenueDelta = Math.round(spendDeltaK * 1000 * ch.roi)

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-900">Spend Saturation by Channel</h3>
          <MeridianBadge isReal={modelResults?.isRealMeridian} />
        </div>
        <p className="text-sm text-slate-500 mt-0.5">Select a channel to see where your current spend sits on its diminishing returns curve.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {channelData.map(c => (
          <button
            key={c.channel}
            onClick={() => setSelected(c.channel)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              selected === c.channel
                ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
                : 'bg-white border-surface-200 text-slate-600 hover:border-brand-300 hover:text-brand-700'
            }`}
          >
            {c.channel}
          </button>
        ))}
      </div>

      <div className="bg-surface-50 rounded-xl p-4">
        <p className="text-xs text-slate-400 mb-1">Incremental revenue</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
            <XAxis type="number" dataKey="spend" domain={[0, xMax]} ticks={xTicks} tickFormatter={xFmt} tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'Monthly spend', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#94a3b8' }} />
            <YAxis domain={[0, yMax]} ticks={yTicks} tickFormatter={yFmt} tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip
              formatter={(val: number) => [`${fmt(val as number, currency)} revenue`, 'Incremental response']}
              labelFormatter={l => `Spend: ${xFmt(Number(l))}/mo`}
            />
            <ReferenceLine
              x={snappedCurrent}
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="5 5"
              label={{ value: 'Current', position: 'insideTopRight', fontSize: 10, fill: '#ef4444', dy: 0 }}
            />
            <ReferenceLine
              x={snappedRecommended}
              stroke="#10b981"
              strokeWidth={2}
              strokeDasharray="5 5"
              label={{ value: 'Recommended', position: 'insideTopLeft', fontSize: 10, fill: '#10b981', dy: 16 }}
            />
            <Line type="monotone" dataKey="response" stroke={ch.color} strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>

        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 border-t-2 border-dashed border-red-400" />
            Current: {fmt(ch.currentSpend * 1000, currency)}/mo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 border-t-2 border-dashed border-green-500" />
            Recommended: {fmt(ch.recommendedSpend * 1000, currency)}/mo
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`px-4 py-3 rounded-xl border ${status.color}`}>
          <p className="text-xs font-semibold mb-0.5">{status.label}</p>
          <p className="text-xs leading-relaxed opacity-80">{status.desc}</p>
        </div>
        <div className="px-4 py-3 rounded-xl bg-surface-50 border border-surface-200">
          <p className="text-xs text-slate-500 mb-0.5">Current ROI</p>
          <p className="text-lg font-bold text-slate-900">{fmtROI(ch.roi, currency)}<span className="text-sm font-normal text-slate-400"> {currency === 'IDR' ? 'per Rp 1,000' : `per ${sym}1`}</span></p>
        </div>
        <div className={`px-4 py-3 rounded-xl border ${isOverspending ? 'bg-amber-50 border-amber-100' : 'bg-green-50 border-green-100'}`}>
          <p className={`text-xs mb-0.5 ${isOverspending ? 'text-amber-700' : 'text-green-700'}`}>
            {isOverspending ? `Reduce by ${fmt(spendDeltaK * 1000, currency)}/mo to free up` : `Increase by ${fmt(spendDeltaK * 1000, currency)}/mo to gain`}
          </p>
          <p className={`text-lg font-bold ${isOverspending ? 'text-amber-800' : 'text-green-800'}`}>
            {isOverspending ? `~${fmt(revenueDelta, currency)} saved` : `+${fmt(revenueDelta, currency)}`}
          </p>
        </div>
      </div>
    </div>
  )
}
