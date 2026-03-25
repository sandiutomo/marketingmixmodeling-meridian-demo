'use client'
import { useState, useRef } from 'react'
import { MapPin, Radio, Leaf, Globe, ChevronRight, CheckCircle2, Table2, Upload, Loader2 } from 'lucide-react'
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
    description: '20 regions, 5 paid channels, plus organic impressions, promotions, and competitor controls.',
    useCase: 'Use this when you want to isolate what your paid media is actually doing versus natural growth, seasonality, or promotions.',
    channels: ['TV', 'Paid Search', 'Social', 'Display', 'OOH', 'Organic'],
    geos: Array.from({ length: 20 }, (_, i) => `Geo${i}`),
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
    description: 'National dataset for the Indonesian market — 313 weeks (Jan 2019–Dec 2024), IDR currency, with Ramadan/Lebaran, Harbolnas 11.11, year-end seasonality, and COVID-19 disruption.',
    useCase: 'Use this to explore MMM with a realistic Indonesian channel mix across 6 years of data — including digital transformation, OOH collapse during COVID, and e-commerce growth.',
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
  const { rows, cols } = ROW_COUNTS[source.id]

  return (
    <div
      className={`card transition-all ${
        isSelected
          ? isCustom ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-brand-500 ring-2 ring-brand-100'
          : isCustom ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-white hover:border-emerald-400 shadow-emerald-100 shadow-sm' : 'hover:border-brand-200'
      }`}
    >
      <div className="px-5 py-4 cursor-pointer" onClick={() => { onSelect(source.id); setExpanded(source.id) }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg shrink-0 ${isSelected ? (isCustom ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600') : isCustom ? 'bg-emerald-50 text-emerald-500' : 'bg-surface-100 text-slate-500'}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-slate-900 text-sm">{source.label}</h3>
                {isSelected && <CheckCircle2 className={`w-4 h-4 ${isCustom ? 'text-emerald-500' : 'text-brand-500'}`} />}
                {isCustom && <span className="text-xs font-medium px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">IDR</span>}
                <span className="text-xs text-slate-400 font-mono">{rows.toLocaleString()} rows · {cols} cols</span>
              </div>
              <p className="text-sm text-slate-500 mt-0.5">{source.description}</p>
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
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
        <div className="px-5 pb-4">
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
      <div className="p-4 bg-brand-50 border border-brand-100 rounded-xl space-y-2">
        <p className="text-sm font-semibold text-brand-800">What is Marketing Mix Modeling?</p>
        <p className="text-sm text-brand-700">Last-click and platform attribution only show part of the picture. They track clicks and conversions inside their own platforms (Facebook, TikTok, GA4, etc.), but they miss everything happening outside of that.</p>
        <p className="text-sm text-brand-700 mt-2">MMM takes a broader view. It looks at your historical spend and revenue across all channels together, then estimates what each channel actually contributed versus what would have happened anyway. This includes channels like TV, radio, and out-of-home — not just digital.</p>
        <p className="text-sm text-brand-700 mt-2">This demo uses <strong>Google Meridian</strong>, an open-source MMM framework. Instead of giving you a single ROI number, it shows a range for each channel, so you can see both the estimated impact and how confident the model is in that estimate.</p>
      </div>

      <div>
        <h2 className="text-xl font-bold text-slate-900">Step 1: Choose your data</h2>
        <p className="text-sm text-slate-500 mt-1">
  MMM typically requires at least two years of weekly spend and revenue data across all channels. 
  The datasets below simulate that setup.
</p>
<p className="text-sm text-slate-500">
  Choose the one that best matches your business:
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
              <div className="px-4 py-4 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 shrink-0 self-start">
                  {uploadBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-slate-900 text-sm">Upload your own CSV</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Requires a <code className="font-mono bg-slate-100 px-1 rounded">time</code> column, revenue (
                    <code className="font-mono bg-slate-100 px-1">revenue</code> or{' '}
                    <code className="font-mono bg-slate-100 px-1">conversions</code> ×{' '}
                    <code className="font-mono bg-slate-100 px-1">revenue_per_conversion</code>), and spend columns (
                    <code className="font-mono bg-slate-100 px-1">Channel0_spend</code> or{' '}
                    <code className="font-mono bg-slate-100 px-1">tv_spend</code>). Optional:{' '}
                    <code className="font-mono bg-slate-100 px-1">geo</code>, columns containing{' '}
                    <code className="font-mono bg-slate-100 px-1">control</code>.
                  </p>
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
              <div className="card card-body text-center py-8 space-y-2">
                <p className="text-sm text-slate-500 font-medium">No dataset selected yet</p>
                <p className="text-xs text-slate-400">Pick one from the list and your Load button will appear here.</p>
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
