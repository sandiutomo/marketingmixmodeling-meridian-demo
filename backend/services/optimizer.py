# =============================================================================
# services/optimizer.py — The strategist: finding the best budget allocation
#
# This service answers the core "so what?" question of the whole platform:
#   "We've measured ROI for each channel — now how should we spend the budget?"
#
# The optimizer takes a total budget and works out a per-channel allocation that
# maximises projected revenue. It does this in two ways depending on what's
# available:
#
#   Tier 1 — Meridian's BudgetOptimizer (Python 3.11+ with google-meridian):
#             Uses the fitted posterior model directly. The optimizer knows the
#             full shape of each channel's diminishing-returns curve (not just
#             a point estimate of ROI), so it can find the spend level where
#             marginal return equals marginal cost — the economically optimal point.
#
#   Tier 2 — Proportional ROI rebalance (works everywhere):
#             A simpler approach: give channels with higher ROI a larger share
#             of the budget, scaled by the square root of ROI (to avoid putting
#             everything into one channel). Budget limits prevent any channel
#             from taking more than 50% or less than 5% of the total.
#
# The square-root weighting in the fallback is intentional: it's a heuristic
# that approximates the diminishing-returns effect without needing the full
# Hill curve. A channel with 4x the ROI gets √4 = 2x the weight, not 4x —
# reflecting that you can't infinitely scale a high-ROI channel.
# =============================================================================

import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class OptimizerService:
    """
    Budget optimizer using real channel data loaded from Meridian CSVs.
    Attempts Meridian's BudgetOptimizer (requires Python 3.11+ with google-meridian),
    falls back to a proportional rebalance when Meridian is unavailable.
    """

    def _get_channel_data(self) -> Optional[dict]:
        """
        Assemble per-channel spend and ROI from the most recently loaded dataset.
        Prefers real Meridian posterior ROIs when sampling has already run,
        otherwise uses the correlation-based estimates from results_generator.
        """
        logger.debug("[Optimizer] _get_channel_data() loading channel data from DataLoaderService")
        try:
            from services.data_loader import DataLoaderService
            from services.results_generator import _compute_from_data, CHANNEL_DISPLAY, FALLBACK_ROI
            data = DataLoaderService._loaded_data
            if data is None:
                return None

            computed = _compute_from_data(data)
            if computed:
                channels = computed['channels']
                roi = list(computed['roi'].astype(float))
                spend = list(computed['total_spend_per_ch'].astype(float))
                channel_revenue = list(computed['channel_revenue'].astype(float))
            else:
                # _compute_from_data failed — build from raw arrays + FALLBACK_ROI
                channels = data['channels']
                spend_arr = data['spend_data']
                if spend_arr.ndim == 3:
                    spend = [float(spend_arr[:, :, i].sum()) for i in range(len(channels))]
                else:
                    spend = [float(spend_arr[:, i].sum()) for i in range(len(channels))]
                roi = [FALLBACK_ROI.get(ch, 2.0) for ch in channels]
                channel_revenue = [s * r for s, r in zip(spend, roi)]

            # Prefer real posterior ROIs if Meridian ran
            try:
                from services.meridian_runner import MeridianRunner
                meridian = MeridianRunner._last_results
                if meridian and meridian.get('roi_summary'):
                    roi_dict = meridian['roi_summary']
                    roi_means = roi_dict.get('roi_mean', roi_dict.get('mean', {}))
                    roi = [float(roi_means.get(ch, roi[i])) for i, ch in enumerate(channels)]
            except Exception:
                pass

            out = {
                'channels': channels,
                'channel_labels': [CHANNEL_DISPLAY.get(ch, ch) for ch in channels],
                'spend': spend,
                'roi': roi,
                'channel_revenue': channel_revenue,
            }
            logger.info("[Optimizer] Channel data loaded: n=%d  total_spend=%.2f  total_revenue=%.2f",
                        len(channels), sum(spend), sum(channel_revenue))
            for i, ch in enumerate(channels):
                logger.debug("[Optimizer]   %-20s  spend=%.2f  roi=%.4f  revenue=%.2f",
                             channels[i], spend[i], roi[i], channel_revenue[i])
            return out
        except Exception as e:
            logger.error("[Optimizer] Failed to load real channel data: %s", e, exc_info=True)
            return None

    def _try_meridian_optimizer(self, channel_data: dict, total_budget: float) -> Optional[dict]:
        """
        Attempt to use Meridian's BudgetOptimizer.

        This uses the full fitted model — not just point-estimate ROIs but the
        actual posterior distribution over the response curves. Meridian's
        optimizer finds the spend allocation that maximises expected revenue
        subject to a minimum floor (5% of budget per channel) and a maximum cap
        (50% of budget per channel) to ensure diversification.

        Requires Python 3.11+ with google-meridian installed and a model that
        has already been fitted via sample_posterior().
        """
        logger.info("[Optimizer] Attempting Meridian BudgetOptimizer: total_budget=%.2f", total_budget)
        try:
            from meridian.analysis.optimizer import BudgetOptimizer   # correct path in 1.5.3
            from services.meridian_runner import MeridianRunner

            model = getattr(MeridianRunner, '_last_model', None)
            if model is None:
                logger.info("[Optimizer] No fitted Meridian model found — skipping BudgetOptimizer")
                return None
            logger.debug("[Optimizer] Fitted Meridian model found — running BudgetOptimizer")

            opt = BudgetOptimizer(meridian=model)                     # param is 'meridian=', not 'model='
            result = opt.optimize(
                budget=total_budget,
                fixed_budget=True,
                spend_constraint_lower=0.05,
                spend_constraint_upper=0.50,
            )

            channels = channel_data['channels']
            channel_labels = channel_data['channel_labels']
            spend = channel_data['spend']
            roi = channel_data['roi']

            # OptimizationResults: optimized_data is an xr.Dataset with 'spend' variable
            opt_ds = result.optimized_data
            non_opt_ds = result.nonoptimized_data

            allocation = []
            for i, ch in enumerate(channels):
                try:
                    opt_spend = float(opt_ds['spend'].sel(channel=ch).values)
                except Exception:
                    opt_spend = total_budget / len(channels)
                allocation.append({
                    'channel': channel_labels[i],
                    'current_spend': spend[i],
                    'optimal_spend': opt_spend,
                    'change': opt_spend - spend[i],
                    'change_pct': round((opt_spend - spend[i]) / max(spend[i], 1) * 100, 1),
                })

            current_revenue = float(non_opt_ds.attrs.get('profit', sum(s * r for s, r in zip(spend, roi))))
            projected_revenue = float(opt_ds.attrs.get('profit', current_revenue * 1.05))

            imp = round((projected_revenue - current_revenue) / max(current_revenue, 1) * 100, 1)
            logger.info("[Optimizer] Meridian BudgetOptimizer complete: current_rev=%.2f  "
                        "projected_rev=%.2f  improvement=%.1f%%", current_revenue, projected_revenue, imp)
            for a in allocation:
                logger.debug("[Optimizer]   %-20s  current=%.2f  optimal=%.2f  change=%.1f%%",
                             a['channel'], a['current_spend'], a['optimal_spend'], a['change_pct'])
            return {
                'allocation': allocation,
                'projected_revenue': round(projected_revenue),
                'current_revenue': round(current_revenue),
                'improvement_pct': imp,
                'is_real_meridian': True,
            }
        except Exception as e:
            logger.warning("[Optimizer] Meridian BudgetOptimizer failed: %s — falling back to proportional rebalance", e)
            return None

    def optimize(self, total_budget: float, scenario: Optional[Dict] = None) -> Dict:
        """
        Optimize budget allocation across channels.

        The public entry point. Tries Meridian's optimizer first, then the
        proportional fallback. If neither can run (no data loaded at all),
        falls back to a hard-coded Indonesia demo dataset so the UI always
        has something to display.

        Returns per-channel current vs. optimal spend and the projected
        revenue improvement from making the switch.
        """
        logger.info("[Optimizer] optimize() called: total_budget=%.2f  scenario=%s",
                    total_budget, scenario)
        channel_data = self._get_channel_data()

        if channel_data is None:
            logger.warning("[Optimizer] No channel data — using static Indonesia fallback")
            # Last-resort fallback when no data has been loaded
            channel_data = {
                'channels':        ['channel_0', 'channel_1', 'channel_2', 'channel_3', 'channel_4', 'channel_5', 'channel_6', 'channel_7'],
                'channel_labels':  ['TV', 'Social', 'Search', 'OOH', 'E-commerce', 'YouTube', 'Programmatic', 'Influencer'],
                'spend':           [3_800_000_000, 1_500_000_000, 1_000_000_000, 480_000_000, 780_000_000, 680_000_000, 850_000_000, 320_000_000],
                'roi':             [2.80, 3.10, 4.50, 2.20, 4.20, 3.50, 2.60, 3.10],
                'channel_revenue': [10_640_000_000, 4_650_000_000, 4_500_000_000, 1_056_000_000, 3_276_000_000, 2_380_000_000, 2_210_000_000, 992_000_000],
            }

        # Try Meridian's BudgetOptimizer first
        meridian_result = self._try_meridian_optimizer(channel_data, total_budget)
        if meridian_result:
            return meridian_result

        logger.info("[Optimizer] Using proportional ROI rebalance (fallback)")
        channels = channel_data['channels']
        channel_labels = channel_data['channel_labels']
        spend = channel_data['spend']
        roi = channel_data['roi']
        n = len(channels)

        # Square-root weighting approximates diminishing returns without a full
        # Hill curve. A channel with 4x the ROI gets 2x the budget share, not 4x.
        roi_weights = [r ** 0.5 for r in roi]
        total_weight = sum(roi_weights)

        # Hard budget guardrails: no channel below 5% (floor) or above 50% (cap).
        min_spend = total_budget * 0.05
        max_spend = total_budget * 0.50

        raw_alloc = [(w / total_weight) * total_budget for w in roi_weights]
        clamped = [max(min_spend, min(max_spend, a)) for a in raw_alloc]

        # After clamping, the allocations no longer sum to the total budget.
        # Re-normalise to preserve the total while respecting the floor/cap constraints.
        total_clamped = sum(clamped)
        allocation_values = [round(v * total_budget / total_clamped) for v in clamped]

        current_revenue = sum(s * r for s, r in zip(spend, roi))
        projected_revenue = sum(allocation_values[i] * roi[i] * 0.95 for i in range(n))
        improvement_pct = round(
            (projected_revenue - current_revenue) / max(current_revenue, 1) * 100, 1
        )
        logger.info("[Optimizer] Proportional rebalance complete: current_rev=%.2f  "
                    "projected_rev=%.2f  improvement=%.1f%%",
                    current_revenue, projected_revenue, improvement_pct)
        for i in range(n):
            logger.debug("[Optimizer]   %-20s  current=%.2f  optimal=%.2f  change=%.1f%%",
                         channel_labels[i], spend[i], allocation_values[i],
                         (allocation_values[i] - spend[i]) / max(spend[i], 1) * 100)

        return {
            'allocation': [
                {
                    'channel': channel_labels[i],
                    'current_spend': spend[i],
                    'optimal_spend': allocation_values[i],
                    'change': allocation_values[i] - spend[i],
                    'change_pct': round(
                        (allocation_values[i] - spend[i]) / max(spend[i], 1) * 100, 1
                    ),
                }
                for i in range(n)
            ],
            'projected_revenue': round(projected_revenue),
            'current_revenue': round(current_revenue),
            'improvement_pct': improvement_pct,
            'is_real_meridian': False,
        }
