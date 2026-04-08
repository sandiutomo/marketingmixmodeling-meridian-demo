export type DataSourceType = 'geo_no_rf' | 'geo_with_rf' | 'geo_organic' | 'national' | 'indonesia' | 'custom_csv';

/**
 * The method used to produce the numbers shown in a panel or chart.
 *
 * meridian — Real Bayesian MCMC via Google Meridian. Full posterior,
 *            credible intervals, causal attribution. Most reliable.
 *
 * pearson  — Pearson correlation heuristic. Backend ran but MCMC did not.
 *            Statistical approximation only; not causal inference.
 *
 * mock     — No real data loaded. Values are illustrative sample figures.
 *            Load a dataset and run the model to see actual results.
 */
export type DataMethod = 'meridian' | 'pearson' | 'mock'

/**
 * Derive the DataMethod from modelResults.
 * Pass modelResults directly from component props — null means no data loaded yet.
 */
export function deriveDataMethod(modelResults: { isRealMeridian?: boolean } | null | undefined): DataMethod {
  if (!modelResults) return 'mock'
  return modelResults.isRealMeridian ? 'meridian' : 'pearson'
}

/** Returned after POST /data/upload */
export interface UploadedDataSummary {
  n_geos: number
  n_times: number
  n_channels: number
  channels: string[]
  channel_labels?: Record<string, string>
  geos?: string[]
  total_revenue: number
  total_spend: number
  data_source: string
}

export interface DataSource {
  id: DataSourceType;
  label: string;
  description: string;
  useCase: string;
  channels: string[];
  geos?: string[];
}

export interface Channel {
  id: string;
  name: string;
  color: string;
  type: 'demand_driver' | 'demand_capture' | 'support';
}

export interface ROIData {
  channel: string;
  roi: number;
  spend: number;
  revenue: number;
  color: string;
}

export interface ContributionData {
  channel: string;
  contribution: number;
  percentage: number;
  color: string;
}

export interface ScenarioChannel {
  channel: string;
  currentSpend: number;
  newSpend: number;
  projectedROI: number;
  changePercent: number;
}

/** Per-channel LogNormal prior: mean ROI belief and uncertainty.
 *  Maps to Meridian's PriorDistribution(mu=mu, sigma=sigma).
 *  Default: mu=0.2 (low-information), sigma=0.9 (wide uncertainty).
 */
export interface ChannelPrior {
  mu: number     // prior mean (log-scale): higher = stronger ROI belief
  sigma: number  // prior uncertainty: lower = tighter (more opinionated)
}

/** A geo-holdout or matched-markets calibration experiment.
 *  Maps to Meridian's roi_calibration_period in ModelSpec.
 */
export interface CalibrationPeriod {
  channel: string          // channel name this experiment measures
  startDate: string        // YYYY-MM-DD
  endDate: string          // YYYY-MM-DD
  liftPct: number          // measured revenue lift fraction (e.g., 0.12 = 12%)
  experimentType: 'holdout' | 'matched_markets'
}

export interface ModelConfig {
  startDate: string
  endDate: string
  geos: string[]
  channels: string[]
  nChains: number
  nAdapt: number
  nBurnin: number
  nKeep: number
  seed?: number
  nPriorDraws?: number
  // Meridian ModelSpec parameters
  maxLag: number                           // adstock carry-over window; Meridian default 8
  adstockDecay: 'geometric' | 'binomial'  // decay function
  mediaPriorType: 'roi' | 'coefficient'   // how priors are specified in ModelSpec
  holdoutPct: number                       // 0 = no holdout; 0.1 = reserve last 10% as test
  mediaEffectsDist?: 'log_normal' | 'normal'
  hillBeforeAdstock?: boolean
  uniqueSigmaPerGeo?: boolean
  kpiType?: 'revenue' | 'non_revenue'    // Meridian InputData kpi_type param
  revenuePerKpi?: number                 // only used when kpiType = 'non_revenue'
  rfPriorType?: string
  // Per-channel prior beliefs (LogNormal) — Phase 3
  channelPriors?: Record<string, ChannelPrior>
  // Calibration experiments — Phase 3-D
  calibrationPeriods?: CalibrationPeriod[]
  // Per-channel spend constraints for budget optimization
  channelConstraints?: Record<string, ChannelConstraint>
  // Reach-and-frequency optimization (mirrors notebook's use_optimal_frequency)
  useOptimalFrequency?: boolean
  maxFrequency?: number
}

export interface ModelStatus {
  step: string;
  status: 'idle' | 'running' | 'complete' | 'error';
  progress?: number;
  message?: string;
}

export interface Insight {
  id: string;
  type: 'opportunity' | 'warning' | 'info';
  title: string;
  description: string;
  action?: string;
  channel?: string;
  impact?: string;
}

export interface ChannelResult {
  channel: string      // internal key: tv, paid_search, social, display, etc.
  label: string        // display name: TV, Paid Search, Social, Display, etc.
  roi: number
  roi_ci_lower: number
  roi_ci_upper: number
  spend: number        // total spend in CSV units (dollars)
  revenue: number      // attributed revenue in dollars
  confidence: 'High' | 'Medium' | 'Low'
  color: string
  mroi: number                  // marginal ROI: return on the next dollar spent
  saturationRatio: number       // mroi / roi — <0.55 = saturated, <0.80 = efficient
  saturationStatus: 'saturated' | 'efficient' | 'room_to_grow'
}

export function getSaturationBadge(status: ChannelResult['saturationStatus']) {
  if (status === 'saturated')  return { text: 'Saturated',     color: 'text-red-600 bg-red-50' }
  if (status === 'efficient')  return { text: 'Efficient',     color: 'text-amber-600 bg-amber-50' }
  return                                { text: 'Room to grow', color: 'text-green-600 bg-green-50' }
}

export interface WeeklyDataPoint {
  week: string
  date: string
  Base: number
  [key: string]: string | number
}

/** Hill saturation parameters per channel.
 *  isReal=true  → from Meridian posterior (get_hill_parameters())
 *  isReal=false → estimated from spend/revenue data as fallback
 */
export interface HillChannelParams {
  channel: string      // display name
  channel_key: string  // internal key (tv, paid_search, etc.)
  ec: number | null    // half-saturation spend (spend at which 50% of max_response is reached)
  slope: number | null // Hill slope — steepness of diminishing returns
  maxResponse: number | null  // estimated revenue ceiling for this channel
  isReal: boolean
}

/** Adstock (carryover) decay parameters per channel.
 *  isReal=true  → from Meridian posterior (get_adstock_parameters())
 *  isReal=false → channel-type heuristic
 */
export interface AdstockChannelParams {
  channel: string      // display name
  channel_key: string
  decayRate: number | null  // fraction of effect that carries into next week
  maxLag: number            // number of weeks modelled for carryover
  isReal: boolean
}

/**
 * Per-channel spend bounds for budget optimization.
 * Mirrors Meridian's ChannelConstraintRel parameter.
 *
 * min_ratio : minimum fraction of total budget this channel must receive (0.0–1.0)
 * max_ratio : maximum fraction of total budget this channel may receive (0.0–1.0)
 * Constraint: min_ratio < max_ratio.
 */
export interface ChannelConstraint {
  min_ratio: number
  max_ratio: number
}

/** Time granularity for the period breakdown chart. */
export type TimePeriod = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

/**
 * One row in the timeseries breakdown response.
 * Contains a 'period' string, one numeric key per channel, a 'Base' key,
 * and a 'total' key = sum of all channels + Base.
 */
export interface TimeseriesDataPoint {
  period: string
  Base: number
  total: number
  [channel: string]: string | number
}

/** Full response from GET /results/timeseries */
export interface TimeseriesResult {
  periods: string[]
  channels: string[]
  data: TimeseriesDataPoint[]
}

export interface ModelResults {
  channels: ChannelResult[]
  totalRevenue: number
  totalSpend: number
  baseRevenue: number
  portfolioRoi: number
  dateRange: string
  nGeos: number
  nWeeks: number
  dataSource: DataSourceType
  weeklyData: WeeklyDataPoint[]
  rSquared: number
  mape: number
  maxRhat: number
  currency: 'USD' | 'IDR'
  // Phase 2 — Meridian posterior parameters
  hillParams?: HillChannelParams[]
  adstockParams?: AdstockChannelParams[]
  isRealMeridian?: boolean
}

// ─── Options B & C — new analytical surfaces ──────────────────────────────

export interface SynergyPair {
  channel_a: string
  channel_b: string
  correlation: number
  interpretation: 'strong' | 'moderate' | 'weak' | 'negative'
}

export interface SynergyResult {
  channels: string[]
  matrix: number[][]
  pairs: SynergyPair[]
  method: DataMethod
}

export interface ChannelSaturation {
  channel: string
  channel_key: string
  current_spend: number
  ec: number | null
  saturation_ratio: number
  marginal_roi: number | null
  roi: number
  status: 'saturated' | 'efficient' | 'room_to_grow'
  is_real_meridian: boolean
}

export interface SaturationResult {
  channels: ChannelSaturation[]
  is_real_meridian: boolean
}

export interface WaterfallBar {
  period: string
  channel: string
  delta: number
  cumulative: number
  is_baseline: boolean
}

export interface WaterfallResult {
  periods: string[]
  channels: string[]
  bars: WaterfallBar[]
  is_real_meridian: boolean
}

export interface GeoAssignment {
  geo: string
  group: 'treatment' | 'control'
  total_spend: number
  portfolio_roi: number
  rationale: string
}

/** GET /results/model_fit — weekly actual vs predicted revenue */
export interface ModelFitResult {
  weeks: string[]
  actual: number[]
  predicted: number[]
  ci_lower: number[]
  ci_upper: number[]
  is_real_meridian: boolean
}

/** One row from GET /results/mroi — mROI per channel */
export interface MROIChannel {
  channel: string
  channel_key: string
  roi: number
  mroi: number
  spend: number
  spend_pct: number
  contribution_pct: number
  color: string
  is_real_meridian: boolean
}

export interface HoldoutDesignResult {
  applicable: boolean
  n_geos: number
  treatment_geos: string[]
  control_geos: string[]
  assignments: GeoAssignment[]
  recommended_duration_weeks: number
  holdout_pct: number
  method_note: string
  is_real_meridian: boolean
}
