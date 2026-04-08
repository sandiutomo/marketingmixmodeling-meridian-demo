/**
 * MeridianBadge — thin backward-compat wrapper around DataMethodBadge.
 *
 * Prefer importing DataMethodBadge directly with an explicit DataMethod.
 * This wrapper exists so existing call sites that pass isReal?: boolean
 * continue to work without modification.
 *
 * isReal === true  → 'meridian'
 * isReal === false → 'pearson'
 * isReal === undefined → 'mock'
 */
import DataMethodBadge from './DataMethodBadge'
import type { DataMethod } from '@/lib/types'

function toMethod(isReal: boolean | undefined): DataMethod {
  if (isReal === true) return 'meridian'
  if (isReal === false) return 'pearson'
  return 'mock'
}

export default function MeridianBadge({ isReal }: { isReal?: boolean }) {
  return <DataMethodBadge method={toMethod(isReal)} />
}
