export type DataSourceType = 'geo_no_rf' | 'geo_with_rf' | 'geo_organic' | 'national' | 'indonesia' | 'custom_csv';

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
  rfPriorType?: string
  // Per-channel prior beliefs (LogNormal) — Phase 3
  channelPriors?: Record<string, ChannelPrior>
  // Calibration experiments — Phase 3-D
  calibrationPeriods?: CalibrationPeriod[]
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
