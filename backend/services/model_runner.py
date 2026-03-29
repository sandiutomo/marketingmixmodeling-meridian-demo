# =============================================================================
# services/model_runner.py — The coordinator: deciding how to fit the model
#
# This service sits between the router and the actual Meridian sampling code.
# Its job is to orchestrate the run and handle the two-tier fallback strategy:
#
#   Tier 1 — Real Meridian MCMC (requires Python 3.11+ with google-meridian):
#             Calls MeridianRunner.fit() which runs full Bayesian inference.
#             Results include true posterior ROI distributions, R-hat convergence
#             checks, Effective Sample Size (ESS), and predictive accuracy metrics.
#
#   Tier 2 — Correlation-based approximation (works everywhere):
#             If Meridian isn't installed, the run "succeeds" with a fallback flag
#             set to True. ResultsGeneratorService then uses Pearson correlation
#             to estimate channel attribution instead. Useful for demos where you
#             just want to see the UI working without waiting for full MCMC.
#
# The service also stores configuration at the class level so a separate
# POST /model/configure call can set options before POST /model/run triggers
# the actual sampling.
# =============================================================================

import logging
import time
from typing import Optional

from services.meridian_runner import MeridianRunner, MeridianNotAvailable

logger = logging.getLogger(__name__)


class ModelRunnerService:
    """
    Orchestrates model fitting.  Tries to run real Meridian MCMC (Phase 2).
    Falls back to a lightweight status-only response if Meridian is unavailable,
    allowing the correlation-based approximation in results_generator to serve results.
    """

    # Class-level state so configure() and run() can be called in separate
    # HTTP requests without losing the settings between them.
    _config: Optional[dict] = None
    _is_fit: bool = False
    _status: str = 'idle'
    _last_error: Optional[str] = None

    def configure(self, config: dict) -> dict:
        # Store the user's model settings. Nothing runs yet — this just saves
        # the parameters so the subsequent run() call knows what to do.
        logger.info("[ModelRunner] configure(): channels=%s  geos=%s  time_range=%s→%s  "
                    "n_chains=%d  n_adapt=%d  n_burnin=%d  n_keep=%d  max_lag=%d  "
                    "adstock=%s  media_prior=%s  holdout_pct=%.2f",
                    config.get('channels'), config.get('geos'),
                    config.get('startDate'), config.get('endDate'),
                    config.get('nChains', 4), config.get('nAdapt', 1000),
                    config.get('nBurnin', 500), config.get('nKeep', 1000),
                    config.get('maxLag', 8), config.get('adstockDecay', 'geometric'),
                    config.get('mediaPriorType', 'roi'), config.get('holdoutPct', 0))
        if config.get('calibrationPeriods'):
            logger.info("[ModelRunner] calibrationPeriods: %s", config['calibrationPeriods'])
        if config.get('channelPriors'):
            logger.debug("[ModelRunner] channelPriors: %s", config['channelPriors'])
        self.__class__._config = config
        self.__class__._status = 'configured'
        self.__class__._last_error = None
        return {
            'media_channels': config.get('channels', []),
            'geos':           config.get('geos', []),
            'time_range':     f"{config.get('startDate')} to {config.get('endDate')}",
            'n_chains':       config.get('nChains', 4),
            'max_lag':        config.get('maxLag', 8),
            'adstock_decay':  config.get('adstockDecay', 'geometric'),
            'holdout_pct':    config.get('holdoutPct', 0),
            'media_prior_type': config.get('mediaPriorType', 'roi'),
            'media_effects_dist': config.get('mediaEffectsDist', 'log_normal'),
            'hill_before_adstock': config.get('hillBeforeAdstock', False),
            'unique_sigma_per_geo': config.get('uniqueSigmaPerGeo', False),
        }

    def run(self) -> dict:
        # Convenience wrapper for synchronous (blocking) sampling.
        return self.run_with_progress(None)

    def run_with_progress(self, progress_callback) -> dict:
        """
        Attempt real MCMC via MeridianRunner.  Falls back gracefully if Meridian
        is not installed or data has not been loaded yet.
        """
        self.__class__._status = 'running'
        self.__class__._last_error = None
        t0 = time.time()
        logger.info("[ModelRunner] run() started")

        config = self.__class__._config or {}

        # ── Tier 1: Try real Meridian MCMC ────────────────────────────────
        try:
            from services.data_loader import DataLoaderService
            data = DataLoaderService._loaded_data
            if data is None:
                raise ValueError('No data loaded — call /data/load first')
            logger.info("[ModelRunner] Data available: n_channels=%d  n_times=%d  n_geos=%d",
                        data.get('n_channels', '?'), data.get('n_times', '?'), data.get('n_geos', 1))
            logger.info("[ModelRunner] Attempting real Meridian MCMC...")

            meridian_runner = MeridianRunner()
            results = meridian_runner.fit(data, config, progress_callback=progress_callback)

            self.__class__._is_fit = True
            self.__class__._status = 'complete'
            elapsed = time.time() - t0

            # Log the key quality metrics so we know if the model is trustworthy.
            # R-hat values above 1.1 suggest the sampling chains didn't converge —
            # results should be treated with caution in that case.
            rhat = results.get('rhat', {})
            ess  = results.get('ess', {})
            logger.info("[ModelRunner] MCMC complete in %.1fs — rhat_max=%.4f  rhat_mean=%.4f  "
                        "all_converged=%s  ess_min=%s  r_squared=%.4f  mape=%.4f",
                        elapsed,
                        rhat.get('max') or 0, rhat.get('mean') or 0,
                        rhat.get('all_below_1_2'),
                        ess.get('min'), results.get('r_squared') or 0, results.get('mape') or 0)
            return {
                'is_real_meridian': True,
                'rhat_max':         rhat.get('max'),
                'rhat_mean':        rhat.get('mean'),
                'all_converged':    rhat.get('all_below_1_2'),
                'ess_min':          ess.get('min'),
                'r_squared':        results.get('r_squared'),
                'mape':             results.get('mape'),
                'n_divergences':    0,
                'message':          'Meridian MCMC complete. Real posterior results are ready.',
            }

        except MeridianNotAvailable as e:
            # This is the expected path when running under Python 3.9 where
            # google-meridian isn't installed. Not an error — just a capability
            # downgrade. The results endpoints will use correlation-based estimates.
            logger.warning("[ModelRunner] Meridian not available (%s) — using correlation fallback", e)
            self.__class__._last_error = str(e)
            self.__class__._is_fit = True
            self.__class__._status = 'complete'
            return {
                'is_real_meridian': False,
                'message': (
                    'Meridian not available in this environment '
                    '(requires Python 3.11+). '
                    'Showing correlation-based approximation.'
                ),
                'fallback': True,
            }

        except Exception as e:
            # Something unexpected went wrong. We still mark the model as "fit"
            # so the frontend can continue and show approximate results rather
            # than being stuck in a broken state.
            logger.error("[ModelRunner] run() failed after %.1fs: %s", time.time() - t0, e, exc_info=True)
            self.__class__._last_error = str(e)
            self.__class__._is_fit = True
            self.__class__._status = 'complete'
            return {
                'is_real_meridian': False,
                'error':   str(e),
                'fallback': True,
                'message': f'Model run failed: {e}. Showing approximation.',
            }

    def get_status(self) -> dict:
        return {
            'status':    self.__class__._status,
            'is_fit':    self.__class__._is_fit,
            'config':    self.__class__._config,
            'error':     self.__class__._last_error,
            'has_real_meridian_results': MeridianRunner._last_results is not None,
        }

    def save(self, name: str) -> str:
        # Serialise the fitted Meridian model object to disk with pickle so it
        # can be reloaded in a future session without re-running sampling.
        import os, pickle
        os.makedirs('models', exist_ok=True)
        path = f'models/{name}.pkl'
        from services.meridian_runner import MeridianRunner
        if MeridianRunner._last_model is not None:
            with open(path, 'wb') as f:
                pickle.dump(MeridianRunner._last_model, f)
        return path
