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
  fetchModelFit,
} from '@/lib/api'
import type { DataSourceType, ModelConfig, ModelResults, UploadedDataSummary, ModelFitResult } from '@/lib/types'
import ModelFitChart from '@/components/charts/ModelFitChart'
import { deriveDataMethod } from '@/lib/types'
import DataMethodBadge from '@/components/ui/DataMethodBadge'
import GuidedTour from '@/components/onboarding/GuidedTour'
import GlossaryPanel from '@/components/onboarding/GlossaryPanel'
import ModelDiagnosticsPanel from '@/components/model/ModelDiagnosticsPanel'
import {
  AlertTriangle, X,
  Loader2, ChevronLeft, ChevronRight, Share2, ShieldCheck, Lock, BarChart2,
} from 'lucide-react'
import { fmtPct } from '@/lib/format'
import SectionTooltip from '@/components/ui/SectionTooltip'

const DATASET_LABELS: Record<string, string> = {
  geo_no_rf:   'Geographic Data',
  geo_with_rf: 'Geographic + Reach & Frequency',
  geo_organic: 'Geographic + Organic & Non-Media',
  national:    'National Data',
  indonesia:   'Indonesia Market',
  custom_csv:  'Custom CSV',
}

type AppStep = 'data' | 'config' | 'insights'
type InsightTab = 'budget' | 'roi' | 'scenario' | 'contribution' | 'cross' | 'geo'

const TABS: { id: InsightTab; label: string }[] = [
  { id: 'budget', label: 'Budget' },
  { id: 'roi', label: 'Channel ROI' },
  { id: 'scenario', label: 'Scenarios' },
  { id: 'contribution', label: 'Contribution' },
  { id: 'cross', label: 'Synergy' },
  { id: 'geo', label: 'Geography' },
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
        <div className="h-7 bg-slate-200 rounded-lg w-72 mb-2" />
        <div className="h-4 bg-slate-100 rounded w-96" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
      </div>
      <div className="h-72 bg-slate-100 rounded-xl" />
      <div className="h-40 bg-slate-100 rounded-xl" />
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
  const [jobProgressPct, setJobProgressPct] = useState<number | null>(null)
  const [showAttributionVsMmmCard, setShowAttributionVsMmmCard] = useState(true)
  const [tabOrderDismissed, setTabOrderDismissed] = useState(() =>
    typeof window !== 'undefined' && !!localStorage.getItem('mmm_tab_order_dismissed')
  )
  const [modelFitData, setModelFitData] = useState<ModelFitResult | null>(null)

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
    setJobProgressPct(null)
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
    <div className="min-h-screen bg-surface-50">
      <Header currentStep={currentStepNum} backendOnline={backendOnline} />
      <div className="max-w-screen-xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DemoDisclaimer datasetName={selectedData ? DATASET_LABELS[selectedData] : undefined} />

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
              <ChevronLeft className="w-4 h-4" /> Change data
            </button>
            <div className="space-y-0">
              {/* Step 1 — Configure */}
              <div className="flex gap-3 sm:gap-4">
                <div className="flex flex-col items-center pt-1 shrink-0">
                  <div className="w-7 h-7 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shadow-sm">1</div>
                  <div className="w-px flex-1 bg-surface-200 mt-1.5 mb-0" />
                </div>
                <div className="flex-1 pb-4">
                  <ModelConfigPanel
                    key={`${selectedData}-${uploadSummary?.n_times ?? 0}`}
                    onApply={handleConfigureModel}
                    isLoading={isConfiguringModel}
                    selectedData={selectedData ?? 'geo_no_rf'}
                    uploadSummary={uploadSummary}
                    uploadTimespan={uploadTimespan}
                  />
                </div>
              </div>

              {/* Step 2 — Run */}
              <div className="flex gap-3 sm:gap-4">
                <div className="flex flex-col items-center pt-1 shrink-0">
                  <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shadow-sm transition-colors ${appliedConfig ? 'bg-brand-500 text-white' : 'bg-surface-200 text-slate-400'}`}>2</div>
                  <div className="w-px flex-1 bg-surface-200 mt-1.5 mb-0" />
                </div>
                <div className="flex-1 pb-4">
                  <div className="card card-body space-y-4">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="font-bold text-slate-900">Run the model</h3>
                        <SectionTooltip content="Executes Bayesian MCMC sampling across 4 independent chains. The result is a posterior distribution, which is the source of your confidence ranges. A point estimate says '3.2x'; the posterior says '90% chance it's between 2.4x and 4.1x'." />
                      </div>
                      <p className="text-sm text-slate-500">Estimates each channel's true contribution to revenue, including confidence ranges for every number.</p>
                    </div>

                    {!appliedConfig && (
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        Set your configuration above, then come back here to run the model.
                      </div>
                    )}

                    {appliedConfig && (
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                        Ready — {appliedConfig.channels.length} channels · {appliedConfig.startDate} to {appliedConfig.endDate}
                      </div>
                    )}

                    <CodeExecutionButton
                      label="Run the model"
                      tooltip="Runs as a background job: sample_prior → sample_posterior → Analyzer."
                      whyItMatters={'This gives you confidence ranges, not just a single number. Instead of one ROI point, you get a credible range so you know how much to trust the estimate before shifting budget.'}
                      code={runModelCode}
                      disabled={!appliedConfig}
                      statusText={jobProgress ?? null}
                      externalProgress={jobProgressPct ?? null}
                      onExecute={async () => {
                        console.log('[App] Starting model job...')
                        setJobProgress(null)
                        try {
                          const { job_id } = await startModelJob()
                          for (;;) {
                            const st = await getModelJobStatus(job_id)
                            setJobProgress(st.message || `${st.status} ${st.progress != null ? Math.round(st.progress) + '%' : ''}`)
                            setJobProgressPct(st.progress != null ? Math.round(st.progress) : null)
                            if (st.status === 'complete') break
                            if (st.status === 'error' || st.status === 'unknown') {
                              throw new Error(st.error || st.message || 'Job failed')
                            }
                            await new Promise(r => setTimeout(r, 1200))
                          }
                          console.log('[App] Model job complete')
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
                          }).catch(() => {}).finally(() => { setIsComputingResults(false); setJobProgress(null); setJobProgressPct(null) })
                        }
                        setShowDiagnostics(true)
                        fetchModelFit().then(setModelFitData).catch(() => {})
                      }}
                      successMessage="Done. Check the diagnostics below, then continue to your results."
                    />

                    {jobProgress !== null && (
                      <p className="text-xs text-slate-400 text-center">
                        Estimated time: 2–5 minutes based on your sampling settings. Most runs finish within this range.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 3 — Model Fit (conditional) */}
              {showDiagnostics && modelFitData && (
                <div className="flex gap-3 sm:gap-4">
                  <div className="flex flex-col items-center pt-1 shrink-0">
                    <div className="w-7 h-7 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shadow-sm">3</div>
                    <div className="w-px flex-1 bg-surface-200 mt-1.5 mb-0" />
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="card card-body space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-slate-900 text-sm">Model Fit</h3>
                        <SectionTooltip content="This chart is your model's report card. The black line is what actually happened each week. The orange dashed line is what the model predicted. The closer they track together, the better the model has learned your campaign patterns. The shaded area is the model's confidence band: 90% of the time it expects the true value to fall within that range. A model that fits well here will give you more trustworthy ROI and budget numbers on the next screen." />
                      </div>
                      <ModelFitChart data={modelFitData} currency={modelResults?.currency ?? 'USD'} />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4 — Diagnostics (conditional) */}
              {showDiagnostics && (
                <div className="flex gap-3 sm:gap-4">
                  <div className="flex flex-col items-center pt-1 shrink-0">
                    <div className="w-7 h-7 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shadow-sm">{modelFitData ? 4 : 3}</div>
                  </div>
                  <div className="flex-1 pb-4">
                    <ModelDiagnosticsPanel modelResults={modelResults} onContinue={() => setAppStep('insights')} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3: Insights ── */}
        {appStep === 'insights' && (
          <div className="space-y-4">
            {/* Top bar: back + freshness + model quality + export */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <button onClick={handleReset} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors shrink-0">
                <ChevronLeft className="w-4 h-4" /> Back to setup
              </button>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {/* Data freshness — dataset + date range once computed */}
                <span className="text-xs text-slate-400 bg-white border border-surface-200 px-2.5 py-1 rounded-lg">
                  {selectedData ? <span className="font-medium text-slate-500">{DATASET_LABELS[selectedData] ?? selectedData}</span> : null}
                  {selectedData ? ' · ' : null}
                  {modelResults
                    ? `${modelResults.dateRange} · ${modelResults.nGeos} geo${modelResults.nGeos !== 1 ? 's' : ''} · ${modelResults.channels.length} channels`
                    : appliedConfig
                      ? `${appliedConfig.startDate} to ${appliedConfig.endDate} · computing…`
                      : 'Computing…'}
                </span>
                {/* Data method indicator */}
                <span className="flex items-center">
                  <DataMethodBadge method={deriveDataMethod(modelResults)} />
                  {modelResults?.isRealMeridian && (
                    <span className="text-xs text-green-500 font-normal ml-1.5 hidden sm:inline">
                      {fmtPct(modelResults.rSquared * 100, 0)} R² · MAPE {fmtPct(modelResults.mape * 100)}
                    </span>
                  )}
                </span>
                {/* Export */}
                <button onClick={() => setShowExport(true)} className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-white border border-surface-200 px-2.5 py-1 rounded-lg hover:border-brand-300 hover:text-brand-700 transition-colors">
                  <Share2 className="w-3.5 h-3.5" /> Export
                </button>
              </div>
            </div>

            {showAttributionVsMmmCard && (
              <div className="card card-body border border-brand-100 bg-brand-50/30">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Why these numbers look different from your ad platform</p>
                    <p className="text-xs text-slate-500 mt-0.5">This model estimates what your spend actually caused — not just what happened around the same time.</p>
                  </div>
                  <button type="button" onClick={() => setShowAttributionVsMmmCard(false)} className="text-slate-400 hover:text-slate-600 shrink-0 mt-0.5">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    {
                      Icon: ShieldCheck,
                      color: 'text-brand-600',
                      title: 'Sees the full impact, not just the last click',
                      body: 'Standard attribution gives credit to the last touchpoint before a purchase. This model looks at your full history to estimate how much revenue each channel actually drove, even when the impact shows up later.',
                    },
                    {
                      Icon: Lock,
                      color: 'text-green-600',
                      title: 'Privacy-safe',
                      body: 'Only uses aggregated weekly spend and revenue data. No cookies, device IDs, or user tracking required.',
                    },
                    {
                      Icon: BarChart2,
                      color: 'text-purple-600',
                      title: 'Shows how confident the model is',
                      body: 'Every ROI figure comes with a confidence range. A tight range means act on it. A wide range means the model needs more data.',
                    },
                  ].map(({ Icon, color, title, body }) => (
                    <div key={title} className="flex gap-3">
                      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${color}`} />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{title}</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <details className="mt-3 pt-3 border-t border-brand-100">
                  <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">Technical note</summary>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">Meridian uses Bayesian inference with MCMC sampling. The posterior distribution captures genuine uncertainty from limited data. The R-hat convergence check confirms the model found consistent estimates across 4 independent chains.</p>
                </details>
              </div>
            )}

            {/* Tab bar — horizontally scrollable on mobile */}
            <div className="overflow-x-auto pb-1">
              <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-xl w-max min-w-full sm:w-fit">
                {TABS.map(tab => (
                  <button key={tab.id}
                    onClick={() => handleTabChange(tab.id, tab.label)}
                    className={`px-3 md:px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${activeTab === tab.id ? 'tab-active' : 'tab-inactive'}`}>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Suggested tab order — dismissible, persisted to localStorage */}
            {!tabOrderDismissed && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
                <span>Suggested order: <strong className="text-slate-600">Channel ROI</strong> &rarr; Budget &rarr; Contribution &rarr; Scenarios &rarr; Synergy &rarr; Geography</span>
                <button
                  onClick={() => { localStorage.setItem('mmm_tab_order_dismissed', '1'); setTabOrderDismissed(true) }}
                  className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Tab content with loading skeleton */}
            <div className="mt-2">
              {isTabLoading ? <TabSkeleton /> : (
                <>
                  {isComputingResults && !modelResults && (
                    <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700 mb-4">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      Building your results — charts will appear shortly.
                    </div>
                  )}
                  {activeTab === 'budget' && <BudgetAllocation modelResults={modelResults} />}
                  {activeTab === 'roi' && <MeasuringROI modelResults={modelResults} />}
                  {activeTab === 'scenario' && <ScenarioPlanning modelResults={modelResults} />}
                  {activeTab === 'contribution' && <ChannelContribution modelResults={modelResults} />}
                  {activeTab === 'cross' && <CrossChannelImpact modelResults={modelResults} />}
                  {activeTab === 'geo' && <GeoBreakdown modelResults={modelResults} selectedGeos={appliedConfig?.geos} />}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {showExport && <ExportModal activeTab={activeTab} onClose={() => setShowExport(false)} dataMethod={deriveDataMethod(modelResults)} />}
      {showTour && <GuidedTour onClose={() => { localStorage.setItem('mmm_tour_seen', '1'); setShowTour(false) }} />}
      <GlossaryPanel />
    </div>
  )
}
