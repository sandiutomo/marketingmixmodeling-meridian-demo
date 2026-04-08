'use client'
import { useMemo } from 'react'
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import type { TooltipProps } from 'recharts'
import type { WaterfallResult } from '@/lib/types'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import { fmt } from '@/lib/format'

interface Props {
  data: WaterfallResult
  currency?: 'USD' | 'IDR'
}

/**
 * True floating-bar waterfall chart.
 *
 * For each period we render one stacked bar per column:
 *   1. An invisible spacer that pushes the visible bar off the axis
 *   2. The visible delta (or baseline) bar
 *
 * For the baseline period each channel shows its absolute contribution starting from 0.
 * For subsequent periods each channel shows the signed delta starting from the previous total.
 *
 * Because we stack all channels together, the spacer for channel i in period p = cumulative
 * sum of all channels 0..i-1 for that period.  The visible segment = that channel's delta/value.
 */
export default function WaterfallChart({ data, currency = 'USD' }: Props) {
  const method = data.is_real_meridian ? 'meridian' : 'pearson'
  const hasMultiplePeriods = data.periods.length > 1

  // ---- colour palette -------------------------------------------------------
  const PALETTE = ['#4361ee', '#7209b7', '#f72585', '#4cc9f0', '#3a0ca3', '#06d6a0', '#ef233c', '#480ca8']
  const channelColor = useMemo(() => {
    const m: Record<string, string> = { Base: '#fbbf24' }
    let idx = 0
    for (const ch of data.channels) {
      if (!m[ch]) { m[ch] = PALETTE[idx % PALETTE.length]; idx++ }
    }
    return m
  }, [data.channels])

  // ---- build chart rows -----------------------------------------------------
  // One row per period.  For each channel we emit two keys:
  //   `${ch}__spacer`  — transparent, equal to running floor before this channel
  //   `${ch}__bar`     — visible segment
  const allChannels = [...data.channels, 'Base']

  const chartRows = useMemo(() => {
    if (!data.periods.length) return []

    return data.periods.map(period => {
      const barsForPeriod = data.bars.filter(b => b.period === period)
      const row: Record<string, number | string> = { period }

      let runningFloor = 0

      for (const ch of allChannels) {
        const bar = barsForPeriod.find(b => b.channel === ch)
        if (!bar) {
          row[`${ch}__spacer`] = runningFloor
          row[`${ch}__bar`]    = 0
          continue
        }

        const segmentValue = bar.is_baseline ? bar.cumulative : bar.delta

        if (segmentValue >= 0) {
          // Positive segment: spacer lifts up to floor, bar goes up by segmentValue
          row[`${ch}__spacer`] = runningFloor
          row[`${ch}__bar`]    = segmentValue
          runningFloor += segmentValue
        } else {
          // Negative segment: the bar hangs *down* from floor + segmentValue to floor.
          // Recharts stacked bars don't support negative gracefully without offsetting.
          // We set the spacer to the bottom of the drop and the bar to |delta|.
          // But we also need to record this as negative for tooltip display.
          row[`${ch}__spacer`] = runningFloor + segmentValue  // bottom of drop
          row[`${ch}__bar`]    = Math.abs(segmentValue)
          row[`${ch}__neg`]    = 1  // flag for cell colouring
          runningFloor += segmentValue
        }
      }

      return row
    })
  }, [data])

  if (!data.periods.length) {
    return <div className="text-xs text-slate-400 py-8 text-center">No period data available.</div>
  }

  // Custom tooltip — reconstruct the actual value from the chart data
  const customTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null
    // Filter out spacer and zero entries
    const visibleEntries = payload
      .filter(p => p.name != null && !p.name.endsWith('__spacer') && !p.name.endsWith('__neg') && (p.value ?? 0) > 0)
      .map(p => {
        const ch = (p.name ?? '').replace('__bar', '')
        const rowPayload = p.payload as Record<string, number>
        const isNeg = rowPayload[`${ch}__neg`] === 1
        return { ch, value: isNeg ? -(p.value ?? 0) : (p.value ?? 0) }
      })
    if (!visibleEntries.length) return null
    return (
      <div className="bg-white border border-surface-200 rounded-xl shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold text-slate-700 mb-1">Period: {label}</p>
        {visibleEntries.map(({ ch, value }) => (
          <p key={ch} className={value >= 0 ? 'text-slate-700' : 'text-red-600'}>
            {ch}: {fmt(value, currency)}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold text-slate-700">Revenue change by period</h4>
        <DataMethodBadge method={method} />
      </div>
      <p className="text-xs text-slate-500">
        {hasMultiplePeriods
          ? 'First period shows total channel revenue. Later periods show change vs. the previous one. Green = growth, red = decline.'
          : 'Revenue attribution by channel for the selected period.'}
      </p>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartRows} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f7" />
          <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => fmt(v as number, currency)} axisLine={false} tickLine={false} />
          <Tooltip content={customTooltip} />
          <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />

          {allChannels.flatMap(ch => [
            // Transparent spacer bar — always rendered but invisible
            <Bar key={`${ch}__spacer`} dataKey={`${ch}__spacer`} stackId="wf" fill="transparent" stroke="none" legendType="none" />,
            // Visible segment
            <Bar key={`${ch}__bar`} dataKey={`${ch}__bar`} stackId="wf" name={ch} radius={[2, 2, 0, 0]}>
              {chartRows.map((row, idx) => {
                const periodBar = data.bars.find(b => b.period === row.period && b.channel === ch)
                const isBaseline = periodBar?.is_baseline ?? false
                const isNeg = row[`${ch}__neg`] === 1
                const fill = isBaseline
                  ? channelColor[ch] ?? '#94a3b8'
                  : isNeg ? '#ef4444' : '#22c55e'
                return <Cell key={idx} fill={fill} fillOpacity={isBaseline ? 0.85 : 0.75} />
              })}
            </Bar>,
          ])}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        {data.channels.map(ch => (
          <span key={ch} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: channelColor[ch] }} />
            {ch}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: channelColor['Base'] }} />
          Base (organic)
        </span>
        {hasMultiplePeriods && (
          <>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-400" /> Growth vs prev</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400" /> Decline vs prev</span>
          </>
        )}
      </div>
    </div>
  )
}
