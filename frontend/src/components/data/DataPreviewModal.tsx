'use client'
import { useState, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { DataSourceType } from '@/lib/types'

// ── Meridian CSV file mapping ─────────────────────────────────────────────────
const CSV_FILES: Partial<Record<DataSourceType, string>> = {
  geo_no_rf:   '/data/geo_media.csv',
  geo_with_rf: '/data/geo_media_rf.csv',
  geo_organic: '/data/geo_all_channels.csv',
  national:    '/data/national_all_channels.csv',
  indonesia:   '/data/indonesia.csv',
}

// ── Column rename maps (Meridian generic → human-readable) ────────────────────
const COLUMN_MAPS: Partial<Record<DataSourceType, Record<string, string>>> = {
  geo_no_rf: {
    time: 'date',
    Channel0_impression: 'tv_impressions', Channel0_spend: 'tv_spend',
    Channel1_impression: 'paid_search_impressions', Channel1_spend: 'paid_search_spend',
    Channel2_impression: 'social_impressions', Channel2_spend: 'social_spend',
    Channel3_impression: 'display_impressions', Channel3_spend: 'display_spend',
    competitor_activity_score_control: 'competitor_activity',
    sentiment_score_control: 'sentiment_index',
  },
  geo_with_rf: {
    time: 'date',
    Channel0_impression: 'tv_impressions', Channel0_spend: 'tv_spend',
    Channel1_impression: 'paid_search_impressions', Channel1_spend: 'paid_search_spend',
    Channel2_impression: 'social_impressions', Channel2_spend: 'social_spend',
    Channel3_impression: 'youtube_impressions', Channel3_spend: 'youtube_spend',
    Channel3_reach: 'youtube_reach', Channel3_frequency: 'youtube_frequency',
    competitor_activity_score_control: 'competitor_activity',
    sentiment_score_control: 'sentiment_index',
  },
  geo_organic: {
    time: 'date',
    Channel0_impression: 'tv_impressions', Channel0_spend: 'tv_spend',
    Channel1_impression: 'paid_search_impressions', Channel1_spend: 'paid_search_spend',
    Channel2_impression: 'social_impressions', Channel2_spend: 'social_spend',
    Channel3_impression: 'display_impressions', Channel3_spend: 'display_spend',
    Channel4_impression: 'ooh_impressions', Channel4_spend: 'ooh_spend',
    Organic_channel0_impression: 'organic_impressions',
    competitor_sales_control: 'competitor_sales',
    sentiment_score_control: 'sentiment_index',
    Promo: 'promo',
  },
  national: {
    time: 'date',
    Channel0_impression: 'tv_impressions', Channel0_spend: 'tv_spend',
    Channel1_impression: 'radio_impressions', Channel1_spend: 'radio_spend',
    Channel2_impression: 'paid_search_impressions', Channel2_spend: 'paid_search_spend',
    Channel3_impression: 'social_impressions', Channel3_spend: 'social_spend',
    Channel4_impression: 'display_impressions', Channel4_spend: 'display_spend',
    Organic_channel0_impression: 'organic_impressions',
    competitor_sales_control: 'competitor_sales',
    sentiment_score_control: 'sentiment_index',
    Promo: 'promo',
  },
  indonesia: {
    time: 'date',
    Channel0_impression: 'tv_impressions',           Channel0_spend: 'tv_spend',
    Channel1_impression: 'social_impressions',       Channel1_spend: 'social_spend',
    Channel2_impression: 'search_impressions',       Channel2_spend: 'search_spend',
    Channel3_impression: 'ooh_impressions',          Channel3_spend: 'ooh_spend',
    Channel4_impression: 'ecommerce_impressions',    Channel4_spend: 'ecommerce_spend',
    Channel5_impression: 'youtube_impressions',      Channel5_spend: 'youtube_spend',
    Channel6_impression: 'programmatic_impressions', Channel6_spend: 'programmatic_spend',
    Channel7_impression: 'influencer_impressions',   Channel7_spend: 'influencer_spend',
    competitor_sales_control: 'competitor_sales',
    sentiment_score_control: 'sentiment_index',
  },
}

// ── Simple CSV parser ─────────────────────────────────────────────────────────
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',')
  const rows = lines.slice(1).map(l => l.split(','))
  return { headers, rows }
}

// ── Format helpers ────────────────────────────────────────────────────────────
function formatValue(col: string, val: string, idr = false): string {
  const n = parseFloat(val)
  if (isNaN(n)) return val
  if (col.endsWith('_spend')) {
    return idr
      ? `Rp${(n / 1_000_000_000).toFixed(1)}B`
      : `$${(n / 1000).toFixed(1)}K`
  }
  if (col.endsWith('_impression') || col.endsWith('_impressions')) return n > 1000000 ? `${(n / 1000000).toFixed(1)}M` : `${(n / 1000).toFixed(0)}K`
  if (col === 'revenue') {
    return idr
      ? `Rp${(n / 1_000_000_000).toFixed(1)}B`
      : `$${(n / 1000).toFixed(1)}K`
  }
  if (col === 'population') return n > 1000000 ? `${(n / 1000000).toFixed(2)}M` : `${(n / 1000).toFixed(0)}K`
  if (col === 'conversions') return n > 1000000 ? `${(n / 1000000).toFixed(1)}M` : `${(n / 1000).toFixed(0)}K`
  if (Math.abs(n) < 10) return n.toFixed(3)
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

const PAGE_SIZE = 20

interface DataPreviewModalProps {
  sourceId: DataSourceType
  sourceLabel: string
  onClose: () => void
}

export default function DataPreviewModal({ sourceId, sourceLabel, onClose }: DataPreviewModalProps) {
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])

  const isIndonesia = sourceId === 'indonesia'

  useEffect(() => {
    setLoading(true)
    setError(null)
    const csvUrl = CSV_FILES[sourceId]
    if (!csvUrl) { setError('No CSV for this source'); setLoading(false); return }
    const idr = sourceId === 'indonesia'
    fetch(csvUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text() })
      .then(text => {
        const { headers: rawHeaders, rows: rawRows } = parseCSV(text)
        const colMap = COLUMN_MAPS[sourceId] ?? {}

        // Drop unnamed index column (leading comma in geo_all_channels)
        const startIdx = rawHeaders[0].trim() === '' ? 1 : 0
        const headers = rawHeaders.slice(startIdx)

        // Rename columns + inject computed revenue column
        const hasConversions = headers.includes('conversions')
        const hasRevPerConv = headers.includes('revenue_per_conversion')
        const injectRevenue = hasConversions && hasRevPerConv

        const finalCols = headers
          .map(h => colMap[h.trim()] ?? h.trim())
          .filter(h => h !== 'revenue_per_conversion') // hide raw revenue_per_conversion
        if (injectRevenue) {
          // Insert revenue after conversions
          const convIdx = finalCols.indexOf('conversions')
          finalCols.splice(convIdx + 1, 0, 'revenue')
        }

        const convRawIdx = headers.indexOf('conversions')
        const rpcRawIdx  = headers.indexOf('revenue_per_conversion')

        const finalRows = rawRows.map(row => {
          const sliced = row.slice(startIdx)
          const out: string[] = []
          sliced.forEach((val, i) => {
            const rawCol = headers[i]?.trim()
            const mapped = colMap[rawCol] ?? rawCol
            if (mapped === 'revenue_per_conversion') return
            const formatted = formatValue(mapped, val.trim(), idr)
            out.push(formatted)
            // inject revenue right after conversions
            if (injectRevenue && mapped === 'conversions') {
              const conv = parseFloat(sliced[convRawIdx] ?? '0')
              const rpc  = parseFloat(sliced[rpcRawIdx]  ?? '0')
              out.push(formatValue('revenue', String(conv * rpc), idr))
            }
          })
          return out
        })

        setColumns(finalCols)
        setRows(finalRows)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [sourceId])

  const total = rows.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900">{sourceLabel}: Data Preview</h3>
              {isIndonesia ? (
                <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                  Synthetic · IDR · 156 weeks
                </span>
              ) : (
                <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
                  Source: google/meridian
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {loading ? 'Loading...' : isIndonesia
                ? `${total.toLocaleString()} rows · ${columns.length} columns · all values in IDR`
                : `${total.toLocaleString()} rows · ${columns.length} columns · Meridian simulated_data`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading Meridian sample data...</span>
          </div>
        )}

        {error && (
          <div className="flex-1 flex items-center justify-center text-red-500 text-sm p-8 text-center">
            Could not load data file: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Column pills */}
            <div className="px-6 py-3 border-b border-surface-100 shrink-0">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Columns ({columns.length})</p>
              <div className="flex flex-wrap gap-1.5">
                {columns.map(col => (
                  <span key={col} className="px-2 py-0.5 bg-brand-50 text-brand-700 text-xs rounded-md font-mono font-medium">
                    {col}
                  </span>
                ))}
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-surface-50 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left text-slate-400 font-medium border-b border-surface-200 w-10">#</th>
                    {columns.map(col => (
                      <th key={col} className="px-3 py-2 text-left text-slate-600 font-semibold border-b border-surface-200 whitespace-nowrap font-mono">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {pageRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-surface-50/40'}>
                      <td className="px-3 py-2 text-slate-300 font-mono">{page * PAGE_SIZE + i + 1}</td>
                      {row.map((val, j) => (
                        <td key={j} className="px-3 py-2 text-slate-700 whitespace-nowrap font-mono">{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-6 py-3 border-t border-surface-200 flex items-center justify-between shrink-0">
              <p className="text-xs text-slate-400">
                Rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="p-1.5 rounded-lg hover:bg-surface-100 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                <span className="text-xs text-slate-500">Page {page + 1} of {pageCount}</span>
                <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page === pageCount - 1}
                  className="p-1.5 rounded-lg hover:bg-surface-100 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
