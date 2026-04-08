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
#             from taking more than the per-channel max or less than the per-channel min.
#
# Per-channel constraints mirror Meridian's ChannelConstraintRel parameter:
#   - channel_constraints: dict mapping channel name → ChannelConstraint(min_ratio, max_ratio)
#   - Channels not in the dict fall back to global defaults (5% floor, 50% cap)
#
# use_optimal_frequency / max_frequency:
#   When the dataset contains reach-and-frequency channels, these parameters
#   enable frequency-aware optimization in Meridian's BudgetOptimizer. If there
#   are no RF channels in the loaded data, a warning is logged and the optimizer
#   proceeds normally.
#
# The square-root weighting in the fallback is intentional: it's a heuristic
# that approximates the diminishing-returns effect without needing the full
# Hill curve. A channel with 4x the ROI gets √4 = 2x the weight, not 4x —
# reflecting that you can't infinitely scale a high-ROI channel.
# =============================================================================

import logging
from typing import Dict, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from routers.optimization import ChannelConstraint as ChannelConstraintType

logger = logging.getLogger(__name__)

# Global default bounds used when no per-channel constraint is provided
_DEFAULT_MIN_RATIO = 0.05
_DEFAULT_MAX_RATIO = 0.50


def _resolve_bounds(
    channels: list,
    channel_labels: list,
    total_budget: float,
    channel_constraints: Optional[Dict],
) -> tuple:
    """
    Resolve per-channel floor and cap spend amounts.

    Returns (min_spends, max_spends) as two parallel lists indexed by channel
    position. When channel_constraints is None or a channel is not listed, the
    global defaults (_DEFAULT_MIN_RATIO, _DEFAULT_MAX_RATIO) are applied.

    Lookup is by internal key first, then by display label — so callers can
    pass either form (e.g. 'tv' or 'TV').
    """
    min_spends = []
    max_spends = []
    for i, ch in enumerate(channels):
        label = channel_labels[i] if i < len(channel_labels) else ch
        constraint = None
        if channel_constraints:
            # Try internal key, then display label
            constraint = channel_constraints.get(ch) or channel_constraints.get(label)

        min_r = constraint.min_ratio if constraint is not None else _DEFAULT_MIN_RATIO
        max_r = constraint.max_ratio if constraint is not None else _DEFAULT_MAX_RATIO
        min_spends.append(total_budget * min_r)
        max_spends.append(total_budget * max_r)

    return min_spends, max_spends


def _has_rf_channels(data: Optional[dict]) -> bool:
    """Return True if the loaded dataset contains reach-and-frequency channels."""
    if data is None:
        return False
    return bool(data.get('rf_channels'))


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

            from services.results_generator import CHANNEL_DISPLAY
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

    def _try_meridian_optimizer(
        self,
        channel_data: dict,
        total_budget: float,
        channel_constraints: Optional[Dict] = None,
        use_optimal_frequency: bool = False,
        max_frequency: float = 10.0,
    ) -> Optional[dict]:
        """
        Attempt to use Meridian's BudgetOptimizer.

        Uses the full fitted model — not just point-estimate ROIs but the actual
        posterior distribution over the response curves.

        Per-channel constraints are passed as dicts to spend_constraint_lower /
        spend_constraint_upper. Meridian's BudgetOptimizer accepts either a
        scalar (applied to all channels) or a dict keyed by channel name.

        Requires Python 3.11+ with google-meridian installed and a model that
        has already been fitted via sample_posterior().
        """
        logger.info("[Optimizer] Attempting Meridian BudgetOptimizer: total_budget=%.2f", total_budget)
        try:
            from meridian.analysis.optimizer import BudgetOptimizer
            from services.meridian_runner import MeridianRunner

            model = getattr(MeridianRunner, '_last_model', None)
            if model is None:
                logger.info("[Optimizer] No fitted Meridian model found — skipping BudgetOptimizer")
                return None
            logger.debug("[Optimizer] Fitted Meridian model found — running BudgetOptimizer")

            channels = channel_data['channels']
            channel_labels = channel_data['channel_labels']
            spend = channel_data['spend']
            roi = channel_data['roi']

            # Build per-channel bounds (dict or scalar fallback)
            if channel_constraints:
                lower_bound, upper_bound = {}, {}
                for i, ch in enumerate(channels):
                    label = channel_labels[i]
                    c = channel_constraints.get(ch) or channel_constraints.get(label)
                    lower_bound[ch] = c.min_ratio if c else _DEFAULT_MIN_RATIO
                    upper_bound[ch] = c.max_ratio if c else _DEFAULT_MAX_RATIO
            else:
                lower_bound = _DEFAULT_MIN_RATIO
                upper_bound = _DEFAULT_MAX_RATIO

            opt = BudgetOptimizer(meridian=model)

            # Build optimize() kwargs; only pass frequency args when requested
            optimize_kwargs = dict(
                budget=total_budget,
                fixed_budget=True,
                spend_constraint_lower=lower_bound,
                spend_constraint_upper=upper_bound,
            )
            if use_optimal_frequency:
                try:
                    from services.data_loader import DataLoaderService
                    if _has_rf_channels(DataLoaderService._loaded_data):
                        optimize_kwargs['use_optimal_frequency'] = True
                        optimize_kwargs['max_frequency'] = max_frequency
                        logger.info("[Optimizer] RF frequency optimisation enabled (max_frequency=%.1f)", max_frequency)
                    else:
                        logger.warning(
                            "[Optimizer] use_optimal_frequency=True but no RF channels detected — ignoring"
                        )
                except Exception:
                    logger.warning("[Optimizer] Could not determine RF channel presence — skipping frequency opt")

            result = opt.optimize(**optimize_kwargs)

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

            try:
                current_revenue = float(non_opt_ds['incremental_outcome'].sum())
                projected_revenue = float(opt_ds['incremental_outcome'].sum())
            except Exception:
                try:
                    current_revenue = float(non_opt_ds.attrs.get('profit', sum(s * r for s, r in zip(spend, roi))))
                    projected_revenue = float(opt_ds.attrs.get('profit', current_revenue * 1.05))
                except Exception:
                    current_revenue = sum(s * r for s, r in zip(spend, roi))
                    projected_revenue = current_revenue * 1.05

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

    def optimize(
        self,
        total_budget: float,
        scenario: Optional[Dict] = None,
        channel_constraints: Optional[Dict] = None,
        use_optimal_frequency: bool = False,
        max_frequency: float = 10.0,
    ) -> Dict:
        """
        Optimize budget allocation across channels.

        The public entry point. Tries Meridian's optimizer first, then the
        proportional fallback. If neither can run (no data loaded at all),
        falls back to a hard-coded Indonesia demo dataset so the UI always
        has something to display.

        Parameters
        ----------
        total_budget : float
            Total budget to allocate. Must be > 0.
        scenario : dict, optional
            Reserved for future what-if overrides.
        channel_constraints : dict, optional
            Per-channel ChannelConstraint objects keyed by channel name or
            display label. Channels not in the dict use the global defaults
            (5% floor, 50% cap). Mirrors Meridian's ChannelConstraintRel.
        use_optimal_frequency : bool
            When True, enable frequency-aware optimisation for RF channels.
            No-op (with a warning) when no RF channels are present.
        max_frequency : float
            Upper limit for frequency when use_optimal_frequency is True.

        Returns per-channel current vs. optimal spend and the projected
        revenue improvement from making the switch.
        """
        logger.info(
            "[Optimizer] optimize() called: total_budget=%.2f  has_constraints=%s  "
            "use_optimal_frequency=%s  max_frequency=%.1f  scenario=%s",
            total_budget, channel_constraints is not None,
            use_optimal_frequency, max_frequency, scenario,
        )

        # Warn early if frequency requested but no RF data
        if use_optimal_frequency:
            try:
                from services.data_loader import DataLoaderService
                if not _has_rf_channels(DataLoaderService._loaded_data):
                    logger.warning(
                        "[Optimizer] use_optimal_frequency=True but loaded dataset has no "
                        "RF channels — frequency optimisation will be skipped"
                    )
            except Exception:
                pass

        channel_data = self._get_channel_data()

        if channel_data is None:
            logger.warning("[Optimizer] No channel data — using static Indonesia fallback")
            channel_data = {
                'channels':        ['channel_0', 'channel_1', 'channel_2', 'channel_3', 'channel_4', 'channel_5', 'channel_6', 'channel_7'],
                'channel_labels':  ['TV', 'Social', 'Search', 'OOH', 'E-commerce', 'YouTube', 'Programmatic', 'Influencer'],
                'spend':           [3_800_000_000, 1_500_000_000, 1_000_000_000, 480_000_000, 780_000_000, 680_000_000, 850_000_000, 320_000_000],
                'roi':             [2.80, 3.10, 4.50, 2.20, 4.20, 3.50, 2.60, 3.10],
                'channel_revenue': [10_640_000_000, 4_650_000_000, 4_500_000_000, 1_056_000_000, 3_276_000_000, 2_380_000_000, 2_210_000_000, 992_000_000],
            }

        # Try Meridian's BudgetOptimizer first
        meridian_result = self._try_meridian_optimizer(
            channel_data, total_budget, channel_constraints, use_optimal_frequency, max_frequency
        )
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

        # Resolve per-channel bounds
        min_spends, max_spends = _resolve_bounds(channels, channel_labels, total_budget, channel_constraints)

        # Water-filling allocation:
        #   1. Start every channel at its floor spend.
        #   2. Compute proportional additional spend (by roi_weights) for each active channel.
        #   3. All channels that would exceed their cap are set to the cap simultaneously;
        #      remaining budget is reduced by those channels' headroom.
        #   4. Repeat until either no channel saturates (done) or no active channels remain.
        #
        # Handling saturation all-at-once per pass (not one-at-a-time) ensures that the
        # proportional share calculation is always based on a self-consistent remaining budget.
        allocation_float = list(min_spends)
        remaining = total_budget - sum(min_spends)
        active = list(range(n))  # indices of channels that still have headroom

        for _ in range(n + 1):  # at most n passes; +1 as a safety bound
            if not active or remaining <= 1e-6:
                break

            active_weights = [roi_weights[i] for i in active]
            total_active_w = sum(active_weights) or 1.0

            # Compute tentative additional for every active channel
            tentative = [(active_weights[j] / total_active_w) * remaining
                         for j in range(len(active))]

            # Identify which channels saturate in this pass
            saturating = [(j, i) for j, i in enumerate(active)
                          if tentative[j] >= max_spends[i] - allocation_float[i]]

            if not saturating:
                # No channel hits its cap — distribute and finish
                for j, i in enumerate(active):
                    allocation_float[i] += tentative[j]
                remaining = 0.0
                break

            # Set saturating channels to their caps and subtract their headroom from pool
            saturated_set = set()
            for j, i in saturating:
                headroom = max_spends[i] - allocation_float[i]
                allocation_float[i] = max_spends[i]
                remaining -= headroom
                saturated_set.add(i)

            active = [i for i in active if i not in saturated_set]

        # If budget still remains (all channels maxed), give it to the highest-ROI channel
        if remaining > 1e-6:
            best = max(range(n), key=lambda i: roi[i])
            allocation_float[best] += remaining

        # Convert to integers; correct rounding drift to preserve total_budget exactly
        allocation_values = [round(v) for v in allocation_float]
        residual = round(total_budget) - sum(allocation_values)
        if residual != 0:
            # Absorb drift in the channel with the most headroom (furthest from its cap)
            best_adj = max(range(n), key=lambda i: max_spends[i] - allocation_values[i])
            allocation_values[best_adj] += residual

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
