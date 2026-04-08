import type { ModelResults, ChannelResult, ChannelConstraint, TimePeriod, TimeseriesResult, SynergyResult, SaturationResult, WaterfallResult, HoldoutDesignResult, ModelFitResult, MROIChannel } from './types'

const BASE_URL = '/api/backend';

export async function checkHealth(): Promise<boolean> {
  try {
    console.log('[API] Checking backend health...')
    const res = await fetch(`${BASE_URL}/health`, { method: 'GET' })
    const ok = res.ok
    console.log(`[API] Backend health: ${ok ? '✅ online' : '❌ offline'} (HTTP ${res.status})`)
    return ok
  } catch (e) {
    console.warn('[API] Backend unreachable — running in demo mode:', e)
    return false
  }
}

export async function uploadCsv(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE_URL}/data/upload`, { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `Upload failed (${res.status})`);
  }
  return res.json() as Promise<{
    summary: import('./types').UploadedDataSummary;
    timespan: { start: string | null; end: string | null };
    column_detection: Record<string, unknown>;
    message: string;
  }>;
}

export async function loadData(dataSourceId: string) {
  console.log(`[API] Loading data source: "${dataSourceId}"`)
  const res = await fetch(`${BASE_URL}/data/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_source: dataSourceId }),
  });
  if (!res.ok) throw new Error('Failed to load data');
  const data = await res.json();
  console.log('[API] Data loaded successfully:', data)
  return data;
}

export async function configureModel(config: object) {
  console.log('[API] Configuring model with:', config)
  const res = await fetch(`${BASE_URL}/model/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to configure model');
  const data = await res.json();
  console.log('[API] Model configured:', data)
  return data;
}

export async function runModel() {
  console.log('[API] Starting model run...')
  const res = await fetch(`${BASE_URL}/model/run`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to run model');
  const data = await res.json();
  console.log('[API] Model run complete:', data)
  return data;
}

/** Background MCMC — poll with getModelJobStatus */
export async function startModelJob() {
  const res = await fetch(`${BASE_URL}/model/run/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start model job');
  return res.json() as Promise<{ job_id: string; message: string }>;
}

export async function getModelJobStatus(jobId: string) {
  const res = await fetch(`${BASE_URL}/model/run/status/${jobId}`);
  if (!res.ok) throw new Error('Job status failed');
  return res.json() as Promise<{
    job_id: string;
    status: string;
    progress?: number;
    message?: string;
    error?: string | null;
    diagnostics?: Record<string, unknown>;
  }>;
}

export async function getResults() {
  console.log('[API] Fetching results...')
  const res = await fetch(`${BASE_URL}/results`);
  if (!res.ok) throw new Error('Failed to get results');
  const data = await res.json();
  // Normalise snake_case flag from backend to camelCase
  if (data && 'is_real_meridian' in data) {
    data.isRealMeridian = data.is_real_meridian
  }
  console.log('[API] Results received:', data)
  return data;
}

export async function runOptimization(budget: number, scenario?: object) {
  console.log(`[API] Running budget optimization — total budget: $${budget.toLocaleString()}`, scenario ?? '')
  const res = await fetch(`${BASE_URL}/optimization/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ budget, scenario }),
  });
  if (!res.ok) throw new Error('Failed to run optimization');
  const data = await res.json();
  console.log('[API] Optimization results:', data)
  return data;
}

/**
 * Run budget optimization with optional per-channel constraints and RF frequency settings.
 * Mirrors the Meridian Scenario Planner notebook's ChannelConstraintRel + use_optimal_frequency.
 *
 * channel_constraints: per-channel min/max spend fraction (keyed by display name, e.g. 'TV').
 * use_optimal_frequency: enable frequency-aware optimization for RF channels.
 * max_frequency: upper limit for frequency (recommended ≤ 10 when source data > 30 rows).
 */
export async function runOptimizationWithConstraints(
  budget: number,
  channelConstraints?: Record<string, ChannelConstraint>,
  useOptimalFrequency?: boolean,
  maxFrequency?: number,
  scenario?: object,
) {
  console.log(
    `[API] Optimization with constraints — budget: ${budget.toLocaleString()}`,
    { channelConstraints, useOptimalFrequency, maxFrequency },
  )
  const body: Record<string, unknown> = { budget }
  if (scenario) body.scenario = scenario
  if (channelConstraints && Object.keys(channelConstraints).length > 0)
    body.channel_constraints = channelConstraints
  if (useOptimalFrequency !== undefined) body.use_optimal_frequency = useOptimalFrequency
  if (maxFrequency !== undefined) body.max_frequency = maxFrequency

  const res = await fetch(`${BASE_URL}/optimization/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? `Optimization failed (${res.status})`)
  }
  const data = await res.json()
  console.log('[API] Optimization with constraints results:', data)
  return data
}

/**
 * Fetch channel revenue attribution broken down by time period.
 * Mirrors the Meridian Scenario Planner notebook's time_breakdown_generators.
 *
 * period: 'weekly' | 'monthly' | 'quarterly' | 'yearly' (default: 'quarterly')
 */
export async function fetchTimeseries(period: TimePeriod = 'quarterly'): Promise<TimeseriesResult> {
  console.log(`[API] Fetching timeseries breakdown — period: ${period}`)
  const res = await fetch(`${BASE_URL}/results/timeseries?period=${period}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? `Timeseries failed (${res.status})`)
  }
  const data = await res.json()
  console.log(`[API] Timeseries (${period}):`, data)
  return data as TimeseriesResult
}

export async function fetchSynergy(): Promise<SynergyResult> {
  console.log('[API] Fetching cross-channel synergy matrix')
  const res = await fetch(`${BASE_URL}/results/synergy`)
  if (!res.ok) throw new Error(`Synergy failed (${res.status})`)
  return res.json() as Promise<SynergyResult>
}

export async function fetchSaturation(): Promise<SaturationResult> {
  console.log('[API] Fetching saturation frontier')
  const res = await fetch(`${BASE_URL}/results/saturation`)
  if (!res.ok) throw new Error(`Saturation failed (${res.status})`)
  return res.json() as Promise<SaturationResult>
}

export async function fetchWaterfall(period: TimePeriod = 'quarterly'): Promise<WaterfallResult> {
  console.log(`[API] Fetching waterfall — period: ${period}`)
  const res = await fetch(`${BASE_URL}/results/waterfall?period=${period}`)
  if (!res.ok) throw new Error(`Waterfall failed (${res.status})`)
  return res.json() as Promise<WaterfallResult>
}

export async function fetchModelFit(): Promise<ModelFitResult> {
  console.log('[API] Fetching model fit timeseries')
  const res = await fetch(`${BASE_URL}/results/model_fit`)
  if (!res.ok) throw new Error(`Model fit failed (${res.status})`)
  return res.json() as Promise<ModelFitResult>
}

export async function fetchMROI(): Promise<MROIChannel[]> {
  console.log('[API] Fetching marginal ROI per channel')
  const res = await fetch(`${BASE_URL}/results/mroi`)
  if (!res.ok) throw new Error(`mROI failed (${res.status})`)
  return res.json() as Promise<MROIChannel[]>
}

export async function fetchCpik(): Promise<Array<{
  channel: string; channel_key: string; cpik: number | null;
  roi: number; spend: number; revenue: number;
  spend_pct: number; contribution_pct: number; color: string; is_real_meridian: boolean;
}>> {
  const res = await fetch(`${BASE_URL}/results/cpik`)
  if (!res.ok) throw new Error(`CPIK failed (${res.status})`)
  return res.json()
}

export function getExportCsvUrl(): string {
  return `${BASE_URL}/results/export/csv`
}

export function getExportHtmlUrl(): string {
  return `${BASE_URL}/results/export/html`
}

export async function fetchHoldoutDesign(): Promise<HoldoutDesignResult> {
  console.log('[API] Fetching holdout design')
  const res = await fetch(`${BASE_URL}/results/holdout-design`)
  if (!res.ok) throw new Error(`Holdout design failed (${res.status})`)
  return res.json() as Promise<HoldoutDesignResult>
}

export async function saveModel(name: string) {
  console.log(`[API] Saving model snapshot: "${name}"`)
  const res = await fetch(`${BASE_URL}/model/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to save model');
  const data = await res.json();
  console.log('[API] Model saved:', data)
  return data;
}

export async function getModelStatus() {
  console.log('[API] Checking model status...')
  const res = await fetch(`${BASE_URL}/model/status`);
  if (!res.ok) throw new Error('Failed to get status');
  const data = await res.json();
  console.log('[API] Model status:', data)
  return data;
}

export async function getHillParams() {
  const res = await fetch(`${BASE_URL}/results/hill_params`)
  if (!res.ok) throw new Error('Failed to get Hill params')
  return res.json()
}

export async function getAdstockParams() {
  const res = await fetch(`${BASE_URL}/results/adstock`)
  if (!res.ok) throw new Error('Failed to get adstock params')
  return res.json()
}

export async function getGeoBreakdown() {
  const res = await fetch(`${BASE_URL}/results/geo`)
  if (!res.ok) throw new Error('Failed to get geo breakdown')
  return res.json()
}

// ── Helpers for overlaying real Meridian posterior data ──────────────────────

function _computeMroi(revenue: number, spend: number, roiFallback: number): number {
  const L = revenue * 2.5
  if (spend <= 0 || L <= 0) return roiFallback
  const k = -Math.log(Math.max(0.001, 1 - revenue / L)) / spend
  return L * k * Math.exp(-k * spend)
}

function _mapBackendRoi(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roiRows: any[],
  labelToKey?: Map<string, string>,
  labelToColor?: Map<string, string>,
): ChannelResult[] {
  return roiRows.map(row => {
    const roi    = (row.roi    as number) ?? 0
    const spend  = (row.spend  as number) ?? 0
    const revenue = (row.revenue as number) ?? 0
    const label  = row.channel as string
    const mroi   = _computeMroi(revenue, spend, roi)
    const saturationRatio  = roi > 0 ? mroi / roi : 1
    const saturationStatus: ChannelResult['saturationStatus'] =
      saturationRatio < 0.55 ? 'saturated' : saturationRatio < 0.80 ? 'efficient' : 'room_to_grow'
    return {
      channel:         labelToKey?.get(label) ?? label.toLowerCase().replace(/\s+/g, '_'),
      label,
      roi,
      roi_ci_lower:    (row.roi_ci_lower as number) ?? roi * 0.75,
      roi_ci_upper:    (row.roi_ci_upper as number) ?? roi * 1.35,
      spend,
      revenue,
      confidence:      (row.confidence as ChannelResult['confidence']) ?? 'High',
      color:           (row.color as string) ?? labelToColor?.get(label) ?? '#94a3b8',
      mroi,
      saturationRatio,
      saturationStatus,
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _overlayBackend(client: ModelResults, backend: any): ModelResults {
  const roiRows    = backend.roi    ?? []
  const diagnostics = backend.diagnostics ?? {}
  const modelFit   = diagnostics.model_fit ?? {}
  const rhat       = diagnostics.rhat ?? {}

  const labelToKey   = new Map(client.channels.map((ch: ChannelResult) => [ch.label, ch.channel]))
  const labelToColor = new Map(client.channels.map((ch: ChannelResult) => [ch.label, ch.color]))

  const channels = _mapBackendRoi(roiRows, labelToKey, labelToColor)
  if (channels.length === 0) return { ...client, isRealMeridian: true }

  const totalSpend   = channels.reduce((a, ch) => a + ch.spend, 0)
  const mediaRevenue = channels.reduce((a, ch) => a + ch.revenue, 0)

  // baseRevenue = total KPI - media contributions (accurate when backend provides total_revenue)
  const totalRevenue = (backend.total_revenue as number)
    ?? (mediaRevenue > 0 ? mediaRevenue / 0.85 : client.totalRevenue)
  const baseRevenue  = Math.max(0, totalRevenue - mediaRevenue)
  const portfolioRoi = totalSpend > 0 ? mediaRevenue / totalSpend : 0

  return {
    ...client,
    channels,
    totalRevenue,
    totalSpend,
    baseRevenue,
    portfolioRoi,
    rSquared: (modelFit.r_squared as number) ?? client.rSquared,
    mape:     (modelFit.mape     as number) ?? client.mape,
    maxRhat:  (rhat.max          as number) ?? client.maxRhat,
    isRealMeridian: true,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _buildFromBackend(backend: any, config?: { startDate?: string; endDate?: string }): ModelResults {
  const roiRows    = backend.roi    ?? []
  const diagnostics = backend.diagnostics ?? {}
  const modelFit   = diagnostics.model_fit ?? {}
  const rhat       = diagnostics.rhat ?? {}

  const channels     = _mapBackendRoi(roiRows)
  const totalSpend   = channels.reduce((a, ch) => a + ch.spend, 0)
  const mediaRevenue = channels.reduce((a, ch) => a + ch.revenue, 0)
  const totalRevenue = (backend.total_revenue as number)
    ?? (mediaRevenue > 0 ? mediaRevenue / 0.85 : 0)
  const baseRevenue  = Math.max(0, totalRevenue - mediaRevenue)
  const portfolioRoi = totalSpend > 0 ? mediaRevenue / totalSpend : 0
  const dateRange    = (config?.startDate && config?.endDate)
    ? `${config.startDate} to ${config.endDate}`
    : 'Custom data'

  return {
    channels,
    totalRevenue,
    totalSpend,
    baseRevenue,
    portfolioRoi,
    dateRange,
    nGeos:         1,
    nWeeks:        0,
    dataSource:    'custom_csv',
    weeklyData:    [],
    rSquared:      (modelFit.r_squared as number) ?? 0,
    mape:          (modelFit.mape      as number) ?? 0,
    maxRhat:       (rhat.max           as number) ?? 1.0,
    currency:      'USD',
    hillParams:    [],
    adstockParams: [],
    isRealMeridian: true,
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function fetchComputedResults(
  sourceId: string,
  config?: { startDate?: string; endDate?: string; channels?: string[] }
) {
  // Step 1: Try backend. Only set backendData when Meridian actually ran (is_real_meridian: true).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let backendData: any = null
  try {
    const data = await getResults()
    if (data?.is_real_meridian) backendData = data
  } catch (_) { /* backend offline — fall through */ }

  // Step 2: custom_csv has no bundled CSV — must use backend.
  if (sourceId === 'custom_csv') {
    if (!backendData) throw new Error('Custom CSV results require the backend. Run the model after uploading.')
    return _buildFromBackend(backendData, config)
  }

  // Step 3: Client-side compute provides weeklyData, dateRange, nGeos, nWeeks, currency.
  const { computeModelResults } = await import('./compute')
  const clientResult = await computeModelResults(sourceId as import('./types').DataSourceType, config)

  // Step 4: If no real Meridian data, return client result as-is (isRealMeridian stays false).
  if (!backendData) return clientResult

  // Step 5: Overlay real Meridian ROI, CIs, revenue, and diagnostics onto client structure.
  return _overlayBackend(clientResult, backendData)
}
