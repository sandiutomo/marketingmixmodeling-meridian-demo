'use client'
import { useState, useEffect, useMemo } from 'react'
import Header from '@/components/layout/Header'
import DemoDisclaimer from '@/components/layout/DemoDisclaimer'
import DataSourcePanel from '@/components/data/DataSourcePanel'
import ModelConfigPanel from '@/components/model/ModelConfigPanel'
import CodeExecutionButton from '@/components/model/CodeExecutionButton'
import BudgetAllocation from '@/components/tabs/BudgetAllocation'
import MeasuringROI from '@/components/tabs/MeasuringROI'
import ScenarioPlanning from '@/components/tabs/ScenarioPlanning'
import ChannelContribution from '@/components/tabs/ChannelContribution'
import CrossChannelImpact from '@/components/tabs/CrossChannelImpact'
import GeoBreakdown from '@/components/tabs/GeoBreakdown'
import ExportModal from '@/components/insights/ExportModal'
import {
  checkHealth,
  loadData,
  configureModel,
  fetchComputedResults,
  getHillParams,
  getAdstockParams,
  startModelJob,
  getModelJobStatus,
} from '@/lib/api'
import type { DataSourceType, ModelConfig, ModelResults, UploadedDataSummary } from '@/lib/types'
import GuidedTour from '@/components/onboarding/GuidedTour'
import GlossaryPanel from '@/components/onboarding/GlossaryPanel'
import ModelDiagnosticsPanel from '@/components/model/ModelDiagnosticsPanel'
import {
  AlertTriangle, X,
  Loader2, ChevronLeft, Share2, ShieldCheck, Lock, BarChart2,
  DollarSign, TrendingUp, Sliders, PieChart, GitMerge, Map,
} from 'lucide-react'
import { fmtPct } from '@/lib/format'

type AppStep = 'data' | 'config' | 'insights'
type InsightTab = 'budget' | 'roi' | 'scenario' | 'contribution' | 'cross' | 'geo'

const TABS: { id: InsightTab; label: string; short: string; icon: React.ComponentType<{ className?: string }>; blurb: string }[] = [
  {
    id: 'budget',
    label: 'Best Spend Split',
    short: 'Spend Split',
    icon: DollarSign,
    blurb: 'Where should your budget go? See which channels earn the most per dollar and get a recommended reallocation.',
  },
  {
    id: 'roi',
    label: 'ROI by Channel',
    short: 'ROI',
    icon: TrendingUp,
    blurb: 'How much revenue does each channel actually cause? Includes confidence ranges so you know how much to trust each number.',
  },
  {
    id: 'scenario',
    label: 'What-If Scenarios',
    short: 'What-Ifs',
    icon: Sliders,
    blurb: 'Simulate budget changes before committing. See the projected revenue impact of spending more or less on any channel.',
  },
  {
    id: 'contribution',
    label: 'What Drove Sales',
    short: 'Sales Drivers',
    icon: PieChart,
    blurb: 'Break down total revenue by source — which channels contributed how much, and how much came from non-media factors.',
  },
  {
    id: 'cross',
    label: 'Channel Interactions',
    short: 'Interactions',
    icon: GitMerge,
    blurb: 'Discover when channels amplify each other (e.g. TV lifts Search). Helps you avoid cutting a channel that quietly supports another.',
  },
  {
    id: 'geo',
    label: 'Regional View',
    short: 'Regions',
    icon: Map,
    blurb: 'See performance differences across markets or regions. The same budget can work very differently depending on the geography.',
  },
]

function buildRunModelCode(c: ModelConfig | null): string {
  if (!c) {
    return '# Apply configuration first — this block mirrors backend/services/meridian_runner.py'
  }
  return `# google-meridian 1.5.3 — same order as the backend job
# POST /data/load or /data/upload → DataLoaderService._loaded_data
# POST /model/configure → ModelRunnerService._config
# POST /model/run/start → background thread → sample_prior → sample_posterior → Analyzer

from meridian.data.nd_array_input_data_builder import NDArrayInputDataBuilder
from meridian.model.model import Meridian
from meridian.model import spec as model_spec_module
from meridian.analysis.analyzer import Analyzer
import arviz as az

# Channels: ${c.channels.join(', ')}
# Geos: ${c.geos.join(', ')}
# Window: ${c.startDate} … ${c.endDate}

builder = NDArrayInputDataBuilder(kpi_type='revenue')
builder.time_coords = time_coords
builder.media_time_coords = time_coords
builder.geos = geos
builder.with_population(population)
builder.with_kpi(kpi)
builder.with_media(media, media_spend, media_channel_names)
input_data = builder.build()

model_spec = model_spec_module.ModelSpec(
    max_lag=${c.maxLag},
    adstock_decay_spec="${c.adstockDecay}",
    media_prior_type="${c.mediaPriorType}",
    media_effects_dist="${c.mediaEffectsDist ?? 'log_normal'}",
    hill_before_adstock=${c.hillBeforeAdstock ?? false},
    unique_sigma_for_each_geo=${c.uniqueSigmaPerGeo ?? false},
)

model = Meridian(input_data=input_data, model_spec=model_spec)
model.sample_prior(n_draws=${c.nPriorDraws ?? 256}, seed=${c.seed ?? 42})
model.sample_posterior(
    n_chains=${c.nChains}, n_adapt=${c.nAdapt}, n_burnin=${c.nBurnin}, n_keep=${c.nKeep},
    seed=${c.seed ?? 42},
)
analyzer = Analyzer(model)
summary = analyzer.summary_metrics(confidence_level=0.9)
_ = analyzer.rhat_summary()
_ = analyzer.predictive_accuracy()
# ROI credible levels use metric= mean | ci_lo | ci_hi
_ = az.ess(model.inference_data, method='mean')
`
}

function TabSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-7 bg-ink-100 rounded-lg w-72 mb-2" />
        <div className="h-4 bg-ink-50 rounded w-96" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => <div key={i} className="h-24 bg-ink-50 rounded-xl border border-surface-200" />)}
      </div>
      <div className="h-72 bg-ink-50 rounded-xl border border-surface-200" />
      <div className="h-40 bg-ink-50 rounded-xl border border-surface-200" />
    </div>
  )
}

export default function Home() {
  const [appStep, setAppStep] = useState<AppStep>('data')
  const [activeTab, setActiveTab] = useState<InsightTab>('budget')
  const [selectedData, setSelectedData] = useState<DataSourceType | null>(null)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [isConfiguringModel, setIsConfiguringModel] = useState(false)
  const [backendWarning, setBackendWarning] = useState<string | null>(null)
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)
  const [isTabLoading, setIsTabLoading] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [modelResults, setModelResults] = useState<ModelResults | null>(null)
  const [isComputingResults, setIsComputingResults] = useState(false)
  const [appliedConfig, setAppliedConfig] = useState<ModelConfig | null>(null)
  const [uploadSummary, setUploadSummary] = useState<UploadedDataSummary | null>(null)
  const [uploadTimespan, setUploadTimespan] = useState<{ start: string | null; end: string | null } | null>(null)
  const [jobProgress, setJobProgress] = useState<string | null>(null)
  const [showAttributionVsMmmCard, setShowAttributionVsMmmCard] = useState(true)

  const runModelCode = useMemo(() => buildRunModelCode(appliedConfig), [appliedConfig])

  const currentStepNum = appStep === 'data' ? 1 : appStep === 'config' ? 2 : 3

  useEffect(() => {
    console.log('[App] Starting up — checking backend status...')
    checkHealth().then(ok => {
      setBackendOnline(ok)
      console.log(`[App] Backend: ${ok ? '✅ online' : '⚠️ offline — demo mode'}`)
    })
    if (!localStorage.getItem('mmm_tour_seen')) {
      setShowTour(true)
    }
  }, [])

  const handleTabChange = (tab: InsightTab, label: string) => {
    if (tab === activeTab) return
    console.log(`[App] Tab switch → "${label}"`)
    setIsTabLoading(true)
    setActiveTab(tab)
    setTimeout(() => setIsTabLoading(false), 650)
  }

  const handleLoadData = async () => {
    if (!selectedData || selectedData === 'custom_csv') return
    console.log(`[App] Loading dataset: "${selectedData}"`)
    setIsLoadingData(true)
    setBackendWarning(null)
    setUploadSummary(null)
    setUploadTimespan(null)
    try {
      await loadData(selectedData)
    } catch (e) {
      console.warn('[App] Data load failed — demo mode')
      setBackendWarning('Backend not connected. Running with pre-loaded sample data.')
    } finally {
      setIsLoadingData(false)
    }
    console.log('[App] Step 1 done → config')
    setTimeout(() => setAppStep('config'), 600)
  }

  const handleUploadSuccess = (payload: {
    summary: UploadedDataSummary
    timespan: { start: string | null; end: string | null }
  }) => {
    setUploadSummary(payload.summary)
    setUploadTimespan(payload.timespan)
    setBackendWarning(null)
    setAppStep('config')
  }

  const handleReset = () => {
    setJobProgress(null)
    setShowDiagnostics(modelResults !== null)
    setAppStep('config')
  }

  const handleConfigureModel = async (config: ModelConfig) => {
    setIsConfiguringModel(true)
    setAppliedConfig(config)
    try {
      await configureModel(config)
    } catch (e) {
      setBackendWarning('Backend not connected. Configuration saved locally.')
    } finally {
      setIsConfiguringModel(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      <Header currentStep={currentStepNum} backendOnline={backendOnline} />
      <div className="max-w-screen-xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DemoDisclaimer />

        {backendWarning && (
          <div className="flex items-start gap-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
            <span className="flex-1">{backendWarning}</span>
            <button onClick={() => setBackendWarning(null)} className="shrink-0 text-orange-400 hover:text-orange-600"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* ── STEP 1: Data ── */}
        {appStep === 'data' && (
          <div className="max-w-5xl mx-auto">
            <DataSourcePanel
              selected={selectedData}
              onSelect={setSelectedData}
              onConfirm={handleLoadData}
              isLoading={isLoadingData}
              onUploadSuccess={handleUploadSuccess}
            />
          </div>
        )}

        {/* ── STEP 2: Config ── */}
        {appStep === 'config' && (
          <div className="space-y-4">
            <button onClick={() => setAppStep('data')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
              <ChevronLeft className="w-4 h-4" /> Back to data selection
            </button>
            <div className="space-y-4">
              <ModelConfigPanel
                key={`${selectedData}-${uploadSummary?.n_times ?? 0}`}
                onApply={handleConfigureModel}
                isLoading={isConfiguringModel}
                selectedData={selectedData ?? 'geo_no_rf'}
                uploadSummary={uploadSummary}
                uploadTimespan={uploadTimespan}
              />

              <div className="card card-body space-y-4">
                <div>
                  <h3 className="font-bold text-ink-900 mb-0.5">Run the Analysis</h3>
                  <p className="text-sm text-ink-500 leading-relaxed">
                    This runs the Meridian statistical model on your data. It takes a few seconds to a minute.
                    When done, you'll get ROI per channel, revenue contribution breakdowns, and confidence ranges — all ready to explore.
                  </p>
                </div>

                {!appliedConfig && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Apply your configuration above before running the analysis.
                  </div>
                )}

                {appliedConfig && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    Configuration applied — {appliedConfig.channels.length} channels, {appliedConfig.startDate} to {appliedConfig.endDate}. Ready to run.
                  </div>
                )}

                {jobProgress && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    {jobProgress}
                  </div>
                )}

                <CodeExecutionButton
                  label="Run Model"
                  tooltip="Background job: sample_prior → sample_posterior → Analyzer (same as meridian_runner.py)."
                  whyItMatters={'This gives you confidence ranges, not just a single number. Instead of one ROI point, you get a credible range so you know how much to trust the estimate before shifting budget.'}
                  code={runModelCode}
                  disabled={!appliedConfig}
                  onExecute={async () => {
                    console.log('[App] Starting model job...')
                    setJobProgress(null)
                    try {
                      const { job_id } = await startModelJob()
                      for (;;) {
                        const st = await getModelJobStatus(job_id)
                        setJobProgress(st.message || `${st.status} ${st.progress != null ? Math.round(st.progress) + '%' : ''}`)
                        if (st.status === 'complete') break
                        if (st.status === 'error' || st.status === 'unknown') {
                          throw new Error(st.error || st.message || 'Job failed')
                        }
                        await new Promise(r => setTimeout(r, 1200))
                      }
                      console.log('[App] ✅ Model job complete')
                    } catch (e) {
                      console.warn('[App] Model job failed — falling back to sync or demo', e)
                      setJobProgress(null)
                      setBackendWarning(
                        e instanceof Error
                          ? `Job failed (${e.message}). If the API is older, ensure POST /model/run/start exists.`
                          : 'Background job failed.'
                      )
                    }
                    if (selectedData) {
                      setIsComputingResults(true)
                      fetchComputedResults(selectedData, appliedConfig ?? undefined).then(async r => {
                        const [hillParams, adstockParams] = await Promise.all([
                          getHillParams().catch(() => null),
                          getAdstockParams().catch(() => null),
                        ])
                        setModelResults({
                          ...r,
                          ...(hillParams   ? { hillParams }   : {}),
                          ...(adstockParams ? { adstockParams } : {}),
                        })
                      }).catch(() => {}).finally(() => { setIsComputingResults(false); setJobProgress(null) })
                    }
                    setShowDiagnostics(true)
                  }}
                  successMessage="Model complete — review diagnostics below, then continue."
                />

                {/* Continue to Results CTA — only shown after diagnostics are visible */}
                {showDiagnostics && (
                  <button
                    onClick={() => setAppStep('insights')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    View Results →
                  </button>
                )}
              </div>

              {showDiagnostics && <ModelDiagnosticsPanel modelResults={modelResults} />}
            </div>
          </div>
        )}

        {/* ── STEP 3: Insights ── */}
        {appStep === 'insights' && (
          <div className="space-y-4">
            {/* Top bar: back + freshness + model quality + export */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <button onClick={handleReset} className="flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800 transition-colors shrink-0">
                <ChevronLeft className="w-4 h-4" /> Back to setup
              </button>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {/* Data coverage */}
                <span className="text-xs text-ink-400 bg-white border border-surface-200 px-2.5 py-1 rounded-lg font-mono">
                  {modelResults
                    ? `${modelResults.dateRange} · ${modelResults.nGeos} region${modelResults.nGeos !== 1 ? 's' : ''} · ${modelResults.channels.length} channels`
                    : appliedConfig
                      ? `${appliedConfig.startDate} → ${appliedConfig.endDate} · running…`
                      : 'Preparing results…'}
                </span>
                {/* Model fit quality */}
                {modelResults ? (
                  modelResults.isRealMeridian ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Fit: Strong
                      <span className="text-green-500 font-normal hidden sm:inline font-mono">
                        · R² {fmtPct(modelResults.rSquared * 100, 0)}
                        · MAPE {fmtPct(modelResults.mape * 100)}
                      </span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Fit: Estimated
                      <span className="text-amber-500 font-normal hidden sm:inline font-mono">
                        · R² {fmtPct(modelResults.rSquared * 100, 0)}
                      </span>
                    </span>
                  )
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-400 bg-surface-100 border border-surface-200 px-2.5 py-1 rounded-lg">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Fit: calculating…
                  </span>
                )}
                {/* Export */}
                <button onClick={() => setShowExport(true)} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-white border border-surface-200 px-2.5 py-1 rounded-lg hover:border-brand-300 hover:text-brand-700 transition-colors">
                  <Share2 className="w-3.5 h-3.5" /> Export
                </button>
              </div>
            </div>

            {showAttributionVsMmmCard && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/40 overflow-hidden">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-brand-100">
                  <div>
                    <p className="text-sm font-bold text-ink-900">
                      These numbers look different from your tracking tool — here’s why that’s a good thing
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      MMM measures what your spend <em>caused</em>, not just what happened nearby. Think of it as causal analysis, not correlation.
                    </p>
                  </div>
                  <button type="button" onClick={() => setShowAttributionVsMmmCard(false)} aria-label="Dismiss" className="text-ink-400 hover:text-ink-600 shrink-0 mt-0.5 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {/* Cards row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-brand-100">
                  {[
                    {
                      Icon: ShieldCheck,
                      color: ‘text-brand-600’,
                      bg: ‘bg-brand-100/60’,
                      title: ‘Sees the full picture, not just the last click’,
                      body: ‘Your attribution tool gives all credit to the last ad a customer saw. MMM looks at months of spend history to figure out which channels are actually moving the needle — including slow-burn effects that show up weeks later.’,
                    },
                    {
                      Icon: Lock,
                      color: ‘text-green-600’,
                      bg: ‘bg-green-100/50’,
                      title: ‘No cookies, no tracking required’,
                      body: ‘MMM works with weekly totals — money spent, revenue earned. No user-level data, no cookies, no device IDs. That means results don\’t break when tracking changes.’,
                    },
                    {
                      Icon: BarChart2,
                      color: ‘text-purple-600’,
                      bg: ‘bg-purple-100/40’,
                      title: ‘Every number comes with a confidence range’,
                      body: ‘Instead of one ROI number per channel, you get a range. Tight range = act on it. Wide range = the model needs more data. This tells you where you can make bold moves and where you should go slow.’,
                    },
                  ].map(({ Icon, color, bg, title, body }) => (
                    <div key={title} className="flex gap-3 px-5 py-4">
                      <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
                        <Icon className={`w-4 h-4 ${color}`} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-ink-800 leading-snug">{title}</p>
                        <p className="text-xs text-ink-500 mt-1 leading-relaxed">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <details className="px-5 py-3 border-t border-brand-100">
                  <summary className="text-2xs text-ink-400 cursor-pointer hover:text-ink-600 select-none uppercase tracking-wide font-medium">For the curious: what’s happening under the hood</summary>
                  <p className="text-xs text-ink-500 mt-2 leading-relaxed">
                    Meridian runs a Bayesian statistical model (MCMC sampling) on your historical spend and revenue data.
                    Instead of one "best guess" ROI per channel, it produces thousands of plausible estimates — the range you see is the middle 90% of those.
                    The R̂ (R-hat) convergence check verifies the model’s four independent chains agreed, which is how we know the result is reliable.
                  </p>
                </details>
              </div>
            )}

            {/* Tab bar — horizontally scrollable on mobile */}
            <div className="space-y-2">
              <div className="overflow-x-auto pb-1">
                <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-xl w-max min-w-full sm:w-fit">
                  {TABS.map(tab => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.id
                    return (
                      <button key={tab.id}
                        onClick={() => handleTabChange(tab.id, tab.label)}
                        className={`flex items-center gap-1.5 px-3 md:px-3.5 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${isActive ? 'tab-active' : 'tab-inactive'}`}>
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-brand-500' : 'text-slate-400'}`} />
                        <span className="hidden sm:inline">{tab.label}</span>
                        <span className="sm:hidden">{tab.short}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* Active tab blurb — plain language explainer */}
              {(() => {
                const t = TABS.find(t => t.id === activeTab)
                return t ? (
                  <p className="text-xs text-ink-500 px-1 leading-relaxed">{t.blurb}</p>
                ) : null
              })()}
            </div>

            {/* Tab content with loading skeleton */}
            <div className="mt-2">
              {isTabLoading ? <TabSkeleton /> : (
                <>
                  {isComputingResults && !modelResults && (
                    <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700 mb-4">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      Crunching numbers — charts will appear automatically once the model finishes.
                    </div>
                  )}
                  {modelResults && backendOnline === false && (
                    <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 mb-4">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                      <span>
                        <strong>Illustrative numbers only.</strong>{' '}
                        The backend isn't connected, so these figures come from a simplified estimate — not the full Bayesian model.
                        They're directionally useful for exploring the UI, but don't use them for real decisions.
                        Connect the Python backend to run live Meridian analysis.
                      </span>
                    </div>
                  )}
                  {activeTab === 'budget' && <BudgetAllocation modelResults={modelResults} />}
                  {activeTab === 'roi' && <MeasuringROI modelResults={modelResults} />}
                  {activeTab === 'scenario' && <ScenarioPlanning modelResults={modelResults} />}
                  {activeTab === 'contribution' && <ChannelContribution modelResults={modelResults} />}
                  {activeTab === 'cross' && <CrossChannelImpact modelResults={modelResults} />}
                  {activeTab === 'geo' && <GeoBreakdown modelResults={modelResults} />}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {showExport && <ExportModal activeTab={activeTab} onClose={() => setShowExport(false)} isRealMeridian={modelResults?.isRealMeridian === true} />}
      {showTour && <GuidedTour onClose={() => { localStorage.setItem('mmm_tour_seen', '1'); setShowTour(false) }} />}
      <GlossaryPanel />
    </div>
  )
}
