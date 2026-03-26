import type { DataSourceType, ModelResults, ChannelResult, WeeklyDataPoint, HillChannelParams, AdstockChannelParams } from './types'

const CSV_FILES: Partial<Record<DataSourceType, string>> = {
  geo_no_rf:   '/data/geo_media.csv',
  geo_with_rf: '/data/geo_media_rf.csv',
  geo_organic: '/data/geo_all_channels.csv',
  national:    '/data/national_all_channels.csv',
  indonesia:   '/data/indonesia.csv',
}

const CHANNEL_KEYS: Record<DataSourceType, string[]> = {
  custom_csv:  [],
  geo_no_rf:   ['tv', 'paid_search', 'social', 'display'],
  geo_with_rf: ['tv', 'paid_search', 'social', 'youtube'],
  geo_organic: ['tv', 'paid_search', 'social', 'display', 'ooh'],
  national:    ['tv', 'radio', 'paid_search', 'social', 'display'],
  indonesia:   ['tv', 'social', 'search', 'ooh', 'ecommerce', 'youtube', 'programmatic', 'influencer'],
}

const DISPLAY_NAMES: Record<string, string> = {
  tv: 'TV', paid_search: 'Paid Search', social: 'Social', display: 'Display',
  radio: 'Radio', youtube: 'YouTube', ooh: 'OOH', organic: 'Organic', email: 'Email',
  tiktok: 'TikTok', shopee: 'Shopee', tokopedia: 'Tokopedia', instagram: 'Instagram',
  google_ads: 'Google Ads', meta: 'Meta Ads',
  search: 'Search', ecommerce: 'E-commerce', programmatic: 'Programmatic', influencer: 'Influencer',
}

const COLORS: Record<string, string> = {
  tv: '#4361ee', paid_search: '#7209b7', social: '#f72585', display: '#4cc9f0',
  radio: '#3a0ca3', youtube: '#ff6b6b', ooh: '#06d6a0', organic: '#95d5b2', email: '#06d6a0',
  tiktok: '#010101', shopee: '#f04e24', tokopedia: '#03ac0e', instagram: '#e1306c',
  google_ads: '#4285f4', meta: '#1877f2',
  search: '#7209b7', ecommerce: '#f04e24', programmatic: '#4cc9f0', influencer: '#f72585',
}

function pearsonR(x: number[], y: number[]): number {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let cov = 0, sx = 0, sy = 0
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my)
    sx += (x[i] - mx) ** 2
    sy += (y[i] - my) ** 2
  }
  return sx > 0 && sy > 0 ? cov / Math.sqrt(sx * sy) : 0
}

function parseAndAggregate(text: string, channelKeys: string[]) {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const startCol = headers[0] === '' ? 1 : 0

  const timeIdx = headers.indexOf('time') - startCol
  const convIdx = headers.indexOf('conversions') - startCol
  const rpcIdx  = headers.indexOf('revenue_per_conversion') - startCol
  const spendIdxs = channelKeys.map((_, i) => headers.indexOf(`Channel${i}_spend`) - startCol)
  const hasGeo = headers.includes('geo')

  const byTime = new Map<string, { spend: number[]; revenue: number }>()

  for (let r = 1; r < lines.length; r++) {
    const parts = lines[r].split(',').slice(startCol)
    if (parts.length < 4) continue
    const time = parts[timeIdx]?.trim()
    if (!time) continue
    const conv = parseFloat(parts[convIdx] ?? '0') || 0
    const rpc  = parseFloat(parts[rpcIdx]  ?? '0') || 0
    const revenue = conv * rpc
    const spend = spendIdxs.map(idx => parseFloat(parts[idx] ?? '0') || 0)

    if (!byTime.has(time)) byTime.set(time, { spend: new Array(channelKeys.length).fill(0), revenue: 0 })
    const agg = byTime.get(time)!
    agg.revenue += revenue
    spend.forEach((s, i) => { agg.spend[i] += s })
  }

  const times = Array.from(byTime.keys()).sort()
  const spendMatrix = times.map(t => byTime.get(t)!.spend)
  const revenueVec  = times.map(t => byTime.get(t)!.revenue)

  let nGeos = 1
  if (hasGeo) {
    const geoIdx = headers.indexOf('geo') - startCol
    const geoSet = new Set<string>()
    for (let r = 1; r < lines.length; r++) {
      const parts = lines[r].split(',').slice(startCol)
      if (parts[geoIdx]) geoSet.add(parts[geoIdx].trim())
    }
    nGeos = geoSet.size
  }

  return { spendMatrix, revenueVec, times, nGeos }
}

// Reverse map: "TV" → "tv", "Paid Search" → "paid_search", etc.
const REVERSE_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(DISPLAY_NAMES).map(([k, v]) => [v, k])
)

export async function computeModelResults(
  sourceId: DataSourceType,
  config?: { startDate?: string; endDate?: string; channels?: string[] }
): Promise<ModelResults> {
  if (sourceId === 'custom_csv') {
    throw new Error('Custom CSV has no bundled client CSV — use the backend after upload.')
  }
  const currency = sourceId === 'indonesia' ? 'IDR' : 'USD'

  const csvUrl = CSV_FILES[sourceId]
  if (!csvUrl) throw new Error(`No CSV for source: ${sourceId}`)
  const text = await fetch(csvUrl).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.text()
  })

  // Filter to channels selected in step 2 (if any)
  let channelKeys = CHANNEL_KEYS[sourceId]
  if (config?.channels?.length) {
    const selectedKeys = new Set(config.channels.map(n => REVERSE_NAMES[n] ?? n.toLowerCase().replace(' ', '_')))
    channelKeys = channelKeys.filter(k => selectedKeys.has(k))
    if (channelKeys.length === 0) channelKeys = CHANNEL_KEYS[sourceId] // fallback if none matched
  }

  const parsed = parseAndAggregate(text, channelKeys)

  // Filter by configured date range
  let { spendMatrix, revenueVec, times, nGeos } = parsed
  if (config?.startDate || config?.endDate) {
    const keep = times.map((t, i) => {
      if (config!.startDate && t < config!.startDate) return -1
      if (config!.endDate   && t > config!.endDate)   return -1
      return i
    }).filter(i => i >= 0)
    times        = keep.map(i => parsed.times[i])
    spendMatrix  = keep.map(i => parsed.spendMatrix[i])
    revenueVec   = keep.map(i => parsed.revenueVec[i])
  }

  return computeFromData({ spendMatrix, revenueVec, times, nGeos, channelKeys }, currency, sourceId)
}

// ── Shared model math (used by both CSV and synthetic paths) ──────────────────
function computeFromData(
  data: { spendMatrix: number[][]; revenueVec: number[]; times: string[]; nGeos: number; channelKeys: string[] },
  currency: 'USD' | 'IDR',
  sourceId: DataSourceType,
): ModelResults {
  const { spendMatrix, revenueVec, times, nGeos, channelKeys } = data
  const nWeeks = times.length

  const totalSpendPerCh = channelKeys.map((_, i) => spendMatrix.reduce((a, row) => a + row[i], 0))
  const totalRevenue = revenueVec.reduce((a, b) => a + b, 0)
  const totalSpend   = totalSpendPerCh.reduce((a, b) => a + b, 0)

  const corrs = channelKeys.map((_, i) => {
    const chSpend = spendMatrix.map(row => row[i])
    return Math.max(pearsonR(chSpend, revenueVec), 0.01)
  })

  const weights    = corrs.map((c, i) => c * totalSpendPerCh[i])
  const weightSum  = weights.reduce((a, b) => a + b, 0)
  const mediaRevenue   = totalRevenue * 0.85
  const channelRevenue = weights.map(w => weightSum > 0 ? (w / weightSum) * mediaRevenue : mediaRevenue / channelKeys.length)
  const roi = channelRevenue.map((r, i) => totalSpendPerCh[i] > 0 ? r / totalSpendPerCh[i] : 0)

  const mroi = channelKeys.map((_, i) => {
    const L = channelRevenue[i] * 2.5
    const S = totalSpendPerCh[i]
    if (S <= 0 || L <= 0) return roi[i]
    const k = -Math.log(Math.max(0.001, 1 - channelRevenue[i] / L)) / S
    return L * k * Math.exp(-k * S)
  })
  const saturationRatio  = mroi.map((m, i) => roi[i] > 0 ? m / roi[i] : 1)
  const saturationStatus = saturationRatio.map(r =>
    r < 0.55 ? 'saturated' as const : r < 0.80 ? 'efficient' as const : 'room_to_grow' as const
  )

  const cv = channelKeys.map((_, i) => {
    const chSpend = spendMatrix.map(row => row[i])
    const mean = chSpend.reduce((a, b) => a + b, 0) / nWeeks
    const std  = Math.sqrt(chSpend.reduce((a, v) => a + (v - mean) ** 2, 0) / nWeeks)
    return mean > 0 ? std / mean : 1
  })
  // Confidence tier = spend consistency (CV of weekly spend), not posterior convergence.
  // CV < 0.35 → steady spend → High; 0.35–0.65 → variable → Medium; > 0.65 → sporadic → Low.
  // Real MCMC convergence (R-hat) comes from the backend when Meridian runs.
  const confidence = cv.map(c => c < 0.35 ? 'High' as const : c < 0.65 ? 'Medium' as const : 'Low' as const)
  const ciLower = roi.map((r, i) => r * Math.max(0.55, 1 - cv[i] * 0.45))
  const ciUpper = roi.map((r, i) => r * Math.min(1.9,  1 + cv[i] * 0.65))

  const baseWeekly  = totalRevenue * 0.15 / nWeeks
  const meanRevenue = revenueVec.reduce((a, b) => a + b, 0) / nWeeks
  const ssTot = revenueVec.reduce((a, v) => a + (v - meanRevenue) ** 2, 0)
  let ssRes = 0, mapeSum = 0, mapeCount = 0
  for (let t = 0; t < nWeeks; t++) {
    const predicted = baseWeekly + channelKeys.reduce((a, _, i) => a + spendMatrix[t][i] * roi[i], 0)
    ssRes += (revenueVec[t] - predicted) ** 2
    if (revenueVec[t] > 0) { mapeSum += Math.abs(revenueVec[t] - predicted) / revenueVec[t]; mapeCount++ }
  }
  const rSquared = Math.min(0.99, Math.max(0, ssTot > 0 ? 1 - ssRes / ssTot : 0))
  const mape     = mapeCount > 0 ? mapeSum / mapeCount : 0

  // Deterministic illustrative rhat — no random values (real values come from backend MCMC)
  const rhatValues = confidence.map(c =>
    c === 'High'   ? 1.002 :
    c === 'Medium' ? 1.006 :
                     1.011
  )
  const maxRhat = Math.max(...rhatValues)

  const chartWeeks = times.slice(-52)
  const chartSpend = spendMatrix.slice(-52)
  const weeklyData: WeeklyDataPoint[] = chartWeeks.map((date, t) => {
    const point: WeeklyDataPoint = { week: `W${t + 1}`, date, Base: Math.round(baseWeekly) }
    channelKeys.forEach((key, i) => { point[key] = Math.round(chartSpend[t][i] * roi[i]) })
    return point
  })

  // ── Hill saturation params (estimated from data — not real Meridian posterior) ──
  const hillParams: HillChannelParams[] = channelKeys.map((key, i) => {
    const totalSpend  = totalSpendPerCh[i]
    const channelRev  = channelRevenue[i]
    return {
      channel:     DISPLAY_NAMES[key] ?? key,
      channel_key: key,
      ec:          totalSpend > 0 ? totalSpend * 0.6 : channelRev,  // spend at 50% saturation
      slope:       2.0,                                               // typical Hill slope
      maxResponse: channelRev * 2.5,                                 // estimated ceiling
      isReal:      false,
    }
  })

  // Channel-type adstock decay heuristics
  const DECAY_RATE: Record<string, number> = {
    tv: 0.65, radio: 0.55, ooh: 0.58, youtube: 0.35,
    social: 0.35, instagram: 0.35, tiktok: 0.35, meta: 0.35,
    display: 0.25, google_ads: 0.25, paid_search: 0.20,
    shopee: 0.20, tokopedia: 0.20, email: 0.15, organic: 0.40,
    search: 0.10, ecommerce: 0.18, programmatic: 0.20, influencer: 0.14,
  }
  const adstockParams: AdstockChannelParams[] = channelKeys.map(key => ({
    channel:     DISPLAY_NAMES[key] ?? key,
    channel_key: key,
    decayRate:   DECAY_RATE[key] ?? 0.40,
    maxLag:      8,
    isReal:      false,
  }))

  const channels: ChannelResult[] = channelKeys.map((key, i) => ({
    channel:          key,
    label:            DISPLAY_NAMES[key] ?? key,
    roi:              roi[i],
    roi_ci_lower:     ciLower[i],
    roi_ci_upper:     ciUpper[i],
    spend:            totalSpendPerCh[i],
    revenue:          channelRevenue[i],
    confidence:       confidence[i],
    color:            COLORS[key] ?? '#94a3b8',
    mroi:             mroi[i],
    saturationRatio:  saturationRatio[i],
    saturationStatus: saturationStatus[i],
  }))

  return {
    channels,
    totalRevenue,
    totalSpend,
    baseRevenue:  totalRevenue * 0.15,
    portfolioRoi: totalSpend > 0 ? (totalRevenue * 0.85) / totalSpend : 0,
    dateRange:    `${times[0]} to ${times[times.length - 1]}`,
    nGeos,
    nWeeks,
    dataSource:   sourceId,
    weeklyData,
    rSquared,
    mape,
    maxRhat,
    currency,
    hillParams,
    adstockParams,
    isRealMeridian: false,
  }
}
