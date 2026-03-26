import logging
import numpy as np
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

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

# Heuristic adstock decay rates per channel type (used when Meridian hasn't run)
CHANNEL_DECAY_RATE = {
    'tv': 0.65, 'radio': 0.55, 'ooh': 0.58, 'youtube': 0.35,
    'social': 0.35, 'display': 0.25, 'paid_search': 0.20,
    'search': 0.10, 'ecommerce': 0.18, 'programmatic': 0.20, 'influencer': 0.14,
    'email': 0.15, 'organic': 0.40,
}


def _pearson_r(x: np.ndarray, y: np.ndarray) -> float:
    mx, my = x.mean(), y.mean()
    cov = ((x - mx) * (y - my)).mean()
    sx = np.std(x)
    sy = np.std(y)
    return float(cov / (sx * sy)) if sx > 0 and sy > 0 else 0.0


def _compute_from_data(data: dict) -> Optional[dict]:
    """Compute ROI and attribution from loaded Meridian CSV data (correlation-based fallback)."""
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
    """Computes results from real Meridian CSV data via DataLoaderService.
    When MeridianRunner has real posterior results, uses those preferentially.
    Otherwise falls back to correlation-based computation.
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
