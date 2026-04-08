'use client'
import { fmt } from '@/lib/format'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import SectionTooltip from '@/components/ui/SectionTooltip'
import type { DataMethod } from '@/lib/types'

const PAID_COLORS = ['#4361ee', '#7209b7', '#f72585', '#f97316', '#3a0ca3', '#06d6a0', '#ef233c', '#480ca8']
const BASE_COLOR   = '#fbbf24'

function getColor(channel: string, originalIndex: number) {
  return channel === 'Base (non-media)' ? BASE_COLOR : PAID_COLORS[originalIndex % PAID_COLORS.length]
}

interface ContributionPieChartProps {
  data: Array<{ channel: string; contribution: number; percentage: number }>
  currency?: 'USD' | 'IDR'
  dataMethod?: DataMethod
}

export default function ContributionPieChart({ data, currency = 'USD', dataMethod = 'mock' }: ContributionPieChartProps) {
  const total = data.reduce((s, d) => s + d.contribution, 0)

  const sorted = [...data]
    .map((d, i) => ({ ...d, originalIndex: i }))
    .sort((a, b) => b.percentage - a.percentage)

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-900">Revenue by channel</h3>
          <DataMethodBadge method={dataMethod} />
          <SectionTooltip content="This shows how much revenue each channel actually caused, not just what happened around the same time. Meridian isolates each channel's contribution by holding everything else constant, so you see the true incremental value of each dollar spent. Base revenue is what you would have earned with zero advertising." />
        </div>
        <p className="text-sm text-slate-500 mt-0.5">How much revenue each channel actually drove (after removing what would have happened anyway)</p>
      </div>

      <div className="space-y-2">
        {sorted.map((entry) => {
          const color = getColor(entry.channel, entry.originalIndex)
          const isBase = entry.channel === 'Base (non-media)'
          return (
            <div key={entry.channel} className="group">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className={`text-xs font-medium ${isBase ? 'text-slate-400 italic' : 'text-slate-700'}`}>
                    {entry.channel}
                  </span>
                  {isBase && (
                    <span className="text-[10px] text-slate-400 bg-surface-100 px-1.5 py-0.5 rounded">organic</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{fmt(entry.contribution, currency)}</span>
                  <span className="text-xs font-bold text-slate-800 w-9 text-right">{entry.percentage}%</span>
                </div>
              </div>
              <div className="h-5 bg-surface-100 rounded-md overflow-hidden">
                <div
                  className="h-full rounded-md transition-all duration-500"
                  style={{
                    width: `${entry.percentage}%`,
                    backgroundColor: color,
                    opacity: isBase ? 0.55 : 0.85,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between text-sm border-t border-surface-100 pt-2">
        <span className="text-slate-500 font-medium">Total revenue attributed</span>
        <span className="font-bold text-slate-800">{fmt(total, currency)}</span>
      </div>
    </div>
  )
}
