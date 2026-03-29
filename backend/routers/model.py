# =============================================================================
# routers/model.py — Act 2: Teaching the model what drives sales
#
# With data loaded, the next step is to train a statistical model that can
# answer: "Of all the revenue we made, how much was driven by each channel?"
#
# The technique used is Bayesian inference via MCMC sampling (Markov Chain
# Monte Carlo). In plain terms: instead of finding a single "best" answer,
# the model explores thousands of plausible answers and builds a probability
# distribution over them. That distribution is what gives us confidence
# intervals around ROI estimates — not just "TV ROI is 2.8" but "TV ROI is
# between 2.1 and 3.6 with 90% probability."
#
# This router exposes three stages:
#
#   POST /model/configure   — store the user's settings (which channels to
#                             include, how many sampling iterations to run,
#                             any expert priors the user wants to inject, etc.)
#
#   POST /model/run         — run MCMC synchronously. The HTTP request blocks
#                             until sampling finishes (can take minutes).
#
#   POST /model/run/start   — run MCMC in a background thread and return a
#                             job ID immediately. The frontend polls
#                             GET /model/run/status/{job_id} until done.
#
#   GET  /model/status      — quick check: has the model been configured
#                             and/or fitted, and is Meridian available?
#
#   POST /model/save        — snapshot the fitted model to disk so it can
#                             be reloaded later without re-running sampling.
# =============================================================================

import logging
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

from services.model_runner import ModelRunnerService
from services.mcmc_jobs import get_job, start_mcmc_job

logger = logging.getLogger(__name__)

router = APIRouter()
runner = ModelRunnerService()


# ── Request models ─────────────────────────────────────────────────────────────

class CalibrationPeriodRequest(BaseModel):
    # A calibration period is a window in time where we ran a controlled
    # experiment (e.g. a geo holdout test) and measured the true incremental
    # sales lift from a specific channel. Feeding this to the model gives it
    # a real-world anchor so the posterior ROI stays grounded in observed data.
    channel: str
    startDate: str
    endDate: str
    liftPct: float = 0.10
    experimentType: str = "holdout"  # "holdout" | "matched_markets"


class ModelConfigRequest(BaseModel):
    startDate: str
    endDate: str
    geos: List[str]
    channels: List[str]
    # Sampling parameters — these control how long the MCMC process runs:
    #   nChains   — number of independent sampling chains (more = more reliable)
    #   nAdapt    — warm-up phase where the sampler learns the model's shape
    #   nBurnin   — additional warm-up draws that are discarded
    #   nKeep     — the actual draws we keep and analyse
    # More draws take longer but produce tighter confidence intervals.
    nChains: int = 4
    nAdapt: int = 1000
    nBurnin: int = 500
    nKeep: int = 1000
    seed: int = 42
    nPriorDraws: int = 256
    # maxLag controls how many weeks of carryover (adstock) to model.
    # A TV campaign's effect can linger for weeks — maxLag caps how far back
    # we look when attributing this week's sales to past advertising.
    maxLag: int = 8
    adstockDecay: str = "geometric"
    mediaPriorType: str = "roi"
    holdoutPct: float = 0.0
    channelPriors: Optional[Dict[str, Dict[str, float]]] = None
    calibrationPeriods: Optional[List[CalibrationPeriodRequest]] = None
    # Extended ModelSpec options (google-meridian 1.5.3):
    mediaEffectsDist: str = "log_normal"  # log_normal | normal
    hillBeforeAdstock: bool = False        # apply diminishing returns before or after carryover
    uniqueSigmaPerGeo: bool = False        # allow each region to have its own noise level
    rfPriorType: Optional[str] = None


class SaveModelRequest(BaseModel):
    name: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/configure")
def configure_model(req: ModelConfigRequest):
    # Store the configuration without running anything yet.
    # Also generates a copy-pasteable Python snippet showing exactly what
    # Meridian API calls the backend will make — useful for transparency.
    logger.info("[Router/model] POST /model/configure  channels=%s  geos=%s  "
                "n_chains=%d  n_keep=%d",
                req.channels, req.geos, req.nChains, req.nKeep)
    config = runner.configure(req.model_dump())
    return {
        "status": "configured",
        "config": config,
        "generated_code": _generate_config_code(req),
        "message": "Model configured. Start a background job or call POST /model/run for synchronous sampling.",
    }


@router.post("/run")
def run_model():
    # Synchronous sampling — the request won't return until MCMC is done.
    # Fine for quick demos; use /run/start for production to avoid timeouts.
    logger.info("[Router/model] POST /model/run  (synchronous)")
    result = runner.run()
    logger.info("[Router/model] /model/run complete: is_real_meridian=%s",
                result.get('is_real_meridian'))
    return {
        "status": "complete",
        "diagnostics": result,
        "message": "Model sampling complete. Your insights are ready.",
    }


@router.post("/run/start")
def start_run():
    """Queue MCMC in a background thread; poll GET /model/run/status/{job_id}."""
    # Because MCMC can take several minutes, we kick it off in a background
    # thread and return a job ID immediately. The frontend polls the status
    # endpoint to show a progress bar without the HTTP connection timing out.
    logger.info("[Router/model] POST /model/run/start  (background job)")

    def _work(cb):
        return runner.run_with_progress(cb)

    job_id = start_mcmc_job(_work)
    logger.info("[Router/model] Background job started: job_id=%s", job_id)
    return {"job_id": job_id, "message": "Sampling started. Poll /model/run/status/{job_id} until status is complete."}


@router.get("/run/status/{job_id}")
def run_job_status(job_id: str):
    # Returns the current state of a background job: queued → running →
    # analyzing → complete (or error). Includes a 0–100 progress float and
    # the final diagnostics dict once the job finishes.
    job = get_job(job_id)
    if not job:
        return {"status": "unknown", "message": "Job not found", "job_id": job_id}
    out: Dict[str, Any] = {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
    }
    if job.status == "complete" and job.diagnostics:
        out["diagnostics"] = job.diagnostics
    return out


@router.get("/status")
def model_status():
    # Lightweight ping — lets the frontend know whether Meridian is available
    # and whether a fitted model is ready to serve results.
    return runner.get_status()


@router.post("/save")
def save_model(req: SaveModelRequest):
    path = runner.save(req.name)
    return {
        "status": "saved",
        "path": path,
        "message": f"Model snapshot saved as '{req.name}'. You can reload this later without re-running sampling.",
    }


# ── Code generator ─────────────────────────────────────────────────────────────

def _generate_config_code(req: ModelConfigRequest) -> str:
    # This function produces a human-readable Python snippet that mirrors
    # exactly what the backend will do when sampling. It's shown in the UI
    # so users can see (and reproduce) the full Meridian pipeline themselves.
    lines = [
        "# google-meridian 1.5.3 — same pipeline as backend/services/meridian_runner.py",
        "# 1) CSV / DataLoader → kpi, spend, geos, times, optional RF + controls",
        "# 2) NDArrayInputDataBuilder.build() → input_data",
        "# 3) ModelSpec + PriorDistribution (per-channel roi_m LogNormal if configured)",
        "# 4) Meridian.sample_posterior → Analyzer + ArviZ ess/bfmi on inference_data",
        "",
    ]
    if req.calibrationPeriods:
        lines.append("# roi_calibration_period: bool vector, True in experiment weeks")
        for cp in req.calibrationPeriods:
            lines.append(
                f"#   {cp.channel}: {cp.startDate}→{cp.endDate} ({cp.experimentType}, lift {cp.liftPct:.0%})"
            )
        lines.append("")
    if req.holdoutPct and req.holdoutPct > 0:
        lines.append(
            f"# holdout_id: (n_geos, n_times) bool; app masks last {int(req.holdoutPct * 100)}% of time"
        )
        lines.append("")

    code = f"""from meridian import backend
from meridian.data.nd_array_input_data_builder import NDArrayInputDataBuilder
from meridian.model.model import Meridian
from meridian.model import spec as model_spec_module
from meridian.model import prior_distribution
from meridian.analysis.analyzer import Analyzer
import arviz as az
import numpy as np

# --- build priors from UI channelPriors (μ, σ on LogNormal roi_m) ---
channel_priors = {repr(req.channelPriors or {})}
# See meridian_runner._resolve_prior_mu_sigma for how keys match channel labels

builder = NDArrayInputDataBuilder(kpi_type='revenue')
builder.time_coords = time_coords
# builder.geos = geos  # if geo-level
builder.with_population(np.ones(n_geos))
builder.with_kpi(kpi)
builder.with_media(media, media_spend, media_channels)
input_data = builder.build()

custom_prior = None  # set PriorDistribution(roi_m=tfd.LogNormal(loc=mus, scale=sigs)) like meridian_runner

model_spec = model_spec_module.ModelSpec(
    prior=custom_prior or prior_distribution.PriorDistribution(),
    max_lag={req.maxLag},
    adstock_decay_spec="{req.adstockDecay}",
    media_prior_type="{req.mediaPriorType}",
    media_effects_dist="{req.mediaEffectsDist}",
    hill_before_adstock={req.hillBeforeAdstock},
    unique_sigma_for_each_geo={req.uniqueSigmaPerGeo},
)

model = Meridian(input_data=input_data, model_spec=model_spec)
model.sample_posterior(
    n_chains={req.nChains}, n_adapt={req.nAdapt}, n_burnin={req.nBurnin}, n_keep={req.nKeep}, seed={req.seed},
)
analyzer = Analyzer(model)
summary = analyzer.summary_metrics(confidence_level=0.9)
_ = az.ess(model.inference_data, method='mean')  # min ESS — see /results/diagnostics
"""
    return "\n".join(lines) + code
