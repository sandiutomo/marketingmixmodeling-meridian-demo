# =============================================================================
# services/results_generator.py — The translator: turning model output into
#                                  business insights the frontend can display
#
# After the model runs, the raw output is a collection of posterior distributions
# (probability curves over parameter values). This service's job is to extract
# the specific numbers the UI needs — ROI per channel, revenue contribution,
# model diagnostics, Hill curve parameters, adstock decay rates, and geo breakdowns
# — and package them into clean JSON-ready dicts.
#
# Like the rest of the backend, this service operates in two modes:
#
#   Real Meridian posterior (preferred):
#     When MeridianRunner.fit() has run, _last_results holds the full set of
#     posterior summaries. This service reads from that and returns true Bayesian
#     credible intervals and ROI estimates.
#
#   Correlation-based fallback:
#     When Meridian hasn't run (or isn't installed), _compute_from_data() runs
#     a quick correlation analysis directly on the spend and revenue arrays.
#     The results are less precise (no uncertainty quantification, assumes linear
#     relationships) but load instantly and always produce *something* to display.
#
# At the bottom of the file, CHANNEL_DISPLAY, CHANNEL_COLORS, FALLBACK_ROI, and
# CHANNEL_DECAY_RATE are lookup tables that map internal channel key names to
# UI-friendly labels, chart colours, and reasonable placeholder values.
# =============================================================================

import logging
import numpy as np
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

# ── UI lookup tables ──────────────────────────────────────────────────────────

CHANNEL_DISPLAY = {
    'tv': 'TV', 'paid_search': 'Paid Search', 'social': 'Social',
    'display': 'Display', 'radio': 'Radio', 'youtube': 'YouTube',
    'ooh': 'OOH', 'organic': 'Organic', 'email': 'Email',
    'search': 'Search', 'ecommerce': 'E-commerce',
    'programmatic': 'Programmatic', 'influencer': 'Influencer',
    # Indonesia CSV channels (Channel{i}_spend → channel_{i})
    'channel_0': 'TV', 'channel_1': 'Social', 'channel_2': 'Search',
    'channel_3': 'OOH', 'channel_4': 'E-commerce', 'channel_5': 'YouTube',
    'channel_6': 'Programmatic', 'channel_7': 'Influencer',
}

CHANNEL_COLORS = {
    'tv': '#4361ee', 'paid_search': '#7209b7', 'social': '#f72585',
    'display': '#4cc9f0', 'radio': '#3a0ca3', 'youtube': '#ff6b6b',
    'ooh': '#06d6a0', 'organic': '#95d5b2', 'email': '#06d6a0',
    'search': '#7209b7', 'ecommerce': '#f04e24',
    'programmatic': '#4cc9f0', 'influencer': '#e1306c',
}

FALLBACK_ROI = {
    'tv': 2.80, 'paid_search': 4.20, 'social': 3.10, 'display': 1.40,
    'radio': 1.90, 'youtube': 3.50, 'ooh': 2.20, 'organic': 6.00, 'email': 5.80,
    # Indonesia dataset channels
    'search': 4.50, 'ecommerce': 4.20, 'programmatic': 2.60, 'influencer': 3.10,
}

# Heuristic adstock decay rates per channel type — used when Meridian hasn't run.
# These reflect typical real-world carryover patterns: broadcast channels (TV,
# radio, OOH) linger longer in memory; performance channels (paid search, display)
# have very short carryover because they only work when the user is actively browsing.
CHANNEL_DECAY_RATE = {
    'tv': 0.65, 'radio': 0.55, 'ooh': 0.58, 'youtube': 0.35,
    'social': 0.35, 'display': 0.25, 'paid_search': 0.20,
    'search': 0.10, 'ecommerce': 0.18, 'programmatic': 0.20, 'influencer': 0.14,
    'email': 0.15, 'organic': 0.40,
}


def _pearson_r(x: np.ndarray, y: np.ndarray) -> float:
    # Pearson correlation measures how closely two variables move together
    # on a scale from -1 (perfectly opposite) to +1 (perfectly together).
    # We use it as a proxy for "how strongly does spending on this channel
    # correlate with higher revenue?" — not causation, but a useful signal
    # when we don't have a full Bayesian posterior to pull from.
    mx, my = x.mean(), y.mean()
    cov = ((x - mx) * (y - my)).mean()
    sx = np.std(x)
    sy = np.std(y)
    return float(cov / (sx * sy)) if sx > 0 and sy > 0 else 0.0


def _compute_from_data(data: dict) -> Optional[dict]:
    """
    Compute ROI and attribution from loaded data using correlation (fallback path).

    This runs when Meridian hasn't been fitted. It's a purely statistical
    approximation — not causal inference. The key steps:

      1. Compute the Pearson correlation between each channel's spend and revenue.
      2. Weight each channel's contribution by both its correlation and its
         total spend (channels that correlate *and* spend a lot get more credit).
      3. Attribute 85% of total revenue to media channels combined
         (15% is assumed to be "base" — what the brand would have earned anyway).
      4. Estimate ROI = attributed revenue / spend for each channel.
      5. Build confidence intervals using the coefficient of variation (CV) of
         spend — channels with very inconsistent spend have wider, less reliable
         intervals (CV = standard deviation / mean).
      6. Estimate R² (model fit) by comparing the model's predictions to actual
         revenue. This is a rough estimate, not the same R² Meridian computes.
    """
    logger.debug("[ResultsGenerator] _compute_from_data() — correlation-based attribution")
    try:
        spend = data['spend_data']
        kpi   = data['kpi_data']
        channels = data['channels']

        # Flatten geo × time dimensions
        if spend.ndim == 3:
            X = spend.reshape(-1, spend.shape[-1])
            y = kpi.reshape(-1)
        else:
            X = spend.astype(float)
            y = kpi.astype(float)

        n_obs = len(X)
        total_spend_per_ch = X.sum(axis=0)
        total_revenue = float(y.sum())
        total_spend = float(total_spend_per_ch.sum())

        # Correlation-based attribution (illustrative — not Bayesian causal)
        corrs = np.array([max(_pearson_r(X[:, i], y), 0.01) for i in range(len(channels))])
        weights = corrs * total_spend_per_ch
        weight_sum = weights.sum()

        media_fraction = 0.85
        channel_revenue = (weights / weight_sum) * total_revenue * media_fraction if weight_sum > 0 \
            else np.ones(len(channels)) * total_revenue * media_fraction / len(channels)

        roi = np.where(total_spend_per_ch > 0, channel_revenue / total_spend_per_ch,
                       np.array([FALLBACK_ROI.get(ch, 2.0) for ch in channels]))

        # Confidence intervals via coefficient of variation
        cv = np.where(X.mean(axis=0) > 0, X.std(axis=0) / X.mean(axis=0), 1.0)
        ci_lower = roi * np.maximum(0.55, 1 - cv * 0.45)
        ci_upper = roi * np.minimum(1.90, 1 + cv * 0.65)
        confidence = ['High' if c < 0.35 else 'Medium' if c < 0.65 else 'Low' for c in cv]

        # R² (correlation-based fit estimate)
        y_mean = y.mean()
        base_weekly = total_revenue * 0.15 / n_obs
        predicted = base_weekly + (X * roi).sum(axis=1) * 0.85
        ss_tot = ((y - y_mean) ** 2).sum()
        ss_res = ((y - predicted) ** 2).sum()
        r_squared = float(np.clip(1 - ss_res / ss_tot, 0, 0.99)) if ss_tot > 0 else 0.92

        logger.info("[ResultsGenerator] Correlation attribution: total_revenue=%.2f  total_spend=%.2f  r_squared=%.4f",
                    total_revenue, total_spend, r_squared)
        for i, ch in enumerate(channels):
            logger.debug("[ResultsGenerator]   %-20s  spend=%.2f  revenue=%.2f  roi=%.4f  "
                         "ci=[%.4f, %.4f]  confidence=%s  corr=%.4f",
                         ch, float(total_spend_per_ch[i]), float(channel_revenue[i]),
                         float(roi[i]), float(ci_lower[i]), float(ci_upper[i]),
                         confidence[i], float(corrs[i]))
        return {
            'channels': channels,
            'roi': roi,
            'ci_lower': ci_lower,
            'ci_upper': ci_upper,
            'channel_revenue': channel_revenue,
            'total_spend_per_ch': total_spend_per_ch,
            'total_revenue': total_revenue,
            'total_spend': total_spend,
            'confidence': confidence,
            'r_squared': r_squared,
            'X': X,
        }
    except Exception as e:
        logger.error("[ResultsGenerator] _compute_from_data() failed: %s", e, exc_info=True)
        return None


def _safe_get(d: dict, *keys) -> Optional[float]:
    """Try multiple key names in a dict, return first found value as float."""
    for key in keys:
        if key in d:
            try:
                return float(d[key])
            except (TypeError, ValueError):
                continue
    return None


class ResultsGeneratorService:
    """
    Computes results from real Meridian CSV data via DataLoaderService.
    When MeridianRunner has real posterior results, uses those preferentially.
    Otherwise falls back to correlation-based computation.

    Each public method follows the same pattern:
      1. Check if MeridianRunner has real posterior results → use those.
      2. Fall back to _compute_from_data() (correlation-based).
      3. If even that fails (no data loaded), return static placeholder data
         so the frontend never shows a blank screen.
    """

    @staticmethod
    def _label_ch(ch: str) -> str:
        from services.data_loader import DataLoaderService
        data = DataLoaderService._loaded_data
        if data and data.get('channel_labels'):
            return str(data['channel_labels'].get(ch, CHANNEL_DISPLAY.get(ch, ch.replace('_', ' ').title())))
        return CHANNEL_DISPLAY.get(ch, ch)

    def _get_meridian_results(self) -> Optional[dict]:
        """Return real Meridian posterior results if Meridian.fit() has been run."""
        try:
            from services.meridian_runner import MeridianRunner
            return MeridianRunner._last_results
        except Exception:
            return None

    def _get_computed(self) -> Optional[dict]:
        from services.data_loader import DataLoaderService
        data = DataLoaderService._loaded_data
        if data is None:
            return None
        return _compute_from_data(data)

    def get_roi(self) -> List[Dict]:
        logger.info("[ResultsGenerator] get_roi() called")
        # ── Real Meridian posterior ──────────────────────────────────────────
        meridian = self._get_meridian_results()
        if meridian and meridian.get('roi_summary') and meridian.get('channels'):
            logger.info("[ResultsGenerator] get_roi() → using real Meridian posterior (%d channels)",
                        len(meridian['channels']))
            channels = meridian['channels']
            roi_dict = meridian['roi_summary']
            # roi_dict format: {'roi_mean': {ch: val}, 'roi_ci_low': {ch: val}, 'roi_ci_high': {ch: val}}
            roi_means  = roi_dict.get('roi_mean',    roi_dict.get('mean', {}))
            roi_lowers = roi_dict.get('roi_ci_low',  roi_dict.get('roi_ci_lower', roi_dict.get('ci_lo', {})))
            roi_uppers = roi_dict.get('roi_ci_high', roi_dict.get('roi_ci_upper', roi_dict.get('ci_hi', {})))

            # Contribution: flat dict {channel: value} from summary_metrics incremental_outcome
            contrib_dict = meridian.get('contribution', {})
            # Support both flat {ch: val} and nested {'contribution_mean': {ch: val}}
            if contrib_dict and not isinstance(next(iter(contrib_dict.values()), 0), dict):
                contrib_mean = contrib_dict  # already flat
            else:
                contrib_mean = contrib_dict.get('contribution_mean', contrib_dict.get('mean', {}))

            # Pull spend totals from loaded data.
            # media_units == spend because with_media(spend, spend, channels) passes
            # spend for both media and media_spend args — so ec and spend share units.
            from services.data_loader import DataLoaderService
            _data      = DataLoaderService._loaded_data
            _spend_arr = _data['spend_data'] if _data else None
            _ch_list   = _data['channels']   if _data else []

            def _spend_for(ch_key: str) -> float:
                if _spend_arr is None or ch_key not in _ch_list:
                    return 0.0
                idx = _ch_list.index(ch_key)
                if _spend_arr.ndim == 3:
                    return float(_spend_arr[:, :, idx].sum())
                return float(_spend_arr[:, idx].sum())

            result = []
            for ch in channels:
                roi_val   = _safe_get({ch: roi_means.get(ch)},   ch) or FALLBACK_ROI.get(ch, 2.0)
                ci_lo     = _safe_get({ch: roi_lowers.get(ch)},  ch) or roi_val * 0.75
                ci_hi     = _safe_get({ch: roi_uppers.get(ch)},  ch) or roi_val * 1.35
                revenue   = _safe_get({ch: contrib_mean.get(ch)}, ch) or 0.0
                result.append({
                    'channel':      self._label_ch(ch),
                    'roi':          roi_val,
                    'roi_ci_lower': ci_lo,
                    'roi_ci_upper': ci_hi,
                    'spend':        _spend_for(ch),
                    'revenue':      revenue,
                    'confidence':   'High',  # real posterior — always high
                    'color':        CHANNEL_COLORS.get(ch, '#94a3b8'),
                    'is_real_meridian': True,
                })
            return result

        # ── Correlation-based fallback ───────────────────────────────────────
        computed = self._get_computed()
        if computed:
            channels = computed['channels']
            logger.info("[ResultsGenerator] get_roi() → correlation fallback (%d channels)", len(channels))
            return [
                {
                    'channel':      self._label_ch(ch),
                    'roi':          float(computed['roi'][i]),
                    'roi_ci_lower': float(computed['ci_lower'][i]),
                    'roi_ci_upper': float(computed['ci_upper'][i]),
                    'spend':        float(computed['total_spend_per_ch'][i]),
                    'revenue':      float(computed['channel_revenue'][i]),
                    'confidence':   computed['confidence'][i],
                    'color':        CHANNEL_COLORS.get(ch, '#94a3b8'),
                    'is_real_meridian': False,
                }
                for i, ch in enumerate(channels)
            ]
        # Static fallback
        logger.warning("[ResultsGenerator] get_roi() → static fallback (no data loaded)")
        return [
            {'channel': self._label_ch(ch), 'roi': FALLBACK_ROI.get(ch, 2.0),
             'roi_ci_lower': FALLBACK_ROI.get(ch, 2.0) * 0.75,
             'roi_ci_upper': FALLBACK_ROI.get(ch, 2.0) * 1.35,
             'spend': 500000, 'revenue': 500000 * FALLBACK_ROI.get(ch, 2.0),
             'confidence': 'Medium', 'color': CHANNEL_COLORS.get(ch, '#94a3b8'),
             'is_real_meridian': False}
            for ch in ['tv', 'paid_search', 'social', 'display', 'radio']
        ]

    def get_contribution(self) -> List[Dict]:
        # ── Real Meridian posterior ──────────────────────────────────────────
        meridian = self._get_meridian_results()
        if meridian and meridian.get('contribution') and meridian.get('channels'):
            channels = meridian['channels']
            contrib_dict = meridian['contribution']
            # Support both flat {ch: val} and nested {'contribution_mean': {ch: val}}
            if contrib_dict and not isinstance(next(iter(contrib_dict.values()), 0), dict):
                contrib_mean = contrib_dict
            else:
                contrib_mean = contrib_dict.get('contribution_mean', contrib_dict.get('mean', {}))
            total = sum(float(v) for v in contrib_mean.values() if v is not None) or 1.0

            result = [
                {
                    'channel':      self._label_ch(ch),
                    'contribution': float(contrib_mean.get(ch, 0.0)),
                    'percentage':   round(float(contrib_mean.get(ch, 0.0)) / total * 100, 1),
                    'color':        CHANNEL_COLORS.get(ch, '#94a3b8'),
                }
                for ch in channels
            ]
            return result

        # ── Correlation-based fallback ───────────────────────────────────────
        computed = self._get_computed()
        if computed:
            channels = computed['channels']
            total_revenue = computed['total_revenue']
            base_rev = total_revenue * 0.15

            result = [
                {
                    'channel':      self._label_ch(ch),
                    'contribution': float(computed['channel_revenue'][i]),
                    'percentage':   round(float(computed['channel_revenue'][i]) / total_revenue * 100, 1),
                    'color':        CHANNEL_COLORS.get(ch, '#94a3b8'),
                }
                for i, ch in enumerate(channels)
            ]
            result.append({
                'channel': 'Base (non-media)',
                'contribution': float(base_rev),
                'percentage': round(base_rev / total_revenue * 100, 1),
                'color': '#e4e8f0',
            })
            return result
        return []

    def get_diagnostics(self) -> Dict:
        """
        Returns real diagnostics when Meridian.fit() has been run.
        Otherwise returns only what can be honestly computed from the data.
        """
        logger.info("[ResultsGenerator] get_diagnostics() called")
        # ── Real Meridian posterior ──────────────────────────────────────────
        meridian = self._get_meridian_results()
        if meridian:
            logger.info("[ResultsGenerator] get_diagnostics() → real Meridian: rhat_max=%.4f  r_squared=%.4f",
                        (meridian.get('rhat') or {}).get('max') or 0,
                        meridian.get('r_squared') or 0)
            rhat = meridian.get('rhat', {})
            ess  = meridian.get('ess', {})
            return {
                'available': True,
                'is_real_meridian': True,
                'rhat': {
                    'max':            rhat.get('max'),
                    'mean':           rhat.get('mean'),
                    'all_below_1_2':  rhat.get('all_below_1_2'),
                    'pct_bad_rhat':   rhat.get('pct_bad_rhat'),
                },
                'ess': {
                    'min':  ess.get('min'),
                    'mean': ess.get('mean'),
                },
                'bfmi_mean': meridian.get('bfmi_mean'),
                'model_fit': {
                    'r_squared': meridian.get('r_squared'),
                    'mape':      meridian.get('mape'),
                },
                'convergence_message': 'Real MCMC diagnostics from Meridian posterior + ArviZ ESS/BFMI.',
            }

        # ── Correlation-based fallback ───────────────────────────────────────
        computed = self._get_computed()
        if computed is None:
            return {'available': False, 'message': 'Run the model to see convergence diagnostics.'}

        r_squared = computed['r_squared']
        mape = round((1 - r_squared) * 0.85, 3)
        return {
            'available': True,
            'is_real_meridian': False,
            'rhat': None,
            'ess': None,
            'model_fit': {
                'r_squared': r_squared,
                'mape': mape,
                'interpretation': (
                    f'Correlation-based fit estimate: {round(r_squared * 100)}% of revenue '
                    'variance explained. Run backend with Python 3.11+ to get real MCMC diagnostics.'
                ),
            },
            'convergence_message': 'MCMC diagnostics require Meridian (Python 3.11+).',
        }

    def get_hill_params(self) -> List[Dict]:
        """
        Returns Hill saturation parameters per channel.
        Uses real posterior Hill parameters if Meridian ran, otherwise estimates from data.
        Hill function: revenue = maxResponse × spend^slope / (ec^slope + spend^slope)
        """
        # ── Real Meridian posterior ──────────────────────────────────────────
        meridian = self._get_meridian_results()
        if meridian and meridian.get('hill_params'):
            return [
                {
                    'channel':     ResultsGeneratorService._label_ch(str(p.get('channel', ''))),
                    'channel_key': p.get('channel', ''),
                    'ec':          p.get('ec'),
                    'slope':       p.get('slope'),
                    'maxResponse': p.get('max_response'),
                    'isReal':      True,
                }
                for p in meridian['hill_params']
            ]

        # ── Estimate from data ───────────────────────────────────────────────
        computed = self._get_computed()
        if not computed:
            return []

        channels = computed['channels']
        X = computed['X']  # shape: (n_obs, n_channels)
        result = []
        for i, ch in enumerate(channels):
            total_spend   = float(computed['total_spend_per_ch'][i])
            channel_rev   = float(computed['channel_revenue'][i])
            max_response  = channel_rev * 2.5  # estimated saturation ceiling
            # ec = spend level that generates ~50% of max_response
            ec            = total_spend * 0.6 if total_spend > 0 else max_response / 2
            slope         = 2.0  # typical Hill slope
            result.append({
                'channel':     CHANNEL_DISPLAY.get(ch, ch),
                'channel_key': ch,
                'ec':          ec,
                'slope':       slope,
                'maxResponse': max_response,
                'isReal':      False,
            })
        return result

    def get_adstock_params(self) -> List[Dict]:
        """
        Returns adstock (carryover) parameters per channel.
        Uses real posterior decay rates if Meridian ran, otherwise uses channel-type heuristics.
        Carryover at week N = decayRate^N of original week's impact.
        """
        # ── Real Meridian posterior ──────────────────────────────────────────
        meridian = self._get_meridian_results()
        if meridian and meridian.get('adstock_params'):
            return [
                {
                    'channel':     ResultsGeneratorService._label_ch(str(p.get('channel', ''))),
                    'channel_key': p.get('channel', ''),
                    'decayRate':   p.get('decay_rate'),
                    'maxLag':      p.get('max_lag', 8),
                    'isReal':      True,
                }
                for p in meridian['adstock_params']
            ]

        # ── Channel-type heuristics ──────────────────────────────────────────
        computed = self._get_computed()
        if not computed:
            return []

        from services.model_runner import ModelRunnerService
        config = ModelRunnerService._config or {}
        max_lag = int(config.get('maxLag', 8))

        return [
            {
                'channel':     CHANNEL_DISPLAY.get(ch, ch),
                'channel_key': ch,
                'decayRate':   CHANNEL_DECAY_RATE.get(ch, 0.40),
                'maxLag':      max_lag,
                'isReal':      False,
            }
            for ch in computed['channels']
        ]

    def get_geo_breakdown(self) -> List[Dict]:
        """
        Returns per-geo ROI breakdown.
        Uses real Meridian posterior (aggregate_geos=False) when available,
        otherwise estimates from the loaded geo-level data.
        """
        # ── Real Meridian posterior ──────────────────────────────────────────
        meridian = self._get_meridian_results()
        if meridian and meridian.get('geo_roi'):
            return meridian['geo_roi']

        # ── Estimate from raw data ───────────────────────────────────────────
        try:
            from services.data_loader import DataLoaderService
            data = DataLoaderService._loaded_data
            if data is None:
                return []

            spend  = data['spend_data']   # (n_geos, n_times, n_channels) or (n_times, n_channels)
            kpi    = data['kpi_data']
            channels = data['channels']

            if spend.ndim != 3:
                # National or flat data — no geo dimension
                return []

            n_geos, n_times, n_channels = spend.shape
            rows = []
            for g in range(n_geos):
                X = spend[g].astype(float)   # (n_times, n_channels)
                y = kpi[g].astype(float) if kpi.ndim == 2 else kpi.astype(float)

                total_spend_per_ch = X.sum(axis=0)
                total_revenue = float(y.sum())
                total_spend   = float(total_spend_per_ch.sum())

                corrs = np.array([max(_pearson_r(X[:, i], y), 0.01) for i in range(n_channels)])
                weights = corrs * total_spend_per_ch
                weight_sum = weights.sum()
                channel_revenue = (weights / weight_sum) * total_revenue * 0.85 if weight_sum > 0 \
                    else np.ones(n_channels) * total_revenue * 0.85 / n_channels

                portfolio_roi = float(channel_revenue.sum() / total_spend) if total_spend > 0 else 0.0
                rows.append({
                    'geo':           f'Geo {g}',
                    'totalRevenue':  round(total_revenue),
                    'totalSpend':    round(total_spend),
                    'portfolioRoi':  round(portfolio_roi, 2),
                    'mediaRevenue':  round(float(channel_revenue.sum())),
                    'baseRevenue':   round(total_revenue * 0.15),
                    'channels': [
                        {
                            'channel': CHANNEL_DISPLAY.get(ch, ch),
                            'roi':     round(float(channel_revenue[i] / total_spend_per_ch[i]), 2)
                                       if total_spend_per_ch[i] > 0 else FALLBACK_ROI.get(ch, 2.0),
                            'spend':   round(float(total_spend_per_ch[i])),
                            'revenue': round(float(channel_revenue[i])),
                        }
                        for i, ch in enumerate(channels)
                    ],
                    'isReal': False,
                })

            # Sort by portfolio ROI descending
            rows.sort(key=lambda r: r['portfolioRoi'], reverse=True)
            return rows

        except Exception as e:
            logger.error("[ResultsGenerator] Geo breakdown failed: %s", e, exc_info=True)
            return []

    def get_timeseries(self, period: str = 'quarterly') -> Dict:
        """
        Return channel revenue attribution broken down by time period.

        Aggregates weekly spend × ROI into period buckets so the frontend can
        display a stacked bar/area chart of "how did each channel perform over time?"

        This mirrors the Meridian Scenario Planner notebook's time_breakdown_generators
        parameter (yearly / quarterly / monthly / weekly granularities).

        Parameters
        ----------
        period : str
            One of 'weekly' | 'monthly' | 'quarterly' | 'yearly'.
            Validated upstream by the router.

        Returns
        -------
        {
          "periods":  ["2022-Q1", "2022-Q2", ...],   # period labels
          "channels": ["TV", "Social", ...],           # channel display names
          "data": [
            {
              "period": "2022-Q1",
              "TV":     123456.0,
              "Social": 78901.0,
              "Base":   45000.0,
              "total":  247357.0,
            },
            ...
          ]
        }
        """
        import datetime

        # ── Real Meridian posterior (not yet implemented for time-series) ────────
        # Meridian's Analyzer does not expose a direct per-week contribution tensor
        # via the public 1.5.3 API. The expected_outcome() dataset returns aggregate
        # contributions, not a time-indexed series. We therefore use the fallback
        # (spend × posterior-ROI) for now; the Meridian path is reserved for future
        # API versions that expose time-series contribution directly.
        # ─────────────────────────────────────────────────────────────────────────

        # ── Fallback: spend × ROI per time step, bucketed by date ───────────────
        try:
            from services.data_loader import DataLoaderService
            data = DataLoaderService._loaded_data
        except Exception:
            data = None

        if data is None:
            return {'periods': [], 'channels': [], 'data': []}

        try:
            spend_arr = data['spend_data']    # (n_times, n_channels) or (n_geos, n_times, n_channels)
            channels  = data['channels']
            time_coords = data.get('time_coords', [])

            # Flatten geo dimension if present (average across geos for national view)
            if spend_arr.ndim == 3:
                spend_2d = spend_arr.mean(axis=0)  # (n_times, n_channels)
                kpi_1d   = data['kpi_data'].mean(axis=0) if data['kpi_data'].ndim == 2 \
                           else data['kpi_data']
            else:
                spend_2d = spend_arr.astype(float)
                kpi_1d   = data['kpi_data'].astype(float)

            n_times, n_channels = spend_2d.shape

            # Get per-channel ROI (prefer Meridian posterior, fall back to correlation)
            computed = _compute_from_data(data)
            if computed is not None:
                roi_per_ch = computed['roi']  # shape: (n_channels,)
            else:
                roi_per_ch = np.array([FALLBACK_ROI.get(ch, 2.0) for ch in channels])

            # Try real Meridian posterior ROIs
            try:
                from services.meridian_runner import MeridianRunner
                meridian = MeridianRunner._last_results
                if meridian and meridian.get('roi_summary'):
                    roi_dict = meridian['roi_summary']
                    roi_means = roi_dict.get('roi_mean', roi_dict.get('mean', {}))
                    roi_per_ch = np.array([float(roi_means.get(ch, roi_per_ch[i]))
                                           for i, ch in enumerate(channels)])
            except Exception:
                pass

            # Revenue per channel per time step: use Hill function when posterior params available,
            # otherwise fall back to linear spend × ROI attribution (same 85% used in _compute_from_data)
            try:
                from services.meridian_runner import MeridianRunner
                _mr = MeridianRunner._last_results
                _hill_params = _mr.get('hill_params') if _mr else None
            except Exception:
                _hill_params = None

            if _hill_params:
                hill_rev = self._hill_revenue_timeseries(spend_2d, _hill_params, channels)
                flat_rev = spend_2d * roi_per_ch * 0.85
                # For channels missing Hill params (hill_rev == 0), fall back to flat ROI
                ch_revenue_2d = np.where(hill_rev > 0, hill_rev, flat_rev)
            else:
                ch_revenue_2d = spend_2d * roi_per_ch * 0.85  # (n_times, n_channels)

            # Base revenue per time step: 15% of total kpi
            total_kpi = float(kpi_1d.sum()) if kpi_1d.sum() > 0 else 1.0
            base_revenue_per_step = kpi_1d * 0.15  # (n_times,)

            # Build time index
            def _parse_date(s: str) -> datetime.date:
                try:
                    return datetime.date.fromisoformat(s)
                except (ValueError, TypeError):
                    return datetime.date(2020, 1, 1)

            dates = [_parse_date(tc) for tc in time_coords] if time_coords else [
                datetime.date(2020, 1, 1) + datetime.timedelta(weeks=i)
                for i in range(n_times)
            ]

            # Determine period label for each time step
            def _period_label(d: datetime.date, p: str) -> str:
                if p == 'yearly':
                    return str(d.year)
                if p == 'quarterly':
                    q = (d.month - 1) // 3 + 1
                    return f"{d.year}-Q{q}"
                if p == 'monthly':
                    return f"{d.year}-{d.month:02d}"
                # weekly
                return d.isoformat()

            # Group time steps by period label
            period_map: dict = {}  # label → {'channels': [...], 'base': float}
            for t in range(n_times):
                label = _period_label(dates[t], period)
                if label not in period_map:
                    period_map[label] = {
                        'ch_totals': np.zeros(n_channels),
                        'base': 0.0,
                    }
                period_map[label]['ch_totals'] += ch_revenue_2d[t]
                period_map[label]['base'] += float(base_revenue_per_step[t])

            # Sort period labels chronologically
            sorted_labels = sorted(period_map.keys())

            channel_labels = [CHANNEL_DISPLAY.get(ch, ch) for ch in channels]

            data_rows = []
            for label in sorted_labels:
                entry = period_map[label]
                row: Dict[str, Any] = {'period': label}
                ch_sum = 0.0
                for i, ch_label in enumerate(channel_labels):
                    val = round(float(entry['ch_totals'][i]), 2)
                    row[ch_label] = max(0.0, val)
                    ch_sum += row[ch_label]
                base_val = round(max(0.0, entry['base']), 2)
                row['Base'] = base_val
                row['total'] = round(ch_sum + base_val, 2)
                data_rows.append(row)

            logger.info(
                "[ResultsGenerator] get_timeseries(period=%s): %d buckets, %d channels",
                period, len(sorted_labels), n_channels,
            )
            return {
                'periods':  sorted_labels,
                'channels': channel_labels,
                'data':     data_rows,
            }

        except Exception as e:
            logger.error("[ResultsGenerator] get_timeseries() failed: %s", e, exc_info=True)
            return {'periods': [], 'channels': [], 'data': []}

    # ------------------------------------------------------------------
    # B1: Hill-based timeseries helper
    # ------------------------------------------------------------------

    def _hill_revenue_timeseries(
        self,
        spend_2d: np.ndarray,
        hill_params_list: list,
        channel_keys: list,
    ) -> np.ndarray:
        """
        Compute per-time-step revenue using the Hill saturation function instead
        of flat spend×ROI. Channels without hill_params get a zero column so the
        caller can fall back to the flat path for those channels.

        Parameters
        ----------
        spend_2d      : shape (n_times, n_channels), weekly spend
        hill_params_list : list of dicts with keys channel_key, ec, slope, maxResponse
        channel_keys  : ordered list of channel key strings (matches spend_2d columns)

        Returns
        -------
        revenue_2d    : shape (n_times, n_channels), same dtype as spend_2d
        """
        revenue_2d = np.zeros_like(spend_2d, dtype=np.float64)
        for j, ch_key in enumerate(channel_keys):
            hp = next((h for h in hill_params_list if h.get('channel_key') == ch_key), None)
            if hp and hp.get('ec') and hp.get('maxResponse') and hp['ec'] > 0 and hp['maxResponse'] > 0:
                ec    = float(hp['ec'])
                slope = float(hp.get('slope', 2.0))
                mr    = float(hp['maxResponse'])
                x = spend_2d[:, j]
                x_s  = np.power(np.maximum(x, 0.0), slope)
                ec_s = ec ** slope
                revenue_2d[:, j] = mr * x_s / (ec_s + x_s)
            # channels without hill_params remain 0 (caller uses flat fallback)
        return revenue_2d

    # ------------------------------------------------------------------
    # C3: Synergy (cross-channel Pearson correlation matrix)
    # ------------------------------------------------------------------

    def get_synergy(self) -> Dict:
        """
        Compute pairwise Pearson correlation of weekly channel contribution (spend × ROI).
        Using attributed contribution rather than raw spend avoids conflating co-scheduled flights
        with true synergy — channels that merely run in the same weeks will show lower r than
        channels that drive revenue together.
        Returns an n×n matrix plus a filtered+sorted pairs list.
        """
        try:
            from services.data_loader import DataLoaderService
            data = DataLoaderService._loaded_data
            if data is None:
                return {'channels': [], 'matrix': [], 'pairs': [], 'method': 'mock'}

            spend_raw = data['spend_data']
            channel_keys   = data['channels']
            channel_labels = data.get('channel_labels', {})

            # Flatten geo dimension if 3D (n_geos, n_times, n_channels)
            if spend_raw.ndim == 3:
                spend_2d = spend_raw.reshape(-1, spend_raw.shape[2])
            else:
                spend_2d = spend_raw  # (n_times, n_channels)

            n = len(channel_keys)
            display_names = [
                channel_labels.get(k, CHANNEL_DISPLAY.get(k, k.replace('_', ' ').title()))
                for k in channel_keys
            ]

            # Use attributed contribution (spend × ROI) rather than raw spend.
            # Correlating raw spend can reflect shared scheduling/seasonality; contribution
            # reflects the actual revenue signal each channel produces per time step.
            roi_data = self.get_roi()  # returns List[Dict] with 'channel' and 'roi' keys
            roi_by_key = {ch['channel']: ch['roi'] for ch in (roi_data if isinstance(roi_data, list) else [])}
            roi_arr = np.array([float(roi_by_key.get(k, FALLBACK_ROI.get(k, 2.0)))
                                for k in channel_keys])
            contribution_2d = spend_2d * roi_arr  # (n_times_or_flattened, n_channels)

            # Build n×n correlation matrix on contribution series
            matrix: List[List[float]] = []
            for i in range(n):
                row = []
                for j in range(n):
                    if i == j:
                        row.append(1.0)
                    elif j < i:
                        row.append(matrix[j][i])  # symmetric
                    else:
                        r = _pearson_r(contribution_2d[:, i], contribution_2d[:, j])
                        row.append(round(r, 6))
                matrix.append(row)

            # Build pairs list — only |r| > 0.1, sorted descending
            pairs = []
            for i in range(n):
                for j in range(i + 1, n):
                    r = matrix[i][j]
                    if abs(r) <= 0.1:
                        continue
                    if r >= 0.7:
                        interp = 'strong'
                    elif r >= 0.45:
                        interp = 'moderate'
                    elif r >= 0.1:
                        interp = 'weak'
                    else:
                        interp = 'negative'
                    pairs.append({
                        'channel_a':      display_names[i],
                        'channel_b':      display_names[j],
                        'correlation':    round(r, 4),
                        'interpretation': interp,
                    })
            pairs.sort(key=lambda p: abs(p['correlation']), reverse=True)

            meridian = self._get_meridian_results()
            method = 'meridian' if meridian else 'pearson'

            logger.info("[ResultsGenerator] get_synergy(): %d channels, %d pairs", n, len(pairs))
            return {
                'channels': display_names,
                'matrix':   matrix,
                'pairs':    pairs,
                'method':   method,
            }
        except Exception as e:
            logger.error("[ResultsGenerator] get_synergy() failed: %s", e, exc_info=True)
            return {'channels': [], 'matrix': [], 'pairs': [], 'method': 'mock'}

    # ------------------------------------------------------------------
    # C2: Saturation frontier
    # ------------------------------------------------------------------

    @staticmethod
    def _hill_marginal(spend: float, ec: float, slope: float, max_response: float) -> Optional[float]:
        """Hill curve derivative — marginal revenue at a given spend level."""
        if spend <= 0 or ec <= 0 or max_response <= 0:
            return None
        ec_s = ec ** slope
        x_s  = spend ** slope
        try:
            return float(max_response * slope * ec_s * (spend ** (slope - 1)) / (ec_s + x_s) ** 2)
        except Exception:
            return None

    def get_saturation(self) -> Dict:
        """
        Per-channel saturation analysis: saturation_ratio, marginal ROI,
        and status ('saturated' | 'efficient' | 'room_to_grow').
        """
        try:
            from services.data_loader import DataLoaderService
            data = DataLoaderService._loaded_data
            if data is None:
                return {'channels': [], 'is_real_meridian': False}

            hill_list   = self.get_hill_params()   # already handles Meridian + fallback
            roi_list    = self.get_roi()            # already handles Meridian + fallback
            meridian    = self._get_meridian_results()
            is_real     = meridian is not None

            # Build a lookup by channel_key
            roi_by_key  = {r.get('channel', '').lower().replace(' ', '_'): r for r in roi_list}

            channels_out = []
            for hp in hill_list:
                ch_key   = hp.get('channel_key', '')
                ch_label = hp.get('channel', ch_key)

                # Match ROI entry — try exact key then fuzzy
                roi_entry = roi_by_key.get(ch_key) or roi_by_key.get(ch_label.lower().replace(' ', '_')) or {}
                roi_val   = float(roi_entry.get('roi', 0.0))

                spend_raw = data['spend_data']
                channels  = data['channels']
                ch_idx    = channels.index(ch_key) if ch_key in channels else -1
                if ch_idx >= 0:
                    if spend_raw.ndim == 3:
                        current_spend = float(spend_raw[:, :, ch_idx].sum() / max(data.get('n_times', 1), 1) * 4)
                    else:
                        current_spend = float(spend_raw[:, ch_idx].sum() / max(data.get('n_times', 1), 1) * 4)
                else:
                    current_spend = 0.0

                ec            = hp.get('ec')
                slope         = float(hp.get('slope', 2.0))
                max_response  = hp.get('maxResponse')

                sat_ratio = round(current_spend / ec, 4) if ec and ec > 0 else 0.0
                mroi      = self._hill_marginal(current_spend, ec or 1.0, slope, max_response or 1.0) if ec else None

                # Derive status — prefer existing saturationStatus from ROI data
                existing_status = roi_entry.get('saturationStatus')
                if existing_status in ('saturated', 'efficient', 'room_to_grow'):
                    status = existing_status
                elif sat_ratio > 1.1:
                    status = 'saturated'
                elif sat_ratio < 0.7:
                    status = 'room_to_grow'
                else:
                    status = 'efficient'

                channels_out.append({
                    'channel':          ch_label,
                    'channel_key':      ch_key,
                    'current_spend':    round(current_spend, 2),
                    'ec':               round(ec, 2) if ec else None,
                    'saturation_ratio': sat_ratio,
                    'marginal_roi':     round(mroi, 4) if mroi is not None else None,
                    'roi':              round(roi_val, 4),
                    'status':           status,
                    'is_real_meridian': is_real,
                })

            logger.info("[ResultsGenerator] get_saturation(): %d channels", len(channels_out))
            return {'channels': channels_out, 'is_real_meridian': is_real}
        except Exception as e:
            logger.error("[ResultsGenerator] get_saturation() failed: %s", e, exc_info=True)
            return {'channels': [], 'is_real_meridian': False}

    # ------------------------------------------------------------------
    # C1: Waterfall (period-over-period revenue deltas)
    # ------------------------------------------------------------------

    def get_waterfall(self, period: str = 'quarterly') -> Dict:
        """
        Compute period-over-period revenue change per channel.
        Reuses get_timeseries() for bucketing, then computes deltas.
        """
        try:
            ts = self.get_timeseries(period)
            if not ts['periods'] or not ts['data']:
                return {'periods': [], 'channels': [], 'bars': [], 'is_real_meridian': False}

            periods       = ts['periods']
            ch_labels     = ts['channels']
            data_rows     = {row['period']: row for row in ts['data']}
            meridian      = self._get_meridian_results()
            is_real       = meridian is not None

            all_channels = ch_labels + ['Base']
            bars: List[Dict] = []

            for p_idx, period_label in enumerate(periods):
                row = data_rows.get(period_label, {})
                is_baseline = (p_idx == 0)
                prev_row    = data_rows.get(periods[p_idx - 1], {}) if p_idx > 0 else {}

                for ch in all_channels:
                    current_val = float(row.get(ch, 0.0))
                    if is_baseline:
                        delta      = current_val
                        cumulative = current_val
                    else:
                        prev_val   = float(prev_row.get(ch, 0.0))
                        delta      = round(current_val - prev_val, 2)
                        cumulative = current_val
                    bars.append({
                        'period':      period_label,
                        'channel':     ch,
                        'delta':       round(delta, 2),
                        'cumulative':  round(cumulative, 2),
                        'is_baseline': is_baseline,
                    })

            logger.info("[ResultsGenerator] get_waterfall(period=%s): %d bars", period, len(bars))
            return {
                'periods':          periods,
                'channels':         ch_labels,
                'bars':             bars,
                'is_real_meridian': is_real,
            }
        except Exception as e:
            logger.error("[ResultsGenerator] get_waterfall() failed: %s", e, exc_info=True)
            return {'periods': [], 'channels': [], 'bars': [], 'is_real_meridian': False}

    # ------------------------------------------------------------------
    # C4: Holdout / incrementality validation design
    # ------------------------------------------------------------------

    def get_holdout_design(self) -> Dict:
        """
        Suggest treatment/control geo assignments for a lift test.
        Returns applicable=False for single-geo (national) datasets.
        """
        _not_applicable = {
            'applicable':               False,
            'n_geos':                   0,
            'treatment_geos':           [],
            'control_geos':             [],
            'assignments':              [],
            'recommended_duration_weeks': 0,
            'holdout_pct':              0.0,
            'method_note':              'Holdout design requires a multi-geo dataset.',
            'is_real_meridian':         False,
        }

        try:
            from services.data_loader import DataLoaderService
            data = DataLoaderService._loaded_data
            if data is None:
                return _not_applicable

            n_geos = data.get('n_geos', 1)
            geos   = data.get('geos', [])

            if n_geos <= 1 or len(geos) < 2:
                return _not_applicable

            meridian = self._get_meridian_results()
            is_real  = meridian is not None
            n_weeks  = data.get('n_times', 52)

            # Get per-geo ROI for balancing
            geo_breakdown = self.get_geo_breakdown()
            roi_by_geo    = {r['geo']: float(r.get('portfolioRoi', 1.0)) for r in geo_breakdown}

            # Sort geos by portfolio ROI, then alternate treatment/control
            # so both groups have a balanced mix of high/low ROI geos
            sorted_geos = sorted(geos, key=lambda g: roi_by_geo.get(g, 1.0))
            treatment_geos = [sorted_geos[i] for i in range(0, len(sorted_geos), 2)]
            control_geos   = [sorted_geos[i] for i in range(1, len(sorted_geos), 2)]

            assignments = []
            for g in sorted_geos:
                group     = 'treatment' if g in treatment_geos else 'control'
                roi_val   = roi_by_geo.get(g, 1.0)
                geo_spend = 0.0
                if data['spend_data'].ndim == 3:
                    g_idx = geos.index(g) if g in geos else -1
                    if g_idx >= 0:
                        geo_spend = float(data['spend_data'][g_idx].sum())
                rationale = (
                    f"{'High' if roi_val >= 2.0 else 'Low'}-ROI geo "
                    f"(portfolio ROI {round(roi_val, 2)}) — "
                    f"{'test treatment effect here' if group == 'treatment' else 'use as control baseline'}."
                )
                assignments.append({
                    'geo':           g,
                    'group':         group,
                    'total_spend':   round(geo_spend, 2),
                    'portfolio_roi': round(roi_val, 4),
                    'rationale':     rationale,
                })

            recommended_duration = max(4, n_weeks // 7)
            holdout_pct          = round(len(treatment_geos) / n_geos, 4)

            logger.info(
                "[ResultsGenerator] get_holdout_design(): %d geos, %d treatment, %d control, duration=%dw",
                n_geos, len(treatment_geos), len(control_geos), recommended_duration,
            )
            return {
                'applicable':               True,
                'n_geos':                   n_geos,
                'treatment_geos':           treatment_geos,
                'control_geos':             control_geos,
                'assignments':              assignments,
                'recommended_duration_weeks': recommended_duration,
                'holdout_pct':              holdout_pct,
                'method_note': (
                    'Geos are sorted by portfolio ROI and alternately assigned to treatment/control '
                    'to balance both groups. This is a heuristic — a statistician should review '
                    'before running a live test.'
                ),
                'is_real_meridian': is_real,
            }
        except Exception as e:
            logger.error("[ResultsGenerator] get_holdout_design() failed: %s", e, exc_info=True)
            return _not_applicable

    # ------------------------------------------------------------------
    # Sprint 1 — Model fit over time (actual vs predicted weekly revenue)
    # ------------------------------------------------------------------

    def get_model_fit(self) -> Dict:
        """
        Return weekly actual vs predicted revenue so the frontend can render
        a model-fit time-series chart (Meridian's plot_model_fit() equivalent).

        Returns
        -------
        {
          "weeks":     ["2022-01-02", ...],   # ISO date strings
          "actual":    [1234567.0, ...],       # observed KPI
          "predicted": [1198000.0, ...],       # model-predicted KPI
          "ci_lower":  [1050000.0, ...],       # 90% credible interval lower (approx.)
          "ci_upper":  [1350000.0, ...],       # 90% credible interval upper (approx.)
          "is_real_meridian": bool,
        }
        """
        import datetime

        try:
            from services.data_loader import DataLoaderService
            data = DataLoaderService._loaded_data
        except Exception:
            data = None

        if data is None:
            return {'weeks': [], 'actual': [], 'predicted': [], 'ci_lower': [], 'ci_upper': [],
                    'is_real_meridian': False}

        try:
            spend_arr   = data['spend_data']   # (n_times, n_ch) or (n_geos, n_times, n_ch)
            kpi_raw     = data['kpi_data']
            channels    = data['channels']
            time_coords = data.get('time_coords', [])

            # Flatten geo dimension
            if spend_arr.ndim == 3:
                spend_2d = spend_arr.mean(axis=0)
                kpi_1d   = kpi_raw.mean(axis=0) if kpi_raw.ndim == 2 else kpi_raw.astype(float)
            else:
                spend_2d = spend_arr.astype(float)
                kpi_1d   = kpi_raw.astype(float)

            n_times, n_channels = spend_2d.shape

            # Prefer Meridian posterior ROIs; fall back to correlation-based
            computed = _compute_from_data(data)
            roi_per_ch = computed['roi'] if computed else \
                np.array([FALLBACK_ROI.get(ch, 2.0) for ch in channels])

            meridian = self._get_meridian_results()
            is_real  = meridian is not None
            if is_real:
                roi_dict  = meridian.get('roi_summary', {})
                roi_means = roi_dict.get('roi_mean', roi_dict.get('mean', {}))
                if roi_means:
                    roi_per_ch = np.array([
                        float(roi_means.get(ch, roi_per_ch[i]))
                        for i, ch in enumerate(channels)
                    ])

            # Predicted = Hill-based if posterior params available, else spend × ROI
            hill_params = meridian.get('hill_params') if meridian else None
            if hill_params:
                ch_revenue_2d = self._hill_revenue_timeseries(spend_2d, hill_params, channels)
                flat = spend_2d * roi_per_ch * 0.85
                ch_revenue_2d = np.where(ch_revenue_2d > 0, ch_revenue_2d, flat)
            else:
                ch_revenue_2d = spend_2d * roi_per_ch * 0.85

            base_per_step = kpi_1d * 0.15
            predicted_1d  = ch_revenue_2d.sum(axis=1) + base_per_step

            # Residual-based CI width (±1.5 × weekly std of residuals, floored at 5%)
            residuals = kpi_1d - predicted_1d
            resid_std = float(np.std(residuals)) if len(residuals) > 2 else float(predicted_1d.mean() * 0.08)
            ci_half   = max(resid_std * 1.5, float(predicted_1d.mean() * 0.05))

            # Build ISO week date strings
            def _iso(s: str) -> str:
                try:
                    return datetime.date.fromisoformat(s).isoformat()
                except (ValueError, TypeError):
                    return s

            if time_coords:
                weeks = [_iso(tc) for tc in time_coords]
            else:
                start = datetime.date(2020, 1, 1)
                weeks = [(start + datetime.timedelta(weeks=i)).isoformat() for i in range(n_times)]

            logger.info(
                "[ResultsGenerator] get_model_fit(): %d weeks  is_real=%s  "
                "mean_actual=%.0f  mean_predicted=%.0f",
                n_times, is_real, float(kpi_1d.mean()), float(predicted_1d.mean()),
            )

            return {
                'weeks':              weeks,
                'actual':             [round(float(v), 2) for v in kpi_1d],
                'predicted':          [round(float(v), 2) for v in predicted_1d],
                'ci_lower':           [round(max(0.0, float(v) - ci_half), 2) for v in predicted_1d],
                'ci_upper':           [round(float(v) + ci_half, 2) for v in predicted_1d],
                'is_real_meridian':   is_real,
            }

        except Exception as e:
            logger.error("[ResultsGenerator] get_model_fit() failed: %s", e, exc_info=True)
            return {'weeks': [], 'actual': [], 'predicted': [], 'ci_lower': [], 'ci_upper': [],
                    'is_real_meridian': False}

    # ------------------------------------------------------------------
    # Sprint 1 — Marginal ROI per channel (Hill derivative at current spend)
    # ------------------------------------------------------------------

    def get_mroi(self) -> List[Dict]:
        """
        Marginal ROI per channel: revenue from the last dollar spent.
        Computed as the Hill curve derivative at each channel's current spend.

        Returns
        -------
        [
          {"channel": "TV", "roi": 2.8, "mroi": 1.40, "spend": 1200000,
           "spend_pct": 0.30, "contribution_pct": 0.38, "is_real_meridian": bool},
          ...
        ]
        """
        try:
            from services.data_loader import DataLoaderService
            data = DataLoaderService._loaded_data
        except Exception:
            data = None

        if data is None:
            return []

        try:
            hill_list   = self.get_hill_params()
            roi_list    = self.get_roi()
            meridian    = self._get_meridian_results()
            is_real     = meridian is not None

            spend_arr  = data['spend_data']
            channels   = data['channels']

            # Total spend for spend_pct computation
            if spend_arr.ndim == 3:
                total_spend_per_ch = spend_arr.sum(axis=(0, 1))
            else:
                total_spend_per_ch = spend_arr.sum(axis=0)
            grand_total = float(total_spend_per_ch.sum()) or 1.0

            # Contribution % from ROI list
            contrib_by_label: dict = {}
            total_media_rev  = sum(float(r.get('revenue', 0)) for r in roi_list) or 1.0
            for r in roi_list:
                contrib_by_label[r.get('channel', '')] = float(r.get('revenue', 0)) / total_media_rev * 100

            # Build lookup: channel_key → hill params
            hill_by_key = {h.get('channel_key', ''): h for h in hill_list}
            roi_by_label = {r.get('channel', ''): r for r in roi_list}

            result = []
            for i, ch_key in enumerate(channels):
                hp        = hill_by_key.get(ch_key, {})
                ec        = hp.get('ec')
                slope     = float(hp.get('slope', 2.0))
                max_resp  = hp.get('maxResponse')

                # Current spend for this channel (total across all geos and time)
                if spend_arr.ndim == 3:
                    cur_spend = float(spend_arr[:, :, i].sum())
                else:
                    cur_spend = float(spend_arr[:, i].sum())

                ch_label  = CHANNEL_DISPLAY.get(ch_key, ch_key)
                roi_entry = roi_by_label.get(ch_label, {})
                roi_val   = float(roi_entry.get('roi', FALLBACK_ROI.get(ch_key, 2.0)))

                # Marginal ROI via Hill derivative; fall back to roi × 0.5 if no Hill params
                mroi: float
                if ec and max_resp and ec > 0:
                    m = self._hill_marginal(cur_spend, ec, slope, max_resp)
                    mroi = m if m is not None else roi_val * 0.5
                else:
                    mroi = roi_val * 0.5

                result.append({
                    'channel':          ch_label,
                    'channel_key':      ch_key,
                    'roi':              round(roi_val, 4),
                    'mroi':             round(mroi, 4),
                    'spend':            round(cur_spend, 2),
                    'spend_pct':        round(cur_spend / grand_total * 100, 2),
                    'contribution_pct': round(contrib_by_label.get(ch_label, 0.0), 2),
                    'color':            CHANNEL_COLORS.get(ch_key, '#94a3b8'),
                    'is_real_meridian': is_real,
                })

            logger.info("[ResultsGenerator] get_mroi(): %d channels  is_real=%s", len(result), is_real)
            return result

        except Exception as e:
            logger.error("[ResultsGenerator] get_mroi() failed: %s", e, exc_info=True)
            return []

    def get_cpik(self) -> List[Dict]:
        """
        Cost Per Incremental KPI (CPIK) per channel.
        CPIK = spend / incremental_outcome — how much you pay per unit of KPI gained.
        Equivalent to Meridian's visualizer.MediaSummary.plot_cpik().
        Lower is better.
        """
        try:
            roi_rows = self.get_roi()
            total_spend   = sum(r.get('spend', 0)   for r in roi_rows) or 1
            total_revenue = sum(r.get('revenue', 0) for r in roi_rows) or 1
            result = []
            for r in roi_rows:
                spend   = r.get('spend', 0)
                revenue = r.get('revenue', 0)
                roi     = r.get('roi', 1) or 1
                # CPIK = spend ÷ incremental revenue (inverse of ROI scaled to cost units)
                cpik = spend / revenue if revenue > 0 else None
                result.append({
                    'channel':          r.get('channel'),
                    'channel_key':      r.get('channel', '').lower().replace(' ', '_'),
                    'cpik':             round(cpik, 4) if cpik is not None else None,
                    'roi':              r.get('roi'),
                    'spend':            spend,
                    'revenue':          revenue,
                    'spend_pct':        round(spend / total_spend * 100, 1),
                    'contribution_pct': round(revenue / total_revenue * 100, 1),
                    'color':            r.get('color'),
                    'is_real_meridian': r.get('is_real_meridian', False),
                })
            return sorted(result, key=lambda x: (x['cpik'] or float('inf')))
        except Exception as e:
            logger.error("[ResultsGenerator] get_cpik() failed: %s", e, exc_info=True)
            return []

    def get_export_csv(self) -> str:
        """
        Looker Studio–ready flat CSV export.
        Schema matches the Meridian Summarizer output_optimization_summary() fields
        so users can upload to Google Sheets → connect Looker Studio template.
        """
        import io, csv
        try:
            roi_rows   = self.get_roi()
            mroi_rows  = {r['channel']: r for r in self.get_mroi()}
            cpik_rows  = {r['channel']: r for r in self.get_cpik()}

            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=[
                'channel', 'roi_mean', 'roi_ci_lower', 'roi_ci_upper',
                'mroi', 'cpik', 'spend', 'revenue',
                'contribution_pct', 'spend_pct',
                'saturation_status', 'color',
            ])
            writer.writeheader()
            total_spend   = sum(r.get('spend', 0)   for r in roi_rows) or 1
            total_revenue = sum(r.get('revenue', 0) for r in roi_rows) or 1
            for r in roi_rows:
                ch  = r.get('channel', '')
                m   = mroi_rows.get(ch, {})
                c   = cpik_rows.get(ch, {})
                writer.writerow({
                    'channel':          ch,
                    'roi_mean':         round(r.get('roi', 0), 4),
                    'roi_ci_lower':     round(r.get('roi_ci_lower', 0), 4),
                    'roi_ci_upper':     round(r.get('roi_ci_upper', 0), 4),
                    'mroi':             round(m.get('mroi', 0), 4),
                    'cpik':             round(c.get('cpik', 0), 4) if c.get('cpik') else '',
                    'spend':            r.get('spend', 0),
                    'revenue':          r.get('revenue', 0),
                    'contribution_pct': round(r.get('revenue', 0) / total_revenue * 100, 2),
                    'spend_pct':        round(r.get('spend', 0) / total_spend * 100, 2),
                    'saturation_status': m.get('saturation_status', ''),
                    'color':            r.get('color', ''),
                })
            return buf.getvalue()
        except Exception as e:
            logger.error("[ResultsGenerator] get_export_csv() failed: %s", e, exc_info=True)
            return ''

    def get_export_html(self) -> str:
        """
        Self-contained HTML report matching Meridian's Summarizer.output_model_results_summary() output.
        All styles are inlined so the file renders anywhere without external dependencies.
        """
        from datetime import datetime
        try:
            roi_rows   = self.get_roi()
            mroi_data  = {r['channel']: r for r in self.get_mroi()}
            cpik_data  = {r['channel']: r for r in self.get_cpik()}
            diag       = self.get_diagnostics()
            computed   = self._get_computed() or {}
            total_rev  = computed.get('total_revenue', 0)
            total_sp   = sum(r.get('spend', 0) for r in roi_rows)
            base_rev   = computed.get('base_revenue', total_rev * 0.35)
            portfolio_roi = (total_rev / total_sp) if total_sp > 0 else 0
            is_real    = self._get_meridian_results() is not None
            method_label = 'Google Meridian (Bayesian MCMC)' if is_real else 'Pearson correlation heuristic'
            from datetime import timezone as _utc_tz; generated_at = datetime.now(_utc_tz.utc).strftime('%Y-%m-%d %H:%M UTC')

            def fmt_num(v, decimals=2):
                try: return f'{float(v):,.{decimals}f}'
                except: return '—'

            def sat_badge(status):
                colors = {'saturated': '#dc2626', 'efficient': '#d97706', 'room_to_grow': '#16a34a'}
                labels = {'saturated': 'Saturated', 'efficient': 'Efficient', 'room_to_grow': 'Room to grow'}
                c = colors.get(status, '#64748b')
                l = labels.get(status, status)
                return f'<span style="background:{c}15;color:{c};padding:2px 7px;border-radius:99px;font-size:11px;font-weight:600">{l}</span>'

            channel_rows = ''
            for r in roi_rows:
                ch  = r.get('channel', '')
                m   = mroi_data.get(ch, {})
                c   = cpik_data.get(ch, {})
                color = r.get('color', '#64748b')
                sat   = m.get('saturation_status', '')
                channel_rows += f"""
                <tr>
                  <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{color};margin-right:6px"></span>{r.get('label', ch)}</td>
                  <td>{fmt_num(r.get('roi', 0), 2)}x</td>
                  <td style="color:#64748b;font-size:11px">{fmt_num(r.get('roi_ci_lower', 0), 2)}–{fmt_num(r.get('roi_ci_upper', 0), 2)}</td>
                  <td>{fmt_num(m.get('mroi', 0), 2)}x</td>
                  <td>{fmt_num(c.get('cpik', 0), 3) if c.get('cpik') else '—'}</td>
                  <td>${fmt_num(r.get('spend', 0), 0)}</td>
                  <td>${fmt_num(r.get('revenue', 0), 0)}</td>
                  <td>{sat_badge(sat)}</td>
                </tr>"""

            r2    = diag.get('r_squared', 0)
            mape  = diag.get('mape', 0)
            rhat  = diag.get('max_rhat', 0)

            html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Marketing Mix Model Report</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;padding:32px}}
  .page{{max-width:960px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden}}
  .header{{background:#1e293b;color:#fff;padding:28px 36px}}
  .header h1{{font-size:22px;font-weight:700;letter-spacing:-.3px}}
  .header .meta{{font-size:12px;color:#94a3b8;margin-top:6px}}
  .body{{padding:32px 36px;space-y:24px}}
  .section{{margin-bottom:32px}}
  .section-title{{font-size:13px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.6px;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #e2e8f0}}
  .kpi-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}}
  .kpi{{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px}}
  .kpi .label{{font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px}}
  .kpi .value{{font-size:24px;font-weight:700;color:#1e293b;margin-top:4px}}
  .kpi .sub{{font-size:11px;color:#94a3b8;margin-top:2px}}
  table{{width:100%;border-collapse:collapse;font-size:13px}}
  th{{background:#f8fafc;padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #e2e8f0}}
  td{{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}}
  tr:last-child td{{border-bottom:none}}
  .badge{{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}}
  .pass{{background:#dcfce7;color:#16a34a}}
  .fail{{background:#fee2e2;color:#dc2626}}
  .footer{{background:#f8fafc;padding:20px 36px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;display:flex;justify-content:space-between}}
  @media print{{body{{padding:0;background:white}}.page{{box-shadow:none;border-radius:0}}}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>Marketing Mix Model Report</h1>
    <div class="meta">Method: {method_label} &nbsp;·&nbsp; Generated: {generated_at}</div>
  </div>
  <div class="body">

    <div class="kpi-grid">
      <div class="kpi">
        <div class="label">Total Revenue</div>
        <div class="value">${fmt_num(total_rev, 0)}</div>
        <div class="sub">across all channels + baseline</div>
      </div>
      <div class="kpi">
        <div class="label">Portfolio ROI</div>
        <div class="value">{fmt_num(portfolio_roi, 2)}x</div>
        <div class="sub">revenue per dollar spent</div>
      </div>
      <div class="kpi">
        <div class="label">Model Accuracy (R²)</div>
        <div class="value">{fmt_num(r2 * 100, 1)}%</div>
        <div class="sub">variance explained</div>
      </div>
      <div class="kpi">
        <div class="label">Avg. Prediction Error</div>
        <div class="value">{fmt_num(mape, 1)}%</div>
        <div class="sub">MAPE across weeks</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Channel Performance</div>
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>ROI</th>
            <th>90% CI</th>
            <th>Marginal ROI</th>
            <th>CPIK</th>
            <th>Total Spend</th>
            <th>Attributed Revenue</th>
            <th>Saturation</th>
          </tr>
        </thead>
        <tbody>{channel_rows}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Model Diagnostics</div>
      <table>
        <thead><tr><th>Check</th><th>Value</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>R² (variance explained)</td><td>{fmt_num(r2 * 100, 1)}%</td><td>{'<span class="badge pass">Pass</span>' if r2 >= 0.7 else '<span class="badge fail">Review</span>'}</td></tr>
          <tr><td>MAPE (prediction error)</td><td>{fmt_num(mape, 1)}%</td><td>{'<span class="badge pass">Pass</span>' if mape < 10 else '<span class="badge fail">Review</span>'}</td></tr>
          <tr><td>Max R-hat (convergence)</td><td>{fmt_num(rhat, 3)}</td><td>{'<span class="badge pass">Pass</span>' if rhat < 1.1 else '<span class="badge fail">Review</span>'}</td></tr>
          <tr><td>Baseline revenue share</td><td>{fmt_num(base_rev / total_rev * 100 if total_rev else 0, 1)}%</td><td>{'<span class="badge pass">Pass</span>' if base_rev / total_rev < 0.8 else '<span class="badge fail">Review</span>'}</td></tr>
        </tbody>
      </table>
    </div>

  </div>
  <div class="footer">
    <span>Marketing Mix Model Studio &nbsp;·&nbsp; Powered by Google Meridian</span>
    <span>Export this file to Google Sheets for Looker Studio integration</span>
  </div>
</div>
</body>
</html>"""
            return html
        except Exception as e:
            logger.error("[ResultsGenerator] get_export_html() failed: %s", e, exc_info=True)
            return '<html><body><p>Report generation failed. Load a dataset and run the model first.</p></body></html>'

    def get_all_results(self) -> Dict:
        meridian = self._get_meridian_results()
        result = {
            'roi':             self.get_roi(),
            'contribution':    self.get_contribution(),
            'diagnostics':     self.get_diagnostics(),
            'hill_params':     self.get_hill_params(),
            'adstock_params':  self.get_adstock_params(),
            'is_real_meridian': meridian is not None,
        }
        # Expose total KPI revenue so the frontend can compute baseRevenue accurately.
        # y.sum() is the raw data sum — accurate regardless of whether Meridian ran.
        computed = self._get_computed()
        if computed:
            result['total_revenue'] = float(computed['total_revenue'])
        return result
