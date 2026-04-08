'use client'
import { useState, useEffect } from 'react'
import { Settings2, Code2, Play, ChevronDown, ChevronUp } from 'lucide-react'
import SectionTooltip from '@/components/ui/SectionTooltip'
import type { ModelConfig, ChannelPrior, DataSourceType, UploadedDataSummary } from '@/lib/types'
import { fmtPct } from '@/lib/format'
import CodeBlock from '@/components/ui/CodeBlock'

const DATASET_LABELS: Record<DataSourceType, string> = {
  custom_csv:  'Custom CSV',
  geo_no_rf:   'Geographic Data',
  geo_with_rf: 'Geographic + Reach & Frequency',
  geo_organic: 'Geographic + Organic & Non-Media',
  national:    'National Data',
  indonesia:   'Indonesia Market',
}

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
  geo_organic: Array.from({ length: 40 }, (_, i) => `Geo${i}`),
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

builder = NDArrayInputDataBuilder(kpi_type='${config.kpiType ?? 'revenue'}')
builder.time_coords = time_coords      # list of YYYY-MM-DD strings
builder.geos = ${JSON.stringify(config.geos)}
builder.with_population(population)   # shape: (n_geos,)
builder.with_kpi(kpi)                  # shape: (n_geos, n_times)${config.kpiType === 'non_revenue' && config.revenuePerKpi ? `\nbuilder.revenue_per_kpi = ${config.revenuePerKpi}   # converts KPI units to revenue` : ''}
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
          <SectionTooltip content="Defines which channels, date range, and sampling parameters Meridian uses. More channels or a longer date range increases run time but gives the model more signal to learn from." />
          <span className="ml-auto text-xs text-slate-400 font-medium truncate max-w-[200px]">
            {isCustom && uploadSummary ? 'Custom CSV' : DATASET_LABELS[selectedData as DataSourceType] ?? selectedData}
          </span>
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

          <div className="bg-slate-50/70 border border-slate-200/60 rounded-xl p-3">
            <div className="grid grid-cols-2 gap-4 divide-x divide-slate-200/80">
              {/* Geographic Regions */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-600">Geographic Regions</label>
                  {geoOptions.length > 5 && (
                    <div className="flex gap-2">
                      <button onClick={() => setConfig(p => ({ ...p, geos: geoOptions }))} className="text-xs text-slate-400 hover:text-brand-600 transition-colors">All</button>
                      <button onClick={() => setConfig(p => ({ ...p, geos: [] }))} className="text-xs text-slate-400 hover:text-brand-600 transition-colors">None</button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {geoOptions.map(g => (
                    <button key={g} onClick={() => toggleGeo(g)}
                      className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition-colors ${
                        config.geos.includes(g) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-surface-200 text-slate-600 hover:border-brand-300'
                      }`}>{g}</button>
                  ))}
                </div>
              </div>
              {/* Channels */}
              <div className="pl-4">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Channels</label>
                <div className="flex flex-wrap gap-1.5">
                  {channelOptions.map(ch => (
                    <button key={ch} onClick={() => toggleChannel(ch)}
                      className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition-colors ${
                        config.channels.includes(ch) ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-surface-200 text-slate-600 hover:border-brand-300'
                      }`}>{ch}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <details className="group">
            <summary className="flex items-center justify-between px-3 py-2.5 bg-slate-700 hover:bg-slate-800 border border-slate-700 rounded-xl cursor-pointer select-none transition-colors">
              <div className="flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5 text-slate-300" />
                <span className="text-xs font-semibold text-slate-100">Advanced options</span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-300 transition-transform group-open:rotate-180" />
            </summary>

            <div className="mt-0 p-4 bg-surface-50 border border-slate-200/60 space-y-5">
              {/* 3-column grid: Media settings | Sampling runs | Prior beliefs */}
              <div className="grid grid-cols-3 gap-5 divide-x divide-slate-200/80">

                {/* Col 1 — Media settings */}
                <div className="space-y-4">
                  <div className="flex items-center gap-1">
                    <p className="text-xs font-semibold text-slate-600">Media settings</p>
                    <SectionTooltip content="Controls how the model understands your advertising. This is where you tell it how long an ad keeps working after it runs, how quickly that effect wears off, and whether you want the model to validate its predictions. Think of it as the campaign planning rulebook: get these right and every ROI estimate in your report becomes more trustworthy." />
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">Carryover window (weeks)</p>
                        <SectionTooltip content="After you run an ad, it keeps influencing sales for several weeks. This setting tells the model how many weeks to keep tracking that effect before assuming it has worn off. TV ads usually linger longer than digital ads. 8 weeks is a good starting point for most brands." />
                      </div>
                      <input
                        type="number" min={1} max={13} value={config.maxLag}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, maxLag: parseInt(e.target.value) || 8 })) }}
                        className="w-full px-2.5 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                      />
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Weeks before ad effects fully fade. Default: 8.</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">Decay function</p>
                        <SectionTooltip content="How the leftover ad effect fades each week. Geometric means it drops by the same percentage every week, steady and simple. Binomial means the effect grows a little before it starts fading. Most campaigns work fine with Geometric, so keep it there unless you have a reason to change." />
                      </div>
                      <select
                        value={config.adstockDecay}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, adstockDecay: e.target.value as 'geometric' | 'binomial' })) }}
                        className="w-full px-2 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                      >
                        <option value="geometric">Geometric</option>
                        <option value="binomial">Binomial</option>
                      </select>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Geometric decays smoothly; binomial peaks then drops.</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">Hold out for validation</p>
                        <SectionTooltip content="Hides your most recent weeks from the model while it trains, then checks how well it predicted those hidden weeks afterward. Think of it as a pop quiz for the model. If it scores well, you can trust its estimates more. A 10% holdout is a good starting point." />
                      </div>
                      <select
                        value={config.holdoutPct}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, holdoutPct: parseFloat(e.target.value) })) }}
                        className="w-full px-2 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                      >
                        <option value={0}>None</option>
                        <option value={0.1}>10%</option>
                        <option value={0.2}>20%</option>
                      </select>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Reserve last N% of weeks to test prediction accuracy.</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">Prior type</p>
                        <SectionTooltip content="How you want to express your starting guess about each channel. ROI means you say 'I expect roughly X dollars back per dollar spent' which is easy to reason about. Coefficient is a more technical format used by researchers. Stick with ROI unless your analytics team asks otherwise." />
                      </div>
                      <select
                        value={config.mediaPriorType}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, mediaPriorType: e.target.value as 'roi' | 'coefficient' })) }}
                        className="w-full px-2 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                      >
                        <option value="roi">ROI</option>
                        <option value="coefficient">Coefficient</option>
                      </select>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">ROI = dollars returned per dollar spent. Easier to interpret.</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">How media effects are distributed</p>
                        <SectionTooltip content="The shape the model uses to describe how ad impact is spread across your data. Log-normal handles the reality that a few big weeks drive most of the results, which is true for most marketing campaigns. Only change this if your analytics team specifically asks you to use Normal." />
                      </div>
                      <select
                        value={config.mediaEffectsDist ?? 'log_normal'}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, mediaEffectsDist: e.target.value as 'log_normal' | 'normal' })) }}
                        className="w-full px-2 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                      >
                        <option value="log_normal">log_normal</option>
                        <option value="normal">normal</option>
                      </select>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Log-normal is standard. National runs may coerce to Normal.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox" id="hillBeforeAdstock"
                        checked={config.hillBeforeAdstock ?? false}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, hillBeforeAdstock: e.target.checked })) }}
                        className="rounded border-surface-300 w-4 h-4 cursor-pointer mt-0.5 shrink-0"
                      />
                      <div>
                        <div className="flex items-center gap-1">
                          <label htmlFor="hillBeforeAdstock" className="text-xs font-semibold text-slate-700 cursor-pointer">Diminishing returns before carryover</label>
                          <SectionTooltip content="Changes the order of two internal steps the model runs. When on, the model first applies the rule that spending more gets you less per dollar, then spreads the effect across weeks. When off, it does it the other way around. There is no clear winner for most campaigns. Leave it off." />
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Leave off unless you have a specific reason.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox" id="uniqueSigmaPerGeo"
                        checked={config.uniqueSigmaPerGeo ?? false}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, uniqueSigmaPerGeo: e.target.checked })) }}
                        className="rounded border-surface-300 w-4 h-4 cursor-pointer mt-0.5 shrink-0"
                      />
                      <div>
                        <div className="flex items-center gap-1">
                          <label htmlFor="uniqueSigmaPerGeo" className="text-xs font-semibold text-slate-700 cursor-pointer">Different sensitivity per region</label>
                          <SectionTooltip content="When on, the model treats each region as its own market that reacts to ads in its own way. Useful if you know some regions respond very differently to ads than others. The trade-off is longer run time and you need more data for it to work reliably." />
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Each region gets its own responsiveness estimate. Slows convergence.</p>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">Prior validation samples</p>
                        <SectionTooltip content="Before the real training starts, the model runs a quick check using only your starting assumptions, no data yet. This helps catch obvious setup problems early. Think of it as a dry run. More samples make the check more thorough but add a few seconds to startup time." />
                      </div>
                      <input
                        type="number" min={50} max={2000} step={50}
                        value={config.nPriorDraws ?? 256}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, nPriorDraws: parseInt(e.target.value, 10) || 256 })) }}
                        className="w-full px-2.5 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                      />
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Test runs before model trains. Default: 256.</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">KPI type</p>
                        <SectionTooltip content="Choose 'Revenue' when your outcome column is direct sales in dollars. Choose 'Non-revenue KPI' when your outcome is leads, sign-ups, app installs, or any non-monetary unit — then set a dollar value per unit so the optimizer can still calculate ROI." />
                      </div>
                      <select
                        value={config.kpiType ?? 'revenue'}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, kpiType: e.target.value as 'revenue' | 'non_revenue' })) }}
                        className="w-full px-2 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                      >
                        <option value="revenue">Revenue (default)</option>
                        <option value="non_revenue">Non-revenue KPI</option>
                      </select>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Use non-revenue when KPI is leads, installs, or sign-ups.</p>
                    </div>
                    {(config.kpiType ?? 'revenue') === 'non_revenue' && (
                      <div>
                        <div className="flex items-center gap-1 mb-1">
                          <p className="text-xs font-semibold text-slate-700">Revenue per KPI unit ($)</p>
                          <SectionTooltip content="How much each KPI unit is worth in dollars. Example: if a sign-up is worth $50 on average, enter 50. This lets the model calculate ROI in dollar terms even when your outcome isn't direct revenue." />
                        </div>
                        <input
                          type="number" min={0} step={1}
                          value={config.revenuePerKpi ?? ''}
                          placeholder="e.g. 50"
                          onChange={e => { setApplied(false); setConfig(p => ({ ...p, revenuePerKpi: parseFloat(e.target.value) || undefined })) }}
                          className="w-full px-2.5 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                        />
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Dollar value of each KPI unit for ROI calculations.</p>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox" id="useOptimalFrequency"
                        checked={config.useOptimalFrequency ?? false}
                        onChange={e => { setApplied(false); setConfig(p => ({ ...p, useOptimalFrequency: e.target.checked })) }}
                        className="rounded border-surface-300 w-4 h-4 cursor-pointer mt-0.5 shrink-0"
                      />
                      <div>
                        <div className="flex items-center gap-1">
                          <label htmlFor="useOptimalFrequency" className="text-xs font-semibold text-slate-700 cursor-pointer">Use optimal frequency (R&amp;F channels)</label>
                          <SectionTooltip content="Reach &amp; Frequency channels (display, video) have a known frequency at which they perform best — showing the same ad too many or too few times reduces impact. When enabled, Meridian's optimizer finds the optimal impression frequency per channel rather than just optimizing spend. Declare R&F channels by including reach and frequency columns in your CSV alongside the channel's _spend column." />
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Enables frequency optimization for display/video channels.</p>
                      </div>
                    </div>
                    {config.useOptimalFrequency && (
                      <div>
                        <div className="flex items-center gap-1 mb-1">
                          <p className="text-xs font-semibold text-slate-700">Max frequency cap</p>
                          <SectionTooltip content="The maximum average number of times a person should see your ad per week. Meridian will not recommend a frequency above this cap. Typical values: 3–7 for display, 2–5 for video. Leave blank for no cap." />
                        </div>
                        <input
                          type="number" min={1} max={20} step={1}
                          value={config.maxFrequency ?? ''}
                          placeholder="e.g. 5"
                          onChange={e => { setApplied(false); setConfig(p => ({ ...p, maxFrequency: parseInt(e.target.value, 10) || undefined })) }}
                          className="w-full px-2.5 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
                        />
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Max weekly impressions per person. Typical: 3–7.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Col 2 — Sampling runs */}
                <div className="space-y-4 pl-5">
                  <div className="flex items-center gap-1">
                    <p className="text-xs font-semibold text-slate-600">Sampling runs</p>
                    <SectionTooltip content="Controls how long the model spends building up its estimates. The model works by running thousands of simulations to figure out the most likely ROI for each channel. More runs means tighter, more reliable confidence ranges, but the analysis takes longer. The three numbers here are: practice runs (warm-up), settling runs (burn-in), and the results the model actually keeps (recorded samples)." />
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">Warm-up runs</p>
                        <SectionTooltip content="Practice rounds the model runs before it starts recording any results. During this time it figures out how to move around your data efficiently. None of these results are kept. More warm-up rounds means the model is better prepared, but it adds to overall run time." />
                      </div>
                      <input type="number" value={config.nAdapt}
                        onChange={e => { setApplied(false); setConfig(p => ({...p, nAdapt: parseInt(e.target.value)})) }}
                        className="w-full px-2.5 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200" />
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Model explores the solution space before recording. Default: 1,000.</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">Burn-in runs</p>
                        <SectionTooltip content="Right after warm-up, the model might still be settling into its answers. Burn-in runs are that settling period and those results get thrown away too. Once it stabilizes, recording begins. If you see unstable or weird results, increasing this number often helps." />
                      </div>
                      <input type="number" value={config.nBurnin}
                        onChange={e => { setApplied(false); setConfig(p => ({...p, nBurnin: parseInt(e.target.value)})) }}
                        className="w-full px-2.5 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200" />
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Early samples discarded after stabilization. Default: 500.</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-700">Recorded samples</p>
                        <SectionTooltip content="The results the model actually keeps and uses to build your ROI numbers and confidence ranges. More recorded samples means tighter, more reliable confidence ranges, but the model takes longer to run. 1,000 is a good balance for most use cases." />
                      </div>
                      <input type="number" value={config.nKeep}
                        onChange={e => { setApplied(false); setConfig(p => ({...p, nKeep: parseInt(e.target.value)})) }}
                        className="w-full px-2.5 py-1.5 text-xs border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200" />
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Used for final estimates and confidence intervals. Default: 1,000.</p>
                    </div>
                  </div>
                </div>

                {/* Col 3 — Prior beliefs */}
                <div className="space-y-3 pl-5">
                  <div>
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-semibold text-slate-600">Prior beliefs</p>
                      <SectionTooltip content="Your starting guess about each channel's ROI before the model looks at the data. The model will adjust these based on what the data actually shows. If you have no strong opinion, leave the defaults. A higher mu means you expect better returns. A higher sigma means you are less certain about that guess." />
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Starting ROI assumption per channel. Meridian defaults: mu 0.2, sigma 0.9.</p>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-surface-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface-50 text-left">
                          <th className="px-2.5 py-2 font-semibold text-slate-500">Channel</th>
                          <th className="px-2.5 py-2 font-semibold text-slate-500">μ</th>
                          <th className="px-2.5 py-2 font-semibold text-slate-500">σ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {config.channels.map((ch, idx) => {
                          const prior = config.channelPriors?.[ch] ?? { mu: 0.2, sigma: 0.9 }
                          return (
                            <tr key={ch} className={idx % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'}>
                              <td className="px-2.5 py-1.5 font-medium text-slate-700 truncate max-w-[5rem]">{ch}</td>
                              <td className="px-2.5 py-1.5">
                                <input
                                  type="number" step={0.1} min={0} max={5}
                                  value={prior.mu}
                                  onChange={e => {
                                    const mu = parseFloat(e.target.value) || 0.2
                                    setApplied(false)
                                    setConfig(p => ({ ...p, channelPriors: { ...p.channelPriors, [ch]: { ...prior, mu } } }))
                                  }}
                                  className="w-14 px-1.5 py-0.5 border border-surface-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-200 font-mono text-xs"
                                />
                              </td>
                              <td className="px-2.5 py-1.5">
                                <input
                                  type="number" step={0.1} min={0.1} max={3}
                                  value={prior.sigma}
                                  onChange={e => {
                                    const sigma = parseFloat(e.target.value) || 0.9
                                    setApplied(false)
                                    setConfig(p => ({ ...p, channelPriors: { ...p.channelPriors, [ch]: { ...prior, sigma } } }))
                                  }}
                                  className="w-14 px-1.5 py-0.5 border border-surface-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-200 font-mono text-xs"
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={() => { setApplied(false); setConfig(p => ({ ...p, channelPriors: Object.fromEntries(p.channels.map(ch => [ch, { mu: 0.2, sigma: 0.9 }])) })) }}
                    className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>

              {/* Calibration — full width below */}
              <div className="space-y-3 pt-4 border-t border-slate-200/60">
                <div>
                  <div className="flex items-center gap-1">
                    <p className="text-xs font-semibold text-slate-600">Calibration experiments</p>
                    <SectionTooltip content="If you have run a real test in the past where you turned off spend in some markets and measured the sales difference, you can add that result here. The model uses it as a reality check to make sure its estimates line up with what actually happened when you ran that test." />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    Add real holdout test results here. The model uses them to verify its ROI estimates against measured lift.
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
                        {(config.calibrationPeriods ?? []).map((cp, idx) => {
                          const update = (patch: Partial<typeof cp>) => {
                            setApplied(false)
                            setConfig(p => ({ ...p, calibrationPeriods: (p.calibrationPeriods ?? []).map((x, i) => i === idx ? { ...x, ...patch } : x) }))
                          }
                          return (
                            <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'}>
                              <td className="px-2 py-1">
                                <select value={cp.channel} onChange={e => update({ channel: e.target.value })}
                                  className="w-full px-1.5 py-0.5 text-xs border border-surface-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-200">
                                  {config.channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                                </select>
                              </td>
                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1">
                                  <input type="date" value={cp.startDate} onChange={e => update({ startDate: e.target.value })}
                                    className="px-1.5 py-0.5 text-xs border border-surface-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-200" />
                                  <span className="text-slate-400">→</span>
                                  <input type="date" value={cp.endDate} onChange={e => update({ endDate: e.target.value })}
                                    className="px-1.5 py-0.5 text-xs border border-surface-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-200" />
                                </div>
                              </td>
                              <td className="px-2 py-1">
                                <div className="flex items-center gap-0.5">
                                  <input type="number" min={0} max={1} step={0.01} value={cp.liftPct}
                                    onChange={e => update({ liftPct: parseFloat(e.target.value) || 0 })}
                                    className="w-16 px-1.5 py-0.5 text-xs border border-surface-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-200" />
                                  <span className="text-slate-400 text-xs">×</span>
                                </div>
                              </td>
                              <td className="px-2 py-1">
                                <select value={cp.experimentType} onChange={e => update({ experimentType: e.target.value as 'holdout' | 'matched_markets' })}
                                  className="w-full px-1.5 py-0.5 text-xs border border-surface-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-200">
                                  <option value="holdout">Holdout</option>
                                  <option value="matched_markets">Matched markets</option>
                                </select>
                              </td>
                              <td className="px-2 py-1 text-right">
                                <button onClick={() => setConfig(p => ({ ...p, calibrationPeriods: (p.calibrationPeriods ?? []).filter((_, i) => i !== idx) }))}
                                  className="text-slate-400 hover:text-red-500 transition-colors">✕</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <button
                  onClick={() => {
                    const channel = config.channels[0] ?? ''
                    setApplied(false)
                    setConfig(p => ({ ...p, calibrationPeriods: [...(p.calibrationPeriods ?? []), { channel, startDate: p.startDate, endDate: p.endDate, liftPct: 0.10, experimentType: 'holdout' }] }))
                  }}
                  className="text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 transition-colors"
                >
                  + Add calibration experiment
                </button>
              </div>
            </div>
          </details>

          <div className="space-y-3">
            {applied ? (
              <p className="text-xs text-center text-green-600">Saved — scroll down to run the model.</p>
            ) : (
              <p className="text-xs text-center text-slate-400">Saving your configuration lets you return to these settings later. Once saved, run the model below.</p>
            )}
            <div className="flex items-center gap-6">
              <button onClick={() => { onApply(config); setApplied(true) }} disabled={isLoading}
                className={`flex-1 justify-center flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${applied ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'btn-primary'} ${isLoading ? 'opacity-50' : ''}`}>
                <Play className="w-4 h-4" />
                {isLoading ? 'Saving...' : applied ? 'Update configuration' : 'Save configuration and continue'}
              </button>
              <button
                onClick={() => setShowCodeModal(prev => !prev)}
                className="btn-secondary gap-1.5 text-xs shrink-0"
              >
                <Code2 className="w-3.5 h-3.5" />
                {showCodeModal ? 'Hide generated code' : 'Show generated code'}
                {showCodeModal ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
            {showCodeModal && <CodeBlock code={generatedCode} />}
          </div>
        </div>
      </div>
    </>
  )
}
