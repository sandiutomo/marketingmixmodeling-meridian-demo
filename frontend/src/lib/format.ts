type Currency = 'USD' | 'IDR'

/** Format a monetary amount with appropriate scale suffix. */
export function fmt(n: number, currency: Currency = 'USD'): string {
  if (currency === 'IDR') {
    const abs = Math.abs(n)
    if (abs >= 1e12) return `Rp ${(n / 1e12).toFixed(1)}T`
    if (abs >= 1e9)  return `Rp ${(n / 1e9).toFixed(1)}B`
    if (abs >= 1e6)  return `Rp ${(n / 1e6).toFixed(0)}M`
    if (abs >= 1e3)  return `Rp ${(n / 1e3).toFixed(0)}K`
    return `Rp ${n.toFixed(0)}`
  }
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

/** Format a signed monetary change (e.g. +$1.2M or -Rp 500M). */
export function fmtDelta(n: number, currency: Currency = 'USD'): string {
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '-'
  if (currency === 'IDR') {
    if (abs >= 1e12) return `${sign}Rp ${(abs / 1e12).toFixed(1)}T`
    if (abs >= 1e9)  return `${sign}Rp ${(abs / 1e9).toFixed(1)}B`
    if (abs >= 1e6)  return `${sign}Rp ${(abs / 1e6).toFixed(0)}M`
    if (abs >= 1e3)  return `${sign}Rp ${(abs / 1e3).toFixed(0)}K`
    return `${sign}Rp ${abs.toFixed(0)}`
  }
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

/** Format an ROI figure as a per-unit return.
 *  USD: $4.20 per $1 spent
 *  IDR: Rp4,200 per Rp1,000 spent (×1000 so the number is readable) */
export function fmtROI(roi: number, currency: Currency = 'USD'): string {
  if (currency === 'IDR') {
    const per1000 = roi * 1000
    return `Rp${per1000.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }
  return `$${roi.toFixed(2)}`
}

/** Currency symbol only. */
export function currencySymbol(currency: Currency = 'USD'): string {
  return currency === 'IDR' ? 'Rp' : '$'
}

/** Format a number as a percentage. n should be in 0–100 scale (e.g. 15.3 → "15.3%"). */
export function fmtPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`
}

/** Format a signed percentage change (e.g. +15.3% or -8.2%). */
export function fmtSignedPct(n: number, decimals = 1): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(decimals)}%`
}

/** Format a plain integer with thousand separators (e.g. 1234 → "1,234"). */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}
