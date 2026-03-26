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
} from 'lucide-react'
import { fmtPct } from '@/lib/format'

type AppStep = 'data' | 'config' | 'insights'
type InsightTab = 'budget' | 'roi' | 'scenario' | 'contribution' | 'cross' | 'geo'

const TABS: { id: InsightTab; label: string }[] = [
  { id: 'budget', label: 'Budget Allocation' },
  { id: 'roi', label: 'Measuring True ROI' },
  { id: 'scenario', label: 'Scenario Planning' },
  { id: 'contribution', label: 'Channel Contribution' },
  { id: 'cross', label: 'Cross-channel Impact' },
  { id: 'geo', label: 'Geo Breakdown' },
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
    <div className="min-h-screen bg-surface-50">
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
                  <h3 className="font-bold text-slate-900 mb-0.5">Run Analysis</h3>
                  <p className="text-sm text-slate-500">Calculates ROI, revenue attribution, and confidence ranges for each channel.</p>
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
              <button onClick={handleReset} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors shrink-0">
                <ChevronLeft className="w-4 h-4" /> Back to model setup
              </button>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {/* Data freshness — shows configured date range once computed */}
                <span className="text-xs text-slate-400 bg-white border border-surface-200 px-2.5 py-1 rounded-lg">
                  {modelResults
                    ? `${modelResults.dateRange} · ${modelResults.nGeos} geo${modelResults.nGeos !== 1 ? 's' : ''} · ${modelResults.channels.length} channels`
                    : appliedConfig
                      ? `${appliedConfig.startDate} to ${appliedConfig.endDate} · computing…`
                      : 'Computing…'}
                </span>
                {/* Model quality — "Strong" only when real Meridian posterior ran */}
                {modelResults ? (
                  modelResults.isRealMeridian ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg shadow-sm">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Model quality: Strong
                      <span className="text-green-500 font-normal hidden sm:inline">
                        · {fmtPct(modelResults.rSquared * 100, 0)} R²
                        · MAPE {fmtPct(modelResults.mape * 100)}
                      </span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Model quality: Estimated
                      <span className="text-amber-500 font-normal hidden sm:inline">
                        · {fmtPct(modelResults.rSquared * 100, 0)} R²
                      </span>
                    </span>
                  )
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 bg-surface-100 border border-surface-200 px-2.5 py-1 rounded-lg">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Model quality: pending
                  </span>
                )}
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
                    <p className="text-sm font-bold text-slate-900">Why these numbers are different from your attribution tool</p>
                    <p className="text-xs text-slate-500 mt-0.5">MMM tries to estimate what your spend actually caused—not just what happened around the same time.</p>
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
                      title: 'Impact over time',
                      body: 'Attribution gives credit to the last touchpoint before a purchase. MMM looks at your full history to estimate how much revenue each channel drove—even when the impact shows up later.',
                    },
                    {
                      Icon: Lock,
                      color: 'text-green-600',
                      title: 'No cookies or user tracking',
                      body: 'MMM uses only aggregated weekly spend and revenue. It does not use cookies or device IDs, so the results don’t depend on third-party tracking.',
                    },
                    {
                      Icon: BarChart2,
                      color: 'text-purple-600',
                      title: 'Uncertainty is included',
                      body: 'Each ROI comes with a confidence range. A smaller range means the model is more confident; a wider range means you may need more data before making big budget changes.',
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

            {/* Tab content with loading skeleton */}
            <div className="mt-2">
              {isTabLoading ? <TabSkeleton /> : (
                <>
                  {isComputingResults && !modelResults && (
                    <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700 mb-4">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      Computing results from your data — charts will update automatically when ready.
                    </div>
                  )}
                  {modelResults && backendOnline === false && (
                    <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 mb-4">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                      <span>
                        <strong>Illustrative results</strong> — backend offline, so these numbers come from a correlation-based approximation, not Bayesian causal inference. ROI, contribution, and confidence ranges are directional estimates only. Connect the backend (Phase 2) to run real Meridian MCMC sampling.
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
