'use client'
import { useState, useEffect } from 'react'
import { Settings2, Code2, Play, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import type { ModelConfig, ChannelPrior, DataSourceType, UploadedDataSummary } from '@/lib/types'
import { fmtPct } from '@/lib/format'
import CodeBlock from '@/components/ui/CodeBlock'

// Real channel/geo lists from the Meridian sample CSVs
const DATASET_CHANNELS: Record<DataSourceType, string[]> = {
  custom_csv:  [],
  geo_no_rf:   ['TV', 'Paid Search', 'Social', 'Display'],
  geo_with_rf: ['TV', 'Paid Search', 'Social', 'YouTube'],
  geo_organic: ['TV', 'Paid Search', 'Social', 'Display', 'OOH'],
  national:    ['TV', 'Radio', 'Paid Search', 'Social', 'Display'],
  indonesia:   ['TV', 'Social', 'Search', 'OOH', 'E-commerce', 'YouTube', 'Programmatic', 'Influencer'],
}
const DATASET_GEOS: Record<DataSourceType, string[]> = {
  custom_csv:  [],
  geo_no_rf:   Array.from({ length: 20 }, (_, i) => `Geo${i}`),
  geo_with_rf: Array.from({ length: 20 }, (_, i) => `Geo${i}`),
  geo_organic: Array.from({ length: 20 }, (_, i) => `Geo${i}`),
  national:    ['National'],
  indonesia:   ['National (Indonesia)'],
}
const DATASET_DATES: Record<DataSourceType, { start: string; end: string }> = {
  custom_csv:  { start: '', end: '' },
  geo_no_rf:   { start: '2021-01-25', end: '2024-01-22' },
  geo_with_rf: { start: '2021-01-25', end: '2024-01-22' },
  geo_organic: { start: '2021-01-25', end: '2024-01-22' },
  national:    { start: '2021-01-25', end: '2024-01-22' },
  indonesia:   { start: '2019-01-07', end: '2024-12-30' },
}

interface ModelConfigPanelProps {
  onApply: (config: ModelConfig) => void
  isLoading: boolean
  selectedData: DataSourceType
  uploadSummary?: UploadedDataSummary | null
  uploadTimespan?: { start: string | null; end: string | null } | null
}

export default function ModelConfigPanel({
  onApply,
  isLoading,
  selectedData,
  uploadSummary,
  uploadTimespan,
}: ModelConfigPanelProps) {
  const isCustom = selectedData === 'custom_csv' && uploadSummary
  const channelOptions = isCustom
    ? uploadSummary!.channels.map(
        k => uploadSummary!.channel_labels?.[k] ?? k.replace(/_/g, ' ')
      )
    : DATASET_CHANNELS[selectedData as Exclude<DataSourceType, 'custom_csv'>]
  const geoOptions = isCustom
    ? (uploadSummary!.geos?.length ? uploadSummary!.geos : ['national_geo'])
    : DATASET_GEOS[selectedData as Exclude<DataSourceType, 'custom_csv'>]
  const dates = isCustom
    ? {
        start: uploadTimespan?.start ?? '',
        end: uploadTimespan?.end ?? '',
      }
    : DATASET_DATES[selectedData as Exclude<DataSourceType, 'custom_csv'>]

  const defaultPriors: Record<string, ChannelPrior> = Object.fromEntries(
    channelOptions.map(ch => [ch, { mu: 0.2, sigma: 0.9 }])
  )

  const [config, setConfig] = useState<ModelConfig>({
    startDate: dates.start,
    endDate:   dates.end,
    geos:      geoOptions.slice(0, Math.min(5, geoOptions.length)),
    channels:  channelOptions,
    nChains: 4,
    nAdapt: 1000,
    nBurnin: 500,
    nKeep: 1000,
    seed: 42,
    nPriorDraws: 256,
    maxLag: 8,
    adstockDecay: 'geometric',
    mediaPriorType: 'roi',
    holdoutPct: 0,
    mediaEffectsDist: 'log_normal',
    hillBeforeAdstock: false,
    uniqueSigmaPerGeo: false,
    channelPriors: defaultPriors,
    calibrationPeriods: [],
  })
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (selectedData === 'custom_csv' && !uploadSummary) return
    const custom = selectedData === 'custom_csv' && uploadSummary
    const chOpt = custom
      ? uploadSummary!.channels.map(
          k => uploadSummary!.channel_labels?.[k] ?? k.replace(/_/g, ' ')
        )
      : DATASET_CHANNELS[selectedData as Exclude<DataSourceType, 'custom_csv'>]
    const gOpt = custom
      ? (uploadSummary!.geos?.length ? uploadSummary!.geos : ['national_geo'])
      : DATASET_GEOS[selectedData as Exclude<DataSourceType, 'custom_csv'>]
    const dt = custom
      ? { start: uploadTimespan?.start ?? '', end: uploadTimespan?.end ?? '' }
      : DATASET_DATES[selectedData as Exclude<DataSourceType, 'custom_csv'>]
    const pri = Object.fromEntries(chOpt.map(ch => [ch, { mu: 0.2, sigma: 0.9 }]))
    setApplied(false)
    setConfig(prev => ({
      ...prev,
      startDate: dt.start,
      endDate: dt.end,
      geos: gOpt.slice(0, Math.min(5, gOpt.length)),
      channels: chOpt,
      channelPriors: pri,
      calibrationPeriods: [],
    }))
  }, [selectedData, uploadSummary, uploadTimespan])

  const generatedCode = `# google-meridian 1.5.3 · Python 3.13
from meridian.data.nd_array_input_data_builder import NDArrayInputDataBuilder
from meridian.model.model import Meridian
from meridian.model import spec as model_spec_module
from meridian.analysis.analyzer import Analyzer

# Time range: ${config.startDate} to ${config.endDate}
# Geographies: ${config.geos.join(', ')}
# Channels: ${config.channels.join(', ')}

builder = NDArrayInputDataBuilder(kpi_type='revenue')
builder.time_coords = time_coords      # list of YYYY-MM-DD strings
builder.geos = ${JSON.stringify(config.geos)}
builder.with_population(population)   # shape: (n_geos,)
builder.with_kpi(kpi)                  # shape: (n_geos, n_times)
builder.with_media(media, media_spend, ${JSON.stringify(config.channels)})
builder.with_controls(controls, control_names)
input_data = builder.build()

model_spec = model_spec_module.ModelSpec(
    max_lag=${config.maxLag},
    adstock_decay_spec="${config.adstockDecay}",
    media_prior_type="${config.mediaPriorType}",
    media_effects_dist="${config.mediaEffectsDist ?? 'log_normal'}",
    hill_before_adstock=${config.hillBeforeAdstock ?? false},
    unique_sigma_for_each_geo=${config.uniqueSigmaPerGeo ?? false},
)

model = Meridian(input_data=input_data, model_spec=model_spec)
model.sample_prior(n_draws=${config.nPriorDraws ?? 256}, seed=${config.seed ?? 42})
model.sample_posterior(
    n_chains=${config.nChains},
    n_adapt=${config.nAdapt},
    n_burnin=${config.nBurnin},
    n_keep=${config.nKeep},
    seed=${config.seed ?? 42},
)

analyzer = Analyzer(model)
summary = analyzer.summary_metrics(confidence_level=0.9)
rhat_df = analyzer.rhat_summary()
acc_ds  = analyzer.predictive_accuracy()
# Meridian 1.5.x: acc_ds['value'].sel(metric='R_Squared', geo_granularity='National', evaluation_set='All Data')
r2 = float(acc_ds['value'].sel(metric='R_Squared', geo_granularity='National', evaluation_set='All Data'))
import arviz as az
ess = az.ess(model.inference_data, method='mean')
print(summary['roi'].sel(distribution='posterior', metric='mean'))  # metric: mean | ci_lo | ci_hi
print(f"Max R-hat: {rhat_df['max_rhat'].max():.3f}")`

  const toggleChannel = (ch: string) => {
    setApplied(false)
    setConfig(prev => ({
      ...prev,
      channels: prev.channels.includes(ch) ? prev.channels.filter(c => c !== ch) : [...prev.channels, ch]
    }))
  }

  const toggleGeo = (g: string) => {
    setApplied(false)
    setConfig(prev => ({
      ...prev,
      geos: prev.geos.includes(g) ? prev.geos.filter(x => x !== g) : [...prev.geos, g]
    }))
  }

  return (
    <>
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-brand-500" />
          <h3 className="font-semibold text-slate-900">Model Configuration</h3>
          <span className="ml-auto text-xs text-slate-400">Step 2 of 3</span>
        </div>
        <div className="card-body space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Start Date</label>
              <input type="date" value={config.startDate} onChange={e => setConfig(p => ({...p, startDate: e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">End Date</label>
              <input type="date" value={config.endDate} onChange={e => setConfig(p => ({...p, endDate: e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-600">Geographic Regions</label>
              {geoOptions.length > 5 && (
                <div className="flex gap-2">
                  <button onClick={() => setConfig(p => ({ ...p, geos: geoOptions }))} className="text-xs text-slate-400 hover:text-brand-600 transition-colors">All</button>
                  <button onClick={() => setConfig(p => ({ ...p, geos: [] }))} className="text-xs text-slate-400 hover:text-brand-600 transition-colors">None</button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
              {geoOptions.map(g => (
                <button key={g} onClick={() => toggleGeo(g)}
                  className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                    config.geos.includes(g) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-surface-200 text-slate-600 hover:border-brand-300'
                  }`}>{g}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Channels</label>
            <div className="flex flex-wrap gap-2">
              {channelOptions.map(ch => (
                <button key={ch} onClick={() => toggleChannel(ch)}
                  className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                    config.channels.includes(ch) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-surface-200 text-slate-600 hover:border-brand-300'
                  }`}>{ch}</button>
              ))}
            </div>
          </div>

          <details className="group">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none flex items-center gap-1">
              <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" /> Advanced settings
            </summary>
            <div className="mt-3 p-4 bg-surface-50 rounded-xl space-y-5">
              <p className="text-xs text-slate-500 leading-relaxed">The model runs several calibration passes before producing results. Each setting below controls a different phase of that process.</p>

              {/* Meridian model spec */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-600">Media effects</p>
                <div className="flex items-start gap-3">
                  <input
                    type="number" min={1} max={13} value={config.maxLag}
                    onChange={e => { setApplied(false); setConfig(p => ({ ...p, maxLag: parseInt(e.target.value) || 8 })) }}
                    className="w-24 shrink-0 px-3 py-1.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Carryover window (weeks)</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">How many weeks after a campaign runs before its effects fully fade. TV often carries longer than paid search. Meridian default: 8.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <select
                    value={config.adstockDecay}
                    onChange={e => { setApplied(false); setConfig(p => ({ ...p, adstockDecay: e.target.value as 'geometric' | 'binomial' })) }}
                    className="w-32 shrink-0 px-2 py-1.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                  >
                    <option value="geometric">Geometric</option>
                    <option value="binomial">Binomial</option>
                  </select>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Decay function</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Shape of how a campaign's effect fades over time. Geometric (default) decays smoothly each week; binomial creates a peaked carryover curve.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <select
                    value={config.holdoutPct}
                    onChange={e => { setApplied(false); setConfig(p => ({ ...p, holdoutPct: parseFloat(e.target.value) })) }}
                    className="w-24 shrink-0 px-2 py-1.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                  >
                    <option value={0}>None</option>
                    <option value={0.1}>10%</option>
                    <option value={0.2}>20%</option>
                  </select>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Hold out for validation</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Reserve the last N% of weeks as a test set to check how accurately the model predicts unseen data. Set to None if you want to use all data for fitting.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <select
                    value={config.mediaPriorType}
                    onChange={e => { setApplied(false); setConfig(p => ({ ...p, mediaPriorType: e.target.value as 'roi' | 'coefficient' })) }}
                    className="w-24 shrink-0 px-2 py-1.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                  >
                    <option value="roi">ROI</option>
                    <option value="coefficient">Coefficient</option>
                  </select>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Prior type:</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                      <strong className="text-slate-500">ROI</strong> — express your prior belief as expected return per dollar (e.g., &quot;I expect TV to return around \$2&quot;). Easier to interpret.{' '}
                      <br />
                      <strong className="text-slate-500">Coefficient</strong> — specify the raw response coefficient. Use when you have posterior samples from a previous model run.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <select
                    value={config.mediaEffectsDist ?? 'log_normal'}
                    onChange={e => { setApplied(false); setConfig(p => ({ ...p, mediaEffectsDist: e.target.value as 'log_normal' | 'normal' })) }}
                    className="w-full sm:w-40 shrink-0 px-2 py-2 text-sm border border-surface-200 rounded-lg min-h-[44px]"
                  >
                    <option value="log_normal">log_normal</option>
                    <option value="normal">normal</option>
                  </select>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">media_effects_dist</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Hierarchical distribution of geo-level media effects. National runs may coerce to <code className="font-mono">normal</code> per Meridian.</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={config.hillBeforeAdstock ?? false}
                    onChange={e => { setApplied(false); setConfig(p => ({ ...p, hillBeforeAdstock: e.target.checked })) }}
                    className="rounded border-surface-300 w-4 h-4"
                  />
                  Hill before adstock (hill_before_adstock)
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={config.uniqueSigmaPerGeo ?? false}
                    onChange={e => { setApplied(false); setConfig(p => ({ ...p, uniqueSigmaPerGeo: e.target.checked })) }}
                    className="rounded border-surface-300 w-4 h-4"
                  />
                  Unique σ per geo (unique_sigma_for_each_geo)
                </label>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <input
                    type="number" min={50} max={2000} step={50}
                    value={config.nPriorDraws ?? 256}
                    onChange={e => { setApplied(false); setConfig(p => ({ ...p, nPriorDraws: parseInt(e.target.value, 10) || 256 })) }}
                    className="w-full sm:w-28 px-3 py-2 text-sm border border-surface-200 rounded-lg min-h-[44px]"
                  />
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Prior predictive draws</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">sample_prior(n_draws) — required before summary_metrics in Meridian 1.5.x for prior vs posterior tables.</p>
                  </div>
                </div>
              </div>

              {/* Calibration experiments */}
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-600">Calibration experiments</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    Have you run any real experiments to test your ads — like turning off spend in one city while keeping it on in another? Add those results here. The model uses them to check its own work and produce more accurate ROI estimates.
                  </p>
                </div>
                {(config.calibrationPeriods ?? []).length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-surface-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface-50 text-left">
                          <th className="px-3 py-2 font-semibold text-slate-500">Channel</th>
                          <th className="px-3 py-2 font-semibold text-slate-500">Period</th>
                          <th className="px-3 py-2 font-semibold text-slate-500">Lift</th>
                          <th className="px-3 py-2 font-semibold text-slate-500">Type</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {(config.calibrationPeriods ?? []).map((cp, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'}>
                            <td className="px-3 py-1.5 font-medium text-slate-700">{cp.channel}</td>
                            <td className="px-3 py-1.5 text-slate-500">{cp.startDate} → {cp.endDate}</td>
                            <td className="px-3 py-1.5 font-mono text-brand-600">{fmtPct(cp.liftPct * 100, 0)}</td>
                            <td className="px-3 py-1.5 text-slate-500">{cp.experimentType === 'holdout' ? 'Holdout' : 'Matched markets'}</td>
                            <td className="px-3 py-1.5 text-right">
                              <button
                                onClick={() => setConfig(p => ({
                                  ...p,
                                  calibrationPeriods: (p.calibrationPeriods ?? []).filter((_, i) => i !== idx)
                                }))}
                                className="text-slate-400 hover:text-red-500 transition-colors"
                              >✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button
                  onClick={() => {
                    const channel = config.channels[0] ?? ''
                    setApplied(false)
                    setConfig(p => ({
                      ...p,
                      calibrationPeriods: [
                        ...(p.calibrationPeriods ?? []),
                        { channel, startDate: p.startDate, endDate: p.endDate, liftPct: 0.10, experimentType: 'holdout' },
                      ],
                    }))
                  }}
                  className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 transition-colors"
                >
                  + Add calibration experiment
                </button>
              </div>

              {/* MCMC sampling */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-600">Sampling</p>
                {[
                  { label: 'Model Calibration Runs', key: 'nAdapt', description: 'These runs help the model adjust itself to your data so it can make accurate estimates. Default 1000.' },
                  { label: 'Stabilization Runs',     key: 'nBurnin', description: 'Initial runs where the model is still settling in — these are not used in the final results. Default 500.' },
                  { label: 'Confidence Runs',        key: 'nKeep',   description: 'These runs are used to calculate your final results. More runs mean more reliable estimates.' },
                ].map(({ label, key, description }) => (
                  <div key={key} className="flex items-start gap-3">
                    <input type="number" value={(config as any)[key]} onChange={e => setConfig(p => ({...p, [key]: parseInt(e.target.value)}))}
                      className="w-24 shrink-0 px-3 py-1.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200" />
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{label}</p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* Phase 3 — per-channel prior beliefs */}
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-600">Prior ROI beliefs</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    Your starting assumption about each channel's ROI before the model sees any data.
                    Higher μ = stronger expected return. Lower σ = tighter, more opinionated prior.
                    Meridian default: μ 0.2 · σ 0.9 (wide uncertainty — data dominates).
                  </p>
                </div>
                <div className="overflow-hidden rounded-xl border border-surface-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-50 text-left">
                        <th className="px-3 py-2 font-semibold text-slate-500">Channel</th>
                        <th className="px-3 py-2 font-semibold text-slate-500">μ (prior mean)</th>
                        <th className="px-3 py-2 font-semibold text-slate-500">σ (uncertainty)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {config.channels.map((ch, idx) => {
                        const prior = config.channelPriors?.[ch] ?? { mu: 0.2, sigma: 0.9 }
                        return (
                          <tr key={ch} className={idx % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'}>
                            <td className="px-3 py-1.5 font-medium text-slate-700">{ch}</td>
                            <td className="px-3 py-1.5">
                              <input
                                type="number" step={0.1} min={0} max={5}
                                value={prior.mu}
                                onChange={e => {
                                  const mu = parseFloat(e.target.value) || 0.2
                                  setApplied(false)
                                  setConfig(p => ({
                                    ...p,
                                    channelPriors: { ...p.channelPriors, [ch]: { ...prior, mu } }
                                  }))
                                }}
                                className="w-20 px-2 py-1 border border-surface-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-200 font-mono"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                type="number" step={0.1} min={0.1} max={3}
                                value={prior.sigma}
                                onChange={e => {
                                  const sigma = parseFloat(e.target.value) || 0.9
                                  setApplied(false)
                                  setConfig(p => ({
                                    ...p,
                                    channelPriors: { ...p.channelPriors, [ch]: { ...prior, sigma } }
                                  }))
                                }}
                                className="w-20 px-2 py-1 border border-surface-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-200 font-mono"
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={() => {
                    setApplied(false)
                    setConfig(p => ({
                      ...p,
                      channelPriors: Object.fromEntries(p.channels.map(ch => [ch, { mu: 0.2, sigma: 0.9 }]))
                    }))
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors"
                >
                  Reset to Meridian defaults
                </button>
              </div>
            </div>
          </details>

          <div className="space-y-2">
            <button onClick={() => { onApply(config); setApplied(true) }} disabled={isLoading}
              className={`btn-primary w-full justify-center ${isLoading ? 'opacity-50' : ''}`}>
              <Play className="w-4 h-4" />
              {isLoading ? 'Applying...' : applied ? 'Re-apply Configuration' : 'Apply Configuration'}
            </button>
            {applied && (
              <p className="text-xs text-center text-green-600">Configuration applied — scroll down to run the analysis.</p>
            )}
            <button
              onClick={() => setShowCodeModal(prev => !prev)}
              className="btn-secondary w-full justify-center gap-1.5 text-xs"
            >
              <Code2 className="w-3.5 h-3.5" />
              {showCodeModal ? 'Hide code' : 'View generated code'}
              {showCodeModal ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showCodeModal && <CodeBlock code={generatedCode} />}
          </div>
        </div>
      </div>
    </>
  )
}
