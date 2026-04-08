'use client'
import { useState, useRef } from 'react'
import { MapPin, Radio, Leaf, Globe, ChevronRight, ChevronDown, CheckCircle2, Table2, Upload, Loader2, BarChart2, Sliders, TrendingUp } from 'lucide-react'
import type { DataSourceType, DataSource, UploadedDataSummary } from '@/lib/types'
import { uploadCsv } from '@/lib/api'
import DataPreviewModal from './DataPreviewModal'

const DATA_SOURCES: DataSource[] = [
  {
    id: 'geo_no_rf',
    label: 'Geographic Data',
    description: 'Marketing data broken down by 20 regions, 156 weeks of spend and revenue across 4 media channels.',
    useCase: 'Best for brands running campaigns across regions where you want to compare performance market-by-market.',
    channels: ['TV', 'Paid Search', 'Social', 'Display'],
    geos: Array.from({ length: 20 }, (_, i) => `Geo${i}`),
  },
  {
    id: 'geo_with_rf',
    label: 'Geographic + Reach & Frequency',
    description: 'Same 20-region breakdown with YouTube reach and frequency columns alongside spend data.',
    useCase: 'Best when you run TV or video campaigns and want to understand whether reach or frequency is driving more impact.',
    channels: ['TV', 'Paid Search', 'Social', 'YouTube (RF)'],
    geos: Array.from({ length: 20 }, (_, i) => `Geo${i}`),
  },
  {
    id: 'geo_organic',
    label: 'Geographic + Organic & Non-Media',
    description: '40 regions, 5 paid channels, plus organic impressions, promotions, and competitor controls.',
    useCase: 'Use this when you want to isolate what your paid media is actually doing versus natural growth, seasonality, or promotions.',
    channels: ['TV', 'Paid Search', 'Social', 'Display', 'OOH', 'Organic'],
    geos: Array.from({ length: 40 }, (_, i) => `Geo${i}`),
  },
  {
    id: 'national',
    label: 'National Data',
    description: 'Aggregate national-level data, 156 weeks, 5 paid channels plus organic and promo variables.',
    useCase: 'Simplest option. Good for brands with national campaigns and no need to analyze regional differences.',
    channels: ['TV', 'Radio', 'Paid Search', 'Social', 'Display', 'Organic'],
  },
  {
    id: 'indonesia',
    label: '🇮🇩 Indonesia Market',
    description: 'National dataset for the Indonesian market, 313 weeks (Jan 2019 to Dec 2024), IDR currency, with Ramadan/Lebaran, Harbolnas 11.11, year-end seasonality, and COVID-19 disruption.',
    useCase: 'Use this to explore Marketing Mix Modeling (MMM) with a realistic Indonesian channel mix across 6 years of data, including digital transformation, OOH collapse during COVID, and e-commerce growth.',
    channels: ['TV', 'Social', 'Search', 'OOH', 'E-commerce', 'YouTube', 'Programmatic', 'Influencer'],
  },
]

const ICONS: Record<DataSourceType, React.ComponentType<{ className?: string }>> = {
  custom_csv:  Upload,
  indonesia:   Globe,
  geo_no_rf:   MapPin,
  geo_with_rf: Radio,
  geo_organic: Leaf,
  national:    Globe,
}

const ROW_COUNTS: Record<DataSourceType, { rows: number; cols: number }> = {
  custom_csv:  { rows: 0, cols: 0 },
  indonesia:   { rows: 313, cols: 21 },
  geo_no_rf:   { rows: 3120, cols: 15 },
  geo_with_rf: { rows: 3120, cols: 17 },
  geo_organic: { rows: 6240, cols: 20 },
  national:    { rows: 156,  cols: 17 },
}

// Recommended starter dataset
const RECOMMENDED_ID: DataSourceType = 'geo_no_rf'

interface SourceCardProps {
  source: DataSource
  selected: DataSourceType | null
  expanded: DataSourceType | null
  onSelect: (id: DataSourceType) => void
  setExpanded: (id: DataSourceType | null) => void
  setPreviewing: (id: DataSourceType | null) => void
  isCustom: boolean
}

function SourceCard({ source, selected, expanded, onSelect, setExpanded, setPreviewing, isCustom }: SourceCardProps) {
  const Icon = ICONS[source.id]
  const isSelected = selected === source.id
  const isExpanded = expanded === source.id
  const isRecommended = source.id === RECOMMENDED_ID
  const { rows, cols } = ROW_COUNTS[source.id]

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(isExpanded ? null : source.id)
  }

  return (
    <div
      className={`card transition-all ${
        isSelected
          ? isCustom ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-brand-500 ring-2 ring-brand-100'
          : isCustom ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-white hover:border-emerald-400 shadow-emerald-100 shadow-sm' : 'hover:border-brand-200'
      }`}
    >
      <div
        className="px-5 py-4 cursor-pointer"
        onClick={() => { onSelect(source.id); setExpanded(isExpanded ? null : source.id) }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`p-2 rounded-lg shrink-0 ${isSelected ? (isCustom ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600') : isCustom ? 'bg-emerald-50 text-emerald-500' : 'bg-surface-100 text-slate-500'}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-slate-900 text-sm">{source.label}</h3>
                {isRecommended && !isSelected && (
                  <span className="text-xs font-medium px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">Start here</span>
                )}
                {isSelected && <CheckCircle2 className={`w-4 h-4 shrink-0 ${isCustom ? 'text-emerald-500' : 'text-brand-500'}`} />}
                {isCustom && <span className="text-xs font-medium px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">IDR</span>}
                <span className="text-xs text-slate-400 font-mono">{rows.toLocaleString()} rows · {cols} cols</span>
              </div>
              <p className="text-sm text-slate-500 mt-0.5">{source.description}</p>
              {isRecommended && (
                <p className="text-xs text-green-600 mt-0.5">Start here if this is your first time running a model.</p>
              )}
            </div>
          </div>

          {/* Expand affordance */}
          <button
            type="button"
            onClick={toggleExpand}
            className={`flex items-center gap-1 text-xs shrink-0 mt-0.5 transition-colors ${isExpanded ? (isCustom ? 'text-emerald-600' : 'text-brand-600') : 'text-slate-400 hover:text-brand-500'}`}
          >
            <span className="hidden sm:inline">{isExpanded ? 'Hide details' : 'Show details'}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-surface-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">When to use this</p>
              <p className="text-sm text-slate-600">{source.useCase}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Channels included</p>
              <div className="flex flex-wrap gap-1.5">
                {source.channels.map(ch => (
                  <span key={ch} className={`px-2 py-0.5 text-xs rounded-md font-medium ${isCustom ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700'}`}>{ch}</span>
                ))}
              </div>
              {source.geos && (
                <p className="text-xs text-slate-400 mt-2">{source.geos.length} geographic regions (Geo0–Geo{source.geos.length - 1})</p>
              )}
            </div>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="px-5 pb-4 flex items-center gap-3">
          <button
            onClick={e => { e.stopPropagation(); setPreviewing(source.id) }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors shadow-sm ${isCustom ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-brand-600 hover:bg-brand-700'}`}
          >
            <Table2 className="w-4 h-4" />
            Preview data
          </button>
        </div>
      )}
    </div>
  )
}

// Collapsible CSV format guide
function CsvFormatGuide() {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand-600 transition-colors"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        CSV format guide
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-surface-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-50 text-left">
                <th className="px-3 py-2 font-semibold text-slate-500">Column name</th>
                <th className="px-3 py-2 font-semibold text-slate-500">What it means</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Example</th>
                <th className="px-3 py-2 font-semibold text-slate-500">Group</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {[
                { col: 'date',             desc: 'Week start date (YYYY-MM-DD) — one row per week', ex: '2024-01-07',  group: 'Required' },
                { col: 'revenue',          desc: 'Total revenue that week (KPI column)',              ex: '89500',       group: 'Required' },
                { col: 'tv_spend',         desc: 'TV spend that week (repeat for each channel)',       ex: '12400',       group: 'Media spend' },
                { col: 'paid_search_spend',desc: 'Paid Search spend that week',                       ex: '4800',        group: 'Media spend' },
                { col: 'geo',              desc: 'Region identifier — omit for national-level data',  ex: 'northeast',   group: 'Optional' },
                { col: 'promotion_flag',   desc: 'Binary column: 1 = promotional period, 0 = normal',ex: '1',           group: 'Controls (optional)' },
                { col: 'competitor_spend', desc: 'Competitor advertising spend — helps the model isolate your causal effect', ex: '5200', group: 'Controls (optional)' },
                { col: 'organic_impr',     desc: 'Organic impressions (social, search) — controls for earned media', ex: '42000', group: 'Controls (optional)' },
              ].map(r => (
                <tr key={r.col} className="bg-white">
                  <td className="px-3 py-2 font-mono text-slate-700">{r.col}</td>
                  <td className="px-3 py-2 text-slate-600">{r.desc}</td>
                  <td className="px-3 py-2 font-mono text-slate-400">{r.ex}</td>
                  <td className="px-3 py-2 text-slate-400 text-[10px]">{r.group}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface DataSourcePanelProps {
  selected: DataSourceType | null
  onSelect: (id: DataSourceType) => void
  onConfirm: () => void
  isLoading: boolean
  /** After server parses CSV — parent stores summary and can advance to config */
  onUploadSuccess?: (payload: {
    summary: UploadedDataSummary
    timespan: { start: string | null; end: string | null }
  }) => void
}

function rowColForSource(id: DataSourceType): { rows: number; cols: number } {
  if (id === 'custom_csv') return { rows: 0, cols: 0 }
  return ROW_COUNTS[id]
}

export default function DataSourcePanel({ selected, onSelect, onConfirm, isLoading, onUploadSuccess }: DataSourcePanelProps) {
  const [expanded, setExpanded] = useState<DataSourceType | null>(null)
  const [previewing, setPreviewing] = useState<DataSourceType | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const selectedSource = selected === 'custom_csv' ? null : DATA_SOURCES.find(d => d.id === selected)
  const SelectedIcon = selectedSource ? ICONS[selectedSource.id] : selected === 'custom_csv' ? Upload : null

  const handlePickCsv = () => {
    setUploadErr(null)
    fileRef.current?.click()
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setUploadBusy(true)
    setUploadErr(null)
    try {
      const res = await uploadCsv(f)
      onSelect('custom_csv')
      onUploadSuccess?.({ summary: res.summary as UploadedDataSummary, timespan: res.timespan })
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Value-first headline + 3-icon benefit bar */}
      <div>
        <details className="mb-3">
          <summary className="inline cursor-pointer text-xs text-brand-600 hover:text-brand-800 underline underline-offset-2 list-none">
            What is Marketing Mix Modeling?
          </summary>
          <span className="block mt-2 p-3 bg-brand-50 border border-brand-100 rounded-lg space-y-1.5 not-italic text-xs">
            <span className="block text-slate-700">Last-click and platform attribution only show part of the picture — they miss channels like TV, radio, and out-of-home. Marketing Mix Modeling looks at your historical spend and revenue across all channels together, then estimates what each actually caused versus what would have happened anyway.</span>
            <span className="block text-slate-700">This platform uses <strong>Google Meridian</strong> (Google's open-source Bayesian MMM framework built on JAX), which gives you a confidence range per channel, not just a single ROI number.</span>
          </span>
        </details>
        <h2 className="text-xl font-bold text-slate-900">Step 1: Choose your data</h2>
        <p className="text-sm text-slate-500 mt-1">Upload or choose a dataset to see how your marketing budget is actually driving revenue.</p>
        <div className="flex flex-wrap gap-4 mt-3">
          {[
            { Icon: BarChart2, label: 'Measure channel ROI' },
            { Icon: Sliders,   label: 'Optimize budget allocation' },
            { Icon: TrendingUp, label: 'Run what-if scenarios' },
          ].map(({ Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
              <Icon className="w-3.5 h-3.5 text-brand-500 shrink-0" />
              {label}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Marketing Mix Modeling (MMM) requires at least two years of weekly spend and revenue data. The datasets below simulate that setup. Choose the one that best matches your business.
        </p>
      </div>

      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />

      {uploadErr && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{uploadErr}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Left: data source selection */}
        <div className="lg:col-span-2 space-y-4">
          {/* Google Sample Datasets */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-surface-200" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Google Sample Dataset</span>
              <div className="flex-1 h-px bg-surface-200" />
            </div>
            {DATA_SOURCES.filter(s => s.id !== 'indonesia').map((source) => (
              <SourceCard key={source.id} source={source} selected={selected} expanded={expanded} onSelect={onSelect} setExpanded={setExpanded} setPreviewing={setPreviewing} isCustom={false} />
            ))}
          </div>

          {/* Custom Dataset */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-surface-200" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Custom Dataset</span>
              <div className="flex-1 h-px bg-surface-200" />
            </div>

            {DATA_SOURCES.filter(s => s.id === 'indonesia').map((source) => (
              <SourceCard key={source.id} source={source} selected={selected} expanded={expanded} onSelect={onSelect} setExpanded={setExpanded} setPreviewing={setPreviewing} isCustom={true} />
            ))}

            <div
              className={`card cursor-pointer transition-colors ${
                selected === 'custom_csv' ? 'border-emerald-500 ring-2 ring-emerald-100' : 'hover:border-emerald-300'
              }`}
              onClick={handlePickCsv}
            >
              <div className="px-4 py-4 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 shrink-0 self-start">
                  {uploadBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-slate-900 text-sm">Upload your own CSV</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Needs a <code className="font-mono bg-slate-100 px-1 rounded">date</code> column, a{' '}
                    <code className="font-mono bg-slate-100 px-1">revenue</code> column, and spend columns for each channel (e.g.{' '}
                    <code className="font-mono bg-slate-100 px-1">tv_spend</code>). An optional{' '}
                    <code className="font-mono bg-slate-100 px-1">geo</code> column enables regional breakdowns.
                  </p>
                  <CsvFormatGuide />
                </div>
                <button
                  type="button"
                  disabled={uploadBusy}
                  className="btn-primary justify-center sm:shrink-0 py-2.5 min-h-[44px] text-sm w-full sm:w-auto"
                  onClick={ev => { ev.stopPropagation(); handlePickCsv() }}
                >
                  Choose file
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: selection summary + load button */}
        <div className="lg:col-span-1 order-first lg:order-none">
          <div className="lg:sticky lg:top-4">
            {selectedSource && SelectedIcon ? (
              <div className="card card-body space-y-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Your selection</p>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-brand-50 text-brand-600 shrink-0">
                    <SelectedIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{selectedSource.label}</p>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono">
                      {rowColForSource(selectedSource.id).rows.toLocaleString()} rows · {rowColForSource(selectedSource.id).cols} cols
                    </p>
                  </div>
                </div>
                <p className="text-sm text-slate-500">{selectedSource.description}</p>
                <button
                  onClick={onConfirm}
                  disabled={isLoading}
                  className="btn-primary w-full justify-center py-3 text-base min-h-[48px]"
                >
                  {isLoading ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Loading {selectedSource.label}...</>
                  ) : (
                    <>Load {selectedSource.label} <ChevronRight className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            ) : (
              <div className="card card-body space-y-3 py-6">
                <p className="text-sm font-medium text-slate-700">Start by choosing a dataset</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Not sure which one? <strong className="text-slate-600">Geographic Data</strong> is the best starting point — it includes 4 channels and 3 years of weekly data.
                </p>
                <button
                  disabled
                  title="Select a dataset on the left to continue"
                  className="btn-primary w-full justify-center py-3 text-base min-h-[48px] opacity-40 cursor-not-allowed"
                >
                  Load Dataset <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {previewing && (
        <DataPreviewModal
          sourceId={previewing}
          sourceLabel={DATA_SOURCES.find(d => d.id === previewing)?.label ?? ''}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  )
}
