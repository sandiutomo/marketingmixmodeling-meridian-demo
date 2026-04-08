'use client'
/**
 * PriorPosteriorChart — Prior vs Posterior distribution visualization
 *
 * Mirrors Meridian's visualizer.ModelDiagnostics.plot_prior_and_posterior_distribution()
 *
 * Shows Gaussian density curves per channel: prior (wide, dashed) vs posterior (narrow, solid).
 * A tighter posterior means the data successfully constrained the estimate.
 */
import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export interface ChannelDistribution {
  channel: string
  priorMean: number
  priorSigma: number
  posteriorMean: number
  posteriorSigma: number
  color: string
}

interface Props {
  channels: ChannelDistribution[]
  isRealMeridian?: boolean
}

/** Normal PDF: f(x) = (1 / σ√2π) × exp(-½((x−μ)/σ)²) */
function normalPdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 0
  const z = (x - mu) / sigma
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI))
}

function buildCurve(mu: number, sigma: number, xMin: number, xMax: number, steps = 120) {
  const step = (xMax - xMin) / steps
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = xMin + i * step
    return { x: parseFloat(x.toFixed(3)), y: parseFloat(normalPdf(x, mu, sigma).toFixed(4)) }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="px-3 py-2 text-xs rounded shadow-sm"
      style={{ background: 'var(--color-parchment)', border: '1px solid var(--color-sage-border)' }}
    >
      <p style={{ color: 'var(--color-muted-olive)' }}>ROI = {label}</p>
      {payload.map((p: { dataKey: string; color: string; name: string; value: number }) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value?.toFixed(4)}
        </p>
      ))}
    </div>
  )
}

export default function PriorPosteriorChart({ channels, isRealMeridian = false }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  if (!channels.length) {
    return (
      <div className="flex items-center justify-center h-48 text-xs" style={{ color: 'var(--color-sage-placeholder)' }}>
        Run the model to see prior vs posterior distributions.
      </div>
    )
  }

  const ch = channels[Math.min(selectedIdx, channels.length - 1)]

  const xMin = Math.min(ch.priorMean - 3.5 * ch.priorSigma, ch.posteriorMean - 3.5 * ch.posteriorSigma)
  const xMax = Math.max(ch.priorMean + 3.5 * ch.priorSigma, ch.posteriorMean + 3.5 * ch.posteriorSigma)

  const priorCurve     = buildCurve(ch.priorMean, ch.priorSigma, xMin, xMax)
  const posteriorCurve = buildCurve(ch.posteriorMean, ch.posteriorSigma, xMin, xMax)

  const chartData = priorCurve.map((pt, i) => ({
    x:         pt.x,
    prior:     pt.y,
    posterior: posteriorCurve[i]?.y ?? 0,
  }))

  const shift   = Math.abs(ch.posteriorMean - ch.priorMean)
  const tighter = ch.posteriorSigma < ch.priorSigma

  return (
    <div className="space-y-3">
      {/* Channel selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {channels.map((c, i) => (
          <button
            key={c.channel}
            onClick={() => setSelectedIdx(i)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
              i === selectedIdx
                ? 'text-white border-transparent'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
            style={i === selectedIdx ? { background: c.color, borderColor: c.color } : {}}
          >
            {c.channel}
          </button>
        ))}
      </div>

      <div className="space-y-0.5">
        <p className="text-xs font-medium" style={{ color: 'var(--color-muted-olive)' }}>
          {ch.channel} — Prior vs Posterior ROI distribution
        </p>
        <p className="text-[11px]" style={{ color: 'var(--color-sage-placeholder)' }}>
          {tighter
            ? `Posterior is ${((1 - ch.posteriorSigma / ch.priorSigma) * 100).toFixed(0)}% narrower than prior — data has significantly constrained the estimate.`
            : 'Posterior closely matches prior — data has weak signal for this channel.'
          }
          {' '}Mean shifted by {shift.toFixed(2)}x from prior belief.
        </p>
      </div>

      <p className="text-[10px] text-center" style={{ color: 'var(--color-sage-placeholder)' }}>
        ROI Estimate &rarr; &nbsp;
        <span style={{ color: 'var(--color-muted-olive)' }}>
          <span style={{ borderBottom: '1.5px dashed var(--color-sage-border)', paddingBottom: 1 }}>Prior</span>
          &ensp;
          <span style={{ borderBottom: `1.5px solid ${ch.color}`, paddingBottom: 1 }}>Posterior</span>
        </span>
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <XAxis
            dataKey="x"
            type="number"
            domain={[xMin, xMax]}
            tick={{ fontSize: 9, fill: 'var(--color-sage-placeholder)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v.toFixed(1)}x`}
          />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="prior"
            stroke="var(--color-sage-border)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            name="prior"
          />
          <Line
            type="monotone"
            dataKey="posterior"
            stroke={ch.color}
            strokeWidth={2}
            dot={false}
            name="posterior"
          />
        </LineChart>
      </ResponsiveContainer>

      {!isRealMeridian && (
        <p className="text-[10px] text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-100">
          Illustrative distributions — run Meridian to see real posterior shapes from MCMC sampling.
        </p>
      )}
    </div>
  )
}
