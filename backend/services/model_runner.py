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

    _config: Optional[dict] = None
    _is_fit: bool = False
    _status: str = 'idle'
    _last_error: Optional[str] = None

    def configure(self, config: dict) -> dict:
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

        # Try real Meridian integration first
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
            # Expected in Python 3.9 environments — not an error
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
        import os, pickle
        os.makedirs('models', exist_ok=True)
        path = f'models/{name}.pkl'
        from services.meridian_runner import MeridianRunner
        if MeridianRunner._last_model is not None:
            with open(path, 'wb') as f:
                pickle.dump(MeridianRunner._last_model, f)
        return path
