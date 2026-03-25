"""
Real Meridian integration layer — verified against google-meridian 1.5.3 / Python 3.13.

Correct API (discovered by inspection of installed package):

  InputData construction:
    builder = NDArrayInputDataBuilder(kpi_type='revenue')
    builder.time_coords = [list of date strings]   # must be set first
    builder.geos = [list of geo strings]            # omit for national (auto-set)
    builder.with_population(np.ones(n_geos))        # required
    builder.with_kpi(kpi_nd)                        # (n_geos, n_times)
    builder.with_media(m_nd, ms_nd, media_channels) # m_nd: (n_geos, n_times, n_ch)
    builder.with_reach(r_nd, f_nd, rfs_nd, rf_chs)  # reach/freq/rf_spend
    builder.with_controls(ctrl_nd, ctrl_names)
    input_data = builder.build()

  Model:
    model = Meridian(input_data=..., model_spec=...)          # NOT data=, spec=
    model.sample_posterior(n_chains, n_adapt, n_burnin, n_keep, seed)  # NOT .fit()

  Analyzer (meridian.analysis.analyzer.Analyzer, NOT meridian.analysis.Analyzer):
    summary_ds = analyzer.summary_metrics(confidence_level=0.9)
      → xr.Dataset with coords: channel, metric (mean/median/ci_low/ci_high), distribution
      → variables: roi, mroi, incremental_outcome, spend, pct_of_contribution, ...
    rhat_df = analyzer.rhat_summary()
      → DataFrame cols: n_params, avg_rhat, max_rhat, percent_bad_rhat
    acc_ds = analyzer.predictive_accuracy()
      → xr.Dataset with vars: R_Squared, MAPE, wMAPE; coords: metric, geo_granularity, evaluation_set
    hill_df = analyzer.hill_curves(confidence_level=0.9)
      → DataFrame cols: channel, media_units, distribution, ci_hi, ci_lo, mean, channel_type
      → Returns curve VALUES at 25 bins, not ec/slope params — we fit those ourselves
    adstock_df = analyzer.adstock_decay(confidence_level=0.9)
      → DataFrame cols: channel, time_units, distribution, ci_hi, ci_lo, mean
      → mean at time_units=1 is the geometric decay rate
    (No get_ess() method in Meridian 1.5.3)

  BudgetOptimizer:
    from meridian.analysis.optimizer import BudgetOptimizer
    opt = BudgetOptimizer(meridian=model)        # NOT model=
    result = opt.optimize(budget=..., fixed_budget=True,
                          spend_constraint_lower=..., spend_constraint_upper=...)
"""

import logging
import time
import numpy as np
from typing import Callable, Optional

logger = logging.getLogger(__name__)

ProgressCb = Optional[Callable[[float, str], None]]


def _resolve_prior_mu_sigma(
    channel_key: str,
    labels: dict,
    priors: dict,
) -> tuple[float, float]:
    """Match UI prior keys to data channel keys (slug or human label)."""
    default_mu, default_sigma = 0.2, 0.9
    if not priors:
        return default_mu, default_sigma
    label = labels.get(channel_key)
    if not label:
        label = channel_key.replace('_', ' ').title()
    candidates = [channel_key, label, channel_key.title(), label.title()]
    for key in candidates:
        if key and key in priors:
            p = priors[key]
            return float(p.get('mu', default_mu)), float(p.get('sigma', default_sigma))
    lower_map = {str(k).strip().lower().replace(' ', '_'): v for k, v in priors.items()}
    for probe in (channel_key.lower(), label.lower().replace(' ', '_')):
        if probe in lower_map:
            p = lower_map[probe]
            return float(p.get('mu', default_mu)), float(p.get('sigma', default_sigma))
    return default_mu, default_sigma

try:
    from scipy.optimize import curve_fit as _scipy_curve_fit
    _SCIPY_AVAILABLE = True
except ImportError:
    _SCIPY_AVAILABLE = False

try:
    import arviz as az
    from meridian import backend
    from meridian import constants as meridian_constants
    from meridian.data.nd_array_input_data_builder import NDArrayInputDataBuilder
    from meridian.model.model import Meridian
    from meridian.model import spec as model_spec_module
    from meridian.model.prior_distribution import PriorDistribution
    from meridian.analysis.analyzer import Analyzer
    _MERIDIAN_AVAILABLE = True
except Exception:
    az = None  # type: ignore
    backend = None  # type: ignore
    meridian_constants = None  # type: ignore
    PriorDistribution = None  # type: ignore
    _MERIDIAN_AVAILABLE = False


class MeridianNotAvailable(RuntimeError):
    """Raised when google-meridian is not installed in this environment."""


class MeridianRunner:
    """
    Wraps Meridian's NDArrayInputDataBuilder → Meridian.sample_posterior() →
    Analyzer, and extracts all posterior summaries needed by the results layer.
    Results are stored as class-level state so results_generator can retrieve them.
    """

    _last_results: Optional[dict] = None
    _last_model: Optional[object] = None

    def fit(self, data: dict, config: dict, progress_callback: ProgressCb = None) -> dict:
        """
        Run full Meridian MCMC fit and return posterior summaries.

        Parameters
        ----------
        data   : dict from DataLoaderService._loaded_data (not .load())
                 Must contain: kpi_data, spend_data, channels, geos, times,
                 and optionally control_data, control_cols, rf_data, rf_channel_indices.
        config : dict from ModelRunnerService._config
                 Keys: nChains, nAdapt, nBurnin, nKeep, maxLag, adstockDecay,
                       mediaPriorType.
        """
        t0 = time.time()
        logger.info("[MeridianRunner] fit() started — _MERIDIAN_AVAILABLE=%s", _MERIDIAN_AVAILABLE)

        if not _MERIDIAN_AVAILABLE:
            raise MeridianNotAvailable(
                "google-meridian is not installed. "
                "Run: source backend/venv313/bin/activate && pip install google-meridian"
            )

        kpi      = data['kpi_data'].astype(float)
        spend    = data['spend_data'].astype(float)
        ctrl     = data.get('control_data')
        rf_data  = data.get('rf_data')
        channels = data['channels']
        geos     = data.get('geos', ['national'])
        times    = data.get('times', [str(i) for i in range(kpi.shape[-1] if kpi.ndim == 1 else kpi.shape[1])])
        logger.info("[MeridianRunner] Input shapes — kpi=%s  spend=%s  ctrl=%s  rf=%s",
                    kpi.shape, spend.shape,
                    ctrl.shape if ctrl is not None else None,
                    rf_data.shape if rf_data is not None else None)
        logger.info("[MeridianRunner] channels=%s  n_geos=%d  n_times=%d",
                    channels, len(geos), len(times))

        # NDArrayInputDataBuilder expects KPI shape (n_geos, n_times); promote national (T,) → (1, T)
        if kpi.ndim == 1:
            kpi = np.expand_dims(kpi, axis=0)
        if spend.ndim == 2:
            spend = np.expand_dims(spend, axis=0)
        if ctrl is not None:
            ctrl = ctrl.astype(float)
            if ctrl.ndim == 2:
                ctrl = np.expand_dims(ctrl, axis=0)
        if rf_data is not None and rf_data.ndim == 3:
            rf_data = np.expand_dims(rf_data, axis=0)

        has_geo = kpi.ndim == 2
        n_geos  = kpi.shape[0]
        default_nat = (
            meridian_constants.NATIONAL_MODEL_DEFAULT_GEO_NAME
            if meridian_constants
            else 'national_geo'
        )
        if n_geos == 1:
            geo_names = [default_nat]
        elif len(geos) != n_geos:
            geo_names = [f'geo_{i}' for i in range(n_geos)]
        else:
            geo_names = list(geos)

        # Split RF and non-RF channel indices
        rf_indices     = data.get('rf_channel_indices', [])
        non_rf_indices = [i for i in range(len(channels)) if i not in rf_indices]
        media_channels = [channels[i] for i in non_rf_indices]
        rf_ch_names    = [channels[i] for i in rf_indices]
        logger.debug("[MeridianRunner] media_channels=%s  rf_ch_names=%s", media_channels, rf_ch_names)

        # ── Build InputData via NDArrayInputDataBuilder ───────────────────────
        builder = NDArrayInputDataBuilder(kpi_type='revenue')

        # Time and geo coordinates must be set before adding data arrays
        builder.time_coords = list(times)
        builder.media_time_coords = list(times)
        if has_geo:
            builder.geos = list(geo_names)

        # Population is required (use uniform — we have no census data)
        builder.with_population(np.ones(n_geos))

        # KPI — (n_geos, n_times) for geo; (n_times,) for national
        builder.with_kpi(kpi)

        # Paid media (non-RF channels)
        if media_channels:
            if has_geo:
                media_nd = spend[:, :, non_rf_indices]   # (n_geos, n_times, n_media_ch)
            else:
                media_nd = spend[:, non_rf_indices]      # (n_times, n_media_ch)
            builder.with_media(media_nd, media_nd, media_channels)

        # RF channels (reach, frequency, rf_spend)
        if rf_data is not None and rf_ch_names:
            if has_geo:
                reach = rf_data[:, :, 0, :]              # (n_geos, n_times, n_rf)
                freq  = rf_data[:, :, 1, :]
                rfs   = spend[:, :, rf_indices]          # (n_geos, n_times, n_rf) spend
            else:
                reach = rf_data[:, 0, :]                 # (n_times, n_rf)
                freq  = rf_data[:, 1, :]
                rfs   = spend[:, rf_indices]
            builder.with_reach(
                reach.astype(float), freq.astype(float), rfs.astype(float), rf_ch_names
            )

        # Controls
        ctrl_cols = data.get('control_cols', [])
        if ctrl is not None and ctrl_cols:
            builder.with_controls(ctrl.astype(float), list(ctrl_cols))

        input_data = builder.build()
        logger.info("[MeridianRunner] InputData built (%.2fs)", time.time() - t0)
        if progress_callback:
            progress_callback(12.0, 'InputData built — assembling ModelSpec (priors, adstock, holdout)…')

        labels = data.get('channel_labels') or {}
        ch_priors = config.get('channelPriors') or {}

        # ── ModelSpec ─────────────────────────────────────────────────────────
        med_eff = config.get('mediaEffectsDist', 'log_normal')
        if med_eff not in ('log_normal', 'normal'):
            med_eff = 'log_normal'

        spec_kwargs: dict = dict(
            max_lag=int(config.get('maxLag', 8)),
            adstock_decay_spec=config.get('adstockDecay', 'geometric'),
            media_prior_type=config.get('mediaPriorType', 'roi'),
            media_effects_dist=med_eff,
            hill_before_adstock=bool(config.get('hillBeforeAdstock', False)),
            unique_sigma_for_each_geo=bool(config.get('uniqueSigmaPerGeo', False)),
        )
        if config.get('rfPriorType'):
            spec_kwargs['rf_prior_type'] = str(config['rfPriorType'])

        hold_pct = float(config.get('holdoutPct', 0) or 0)
        n_times = len(times)
        if hold_pct > 0 and n_times > 5:
            nh = max(1, int(round(n_times * hold_pct)))
            ho = np.zeros((n_geos, n_times), dtype=bool)
            ho[:, -nh:] = True
            spec_kwargs['holdout_id'] = ho

        # Per-channel ROI priors → vector LogNormal on roi_m / roi_rf
        prior_parts = {}
        if media_channels and PriorDistribution is not None and backend is not None:
            mus, sigs = zip(
                *[_resolve_prior_mu_sigma(c, labels, ch_priors) for c in media_channels]
            )
            prior_parts['roi_m'] = backend.tfd.LogNormal(
                loc=np.array(mus, dtype=np.float32),
                scale=np.array(sigs, dtype=np.float32),
            )
        if rf_ch_names and PriorDistribution is not None and backend is not None:
            mus, sigs = zip(
                *[_resolve_prior_mu_sigma(c, labels, ch_priors) for c in rf_ch_names]
            )
            prior_parts['roi_rf'] = backend.tfd.LogNormal(
                loc=np.array(mus, dtype=np.float32),
                scale=np.array(sigs, dtype=np.float32),
            )
        if prior_parts:
            spec_kwargs['prior'] = PriorDistribution(**prior_parts)

        # Calibration periods — convert date-range dicts to the boolean mask
        # that ModelSpec.roi_calibration_period expects: shape (n_media_times,)
        # True at every time index that falls within any calibration window.
        calibration_periods = config.get('calibrationPeriods') or []
        if calibration_periods and times:
            cal_mask = np.zeros(len(times), dtype=bool)
            for cp in calibration_periods:
                start = str(cp.get('startDate', ''))
                end   = str(cp.get('endDate',   ''))
                if start and end:
                    for i, t in enumerate(times):
                        if start <= str(t) <= end:
                            cal_mask[i] = True
            if cal_mask.any():
                spec_kwargs['roi_calibration_period'] = cal_mask
                logger.info("[MeridianRunner] Calibration mask: %d / %d periods marked",
                            int(cal_mask.sum()), len(times))

        logger.info("[MeridianRunner] ModelSpec: max_lag=%d  adstock=%s  media_prior=%s  "
                    "media_effects_dist=%s  hill_before_adstock=%s  unique_sigma=%s",
                    spec_kwargs.get('max_lag'), spec_kwargs.get('adstock_decay_spec'),
                    spec_kwargs.get('media_prior_type'), spec_kwargs.get('media_effects_dist'),
                    spec_kwargs.get('hill_before_adstock'), spec_kwargs.get('unique_sigma_for_each_geo'))
        if 'holdout_id' in spec_kwargs:
            logger.info("[MeridianRunner] Holdout mask applied: last %d time steps held out",
                        int(spec_kwargs['holdout_id'].sum()))
        spec = model_spec_module.ModelSpec(**spec_kwargs)

        # ── Fit ───────────────────────────────────────────────────────────────
        if progress_callback:
            progress_callback(18.0, 'Constructing Meridian model + NUTS sampler…')
        model = Meridian(input_data=input_data, model_spec=spec)
        logger.info("[MeridianRunner] Meridian model constructed (%.2fs)", time.time() - t0)

        # Meridian 1.5.x Analyzer.summary_metrics() needs prior draws for incremental_outcome_prior
        n_prior_draws = int(config.get('nPriorDraws', 256))
        logger.info("[MeridianRunner] sample_prior: n_draws=%d  seed=%d",
                    n_prior_draws, int(config.get('seed', 42)))
        if progress_callback:
            progress_callback(20.0, f'sample_prior ({n_prior_draws} draws)…')
        model.sample_prior(n_draws=n_prior_draws, seed=int(config.get('seed', 42)))
        logger.info("[MeridianRunner] Prior sampling done (%.2fs)", time.time() - t0)

        n_chains = int(config.get('nChains', 4))
        n_adapt  = int(config.get('nAdapt', 1000))
        n_burnin = int(config.get('nBurnin', 500))
        n_keep   = int(config.get('nKeep', 1000))
        logger.info("[MeridianRunner] sample_posterior: n_chains=%d  n_adapt=%d  n_burnin=%d  n_keep=%d  seed=%d",
                    n_chains, n_adapt, n_burnin, n_keep, int(config.get('seed', 42)))
        if progress_callback:
            progress_callback(22.0, 'sample_posterior: adaptation + burn-in + kept draws (slow step)…')
        model.sample_posterior(
            n_chains=n_chains,
            n_adapt=n_adapt,
            n_burnin=n_burnin,
            n_keep=n_keep,
            seed=int(config.get('seed', 42)),
        )
        logger.info("[MeridianRunner] MCMC posterior sampling done (%.2fs)", time.time() - t0)
        if progress_callback:
            progress_callback(88.0, 'MCMC finished — Analyzer summary_metrics, R-hat, predictive accuracy…')

        analyzer = Analyzer(model)

        logger.info("[MeridianRunner] Analyzer.summary_metrics() (confidence_level=0.90)…")
        # ── ROI + contribution via summary_metrics ────────────────────────────
        summary_ds = analyzer.summary_metrics(confidence_level=0.90)
        ch_coords  = [str(c) for c in summary_ds.channel.values if str(c) != 'All Paid Channels']
        logger.debug("[MeridianRunner] summary_metrics channels: %s", ch_coords)

        def _sel(var, metric, ch):
            return float(summary_ds[var].sel(distribution='posterior', channel=ch, metric=metric))

        roi_means = {ch: _sel('roi', 'mean', ch) for ch in ch_coords}
        roi_summary = {
            'roi_mean':    roi_means,
            'roi_ci_low':  {ch: _sel('roi', 'ci_lo', ch) for ch in ch_coords},
            'roi_ci_high': {ch: _sel('roi', 'ci_hi', ch) for ch in ch_coords},
        }
        for ch, rv in roi_means.items():
            logger.info("[MeridianRunner] ROI  %-20s  mean=%.4f  ci_lo=%.4f  ci_hi=%.4f",
                        ch, rv,
                        roi_summary['roi_ci_low'].get(ch, 0),
                        roi_summary['roi_ci_high'].get(ch, 0))
        contribution = {
            ch: _sel('incremental_outcome', 'mean', ch) for ch in ch_coords
        }
        logger.debug("[MeridianRunner] Contribution: %s",
                     {ch: round(v, 2) for ch, v in contribution.items()})

        # ── R-hat convergence ─────────────────────────────────────────────────
        logger.info("[MeridianRunner] Analyzer.rhat_summary()…")
        rhat_df = analyzer.rhat_summary()
        rhat_max      = float(rhat_df['max_rhat'].max())
        rhat_mean     = float(rhat_df['avg_rhat'].mean())
        all_below_1_2 = bool((rhat_df['max_rhat'] < 1.2).all())
        logger.info("[MeridianRunner] R-hat: max=%.4f  mean=%.4f  all_below_1.2=%s",
                    rhat_max, rhat_mean, all_below_1_2)

        # ── Predictive accuracy ───────────────────────────────────────────────
        logger.info("[MeridianRunner] Analyzer.predictive_accuracy()…")
        acc_ds = analyzer.predictive_accuracy()

        def _get_accuracy(ds, meridian_metric: str) -> float:
            """Meridian 1.5.x predictive_accuracy uses data_var 'value' + coord 'metric'."""
            try:
                da = ds['value'].sel(
                    metric=meridian_metric,
                    geo_granularity='National',
                    evaluation_set='All Data',
                )
                return float(da.values.flatten()[0])
            except Exception:
                try:
                    da = ds['value'].sel(metric=meridian_metric)
                    return float(np.asarray(da.values).flatten()[0])
                except Exception:
                    return float('nan')

        r_squared = _get_accuracy(acc_ds, 'R_Squared')
        mape      = _get_accuracy(acc_ds, 'MAPE')
        logger.info("[MeridianRunner] Predictive accuracy: R²=%.4f  MAPE=%.4f", r_squared, mape)

        # ── ArviZ: ESS & BFMI on inference_data (richer than R-hat-only) ─────
        logger.info("[MeridianRunner] ArviZ ESS + BFMI…")
        ess_min = ess_mean = None
        bfmi_mean = None
        pct_bad_rhat = None
        try:
            if 'percent_bad_rhat' in rhat_df.columns:
                pct_bad_rhat = float(rhat_df['percent_bad_rhat'].mean())
        except Exception:
            pass
        try:
            if az is not None:
                idata = model.inference_data
                if idata is not None and getattr(idata, 'posterior', None) is not None:
                    ess_ds = az.ess(idata, method='mean')
                    mins, means = [], []
                    for v in ess_ds.data_vars.values():
                        arr = np.asarray(v.values).flatten()
                        arr = arr[np.isfinite(arr)]
                        if arr.size:
                            mins.append(float(np.min(arr)))
                            means.append(float(np.mean(arr)))
                    if mins:
                        ess_min = float(min(mins))
                        ess_mean = float(np.mean(means))
                        logger.info("[MeridianRunner] ESS: min=%.1f  mean=%.1f", ess_min, ess_mean)
                    try:
                        bfmi_v = az.bfmi(idata)
                        if bfmi_v is not None:
                            b = np.asarray(bfmi_v).flatten()
                            b = b[np.isfinite(b)]
                            if b.size:
                                bfmi_mean = float(np.mean(b))
                                logger.info("[MeridianRunner] BFMI mean=%.4f  (> 0.3 is healthy)", bfmi_mean)
                    except Exception:
                        pass
        except Exception as e:
            logger.warning("[MeridianRunner] ArviZ ESS/BFMI failed: %s", e)

        # ── Hill saturation parameters ────────────────────────────────────────
        logger.info("[MeridianRunner] Extracting Hill saturation parameters…")
        try:
            hill_df     = analyzer.hill_curves(confidence_level=0.9)
            hill_params = _extract_hill_params(hill_df, summary_ds, ch_coords)
            for p in hill_params:
                logger.debug("[MeridianRunner] Hill  %-20s  ec=%.4f  slope=%.4f  maxResponse=%.4f",
                             p.get('channel'), p.get('ec'), p.get('slope'), p.get('max_response'))
        except Exception as e:
            logger.warning("[MeridianRunner] Hill params extraction failed: %s", e)
            hill_params = []

        # ── Adstock decay parameters ──────────────────────────────────────────
        logger.info("[MeridianRunner] Extracting Adstock decay parameters…")
        try:
            adstock_df     = analyzer.adstock_decay(confidence_level=0.9)
            max_lag        = int(config.get('maxLag', 8))
            adstock_params = _extract_adstock_params(adstock_df, max_lag)
            for p in adstock_params:
                logger.debug("[MeridianRunner] Adstock  %-20s  decay_rate=%.4f  max_lag=%d",
                             p.get('channel'), p.get('decay_rate') or 0, p.get('max_lag', max_lag))
        except Exception as e:
            logger.warning("[MeridianRunner] Adstock params extraction failed: %s", e)
            adstock_params = []

        results = {
            'is_real_meridian':  True,
            'channels':          channels,
            'roi_summary':       roi_summary,
            'contribution':      contribution,
            'rhat': {
                'max':             rhat_max,
                'mean':            rhat_mean,
                'all_below_1_2':   all_below_1_2,
                'pct_bad_rhat':    pct_bad_rhat,
            },
            'ess':        {'min': ess_min, 'mean': ess_mean},
            'bfmi_mean':  bfmi_mean,
            'r_squared':  r_squared,
            'mape':       mape,
            'hill_params':    hill_params,
            'adstock_params': adstock_params,
        }

        MeridianRunner._last_model   = model
        MeridianRunner._last_results = results
        logger.info("[MeridianRunner] fit() complete — total elapsed=%.2fs", time.time() - t0)
        return results


# ── Helper functions ──────────────────────────────────────────────────────────

def _hill_func(x, ec, slope):
    """Normalized Hill function (range 0–1): x^slope / (x^slope + ec^slope)."""
    x = np.maximum(x, 1e-10)
    return x ** slope / (x ** slope + ec ** slope)


def _extract_hill_params(hill_df, summary_ds, ch_coords) -> list:
    """
    Fit Hill ec and slope from the hill_curves() posterior output.
    hill_curves() returns curve VALUES at 25 spend bins, not ec/slope directly.
    We fit a Hill function to those values to recover ec and slope.
    maxResponse is derived from summary_metrics incremental_outcome × 2.5
    (consistent with the correlation-based fallback formula).
    """
    params   = []
    post_df  = hill_df[hill_df['distribution'] == 'posterior']

    for ch in post_df['channel'].unique():
        ch_df = post_df[post_df['channel'] == ch].sort_values('media_units')
        x = ch_df['media_units'].values.astype(float)
        y = ch_df['mean'].values.astype(float)

        if len(x) < 3 or y.max() < 1e-10:
            continue

        # Normalize so Hill function maps to [0, 1]
        y_norm = y / y.max()

        if _SCIPY_AVAILABLE:
            try:
                popt, _ = _scipy_curve_fit(
                    _hill_func, x, y_norm,
                    p0=[float(x.mean()), 2.0],
                    bounds=([0, 0.1], [np.inf, 10.0]),
                    maxfev=2000,
                )
                ec, slope = float(popt[0]), float(popt[1])
            except Exception:
                ec, slope = float(x.mean()), 2.0
        else:
            ec, slope = float(x.mean()), 2.0

        # maxResponse = channel_revenue × 2.5 (same formula as fallback)
        max_response = None
        if ch in ch_coords:
            try:
                ch_rev = float(
                    summary_ds['incremental_outcome'].sel(
                        distribution='posterior', channel=ch, metric='mean'
                    )
                )
                max_response = ch_rev * 2.5
            except Exception:
                pass

        params.append({
            'channel':      ch,
            'ec':           ec,
            'slope':        slope,
            'max_response': max_response,
        })

    return params


def _extract_adstock_params(adstock_df, max_lag: int) -> list:
    """
    Extract per-channel decay rate from adstock_decay() DataFrame.
    mean at time_units=1 is the geometric decay rate (fraction remaining after 1 period).
    """
    params   = []
    post_df  = adstock_df[adstock_df['distribution'] == 'posterior']

    for ch in post_df['channel'].unique():
        ch_df   = post_df[post_df['channel'] == ch].sort_values('time_units')
        lag1    = ch_df[ch_df['time_units'] == 1]
        decay   = float(lag1['mean'].values[0]) if not lag1.empty else None
        params.append({
            'channel':    ch,
            'decay_rate': decay,
            'max_lag':    max_lag,
        })

    return params


def _get_total_spend(data: dict, channels: list, channel: str) -> float:
    idx = channels.index(channel) if channel in channels else -1
    if idx < 0:
        return 1.0
    spend = data['spend_data']
    if spend.ndim == 3:
        return float(spend[:, :, idx].sum())
    return float(spend[:, idx].sum())
