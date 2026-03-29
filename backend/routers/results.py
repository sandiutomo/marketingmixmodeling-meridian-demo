# =============================================================================
# routers/results.py — Act 3: Reading what the model learned
#
# Once the model has finished sampling, this router lets the frontend fetch
# the insights in structured form. Each endpoint returns a different slice
# of the same underlying analysis, so the UI can build separate charts
# without fetching everything at once.
#
# The endpoints in this file are intentionally thin — they all delegate
# immediately to ResultsGeneratorService, which holds all the logic for
# deciding whether to return real Meridian posterior results or the
# correlation-based approximation that runs when Meridian isn't available.
#
# Summary of what each endpoint returns:
#
#   GET /results            — everything at once (ROI + contribution + diagnostics
#                             + Hill + adstock), useful for the overview page
#   GET /results/roi        — per-channel ROI with 90% credible intervals
#   GET /results/contribution — how much revenue each channel generated
#   GET /results/diagnostics  — model quality metrics (R², MAPE, R-hat, ESS)
#   GET /results/hill_params  — saturation curve parameters per channel
#   GET /results/adstock      — carryover/decay rate parameters per channel
#   GET /results/geo          — per-region ROI breakdown (geo datasets only)
# =============================================================================

import logging
from fastapi import APIRouter
from services.results_generator import ResultsGeneratorService

logger = logging.getLogger(__name__)

router = APIRouter()
generator = ResultsGeneratorService()


@router.get("")
def get_results():
    # Returns the full bundle in one call. The frontend uses this on the
    # main dashboard where all panels load together on first visit.
    logger.info("[Router/results] GET /results  (all results bundle)")
    return generator.get_all_results()


@router.get("/roi")
def get_roi():
    # ROI (Return on Investment) per channel — how many dollars of revenue
    # were generated for every dollar spent. Includes a confidence interval
    # so the chart can show uncertainty bands around each bar.
    logger.debug("[Router/results] GET /results/roi")
    return generator.get_roi()


@router.get("/contribution")
def get_contribution():
    # Revenue attribution — how many total dollars each channel contributed.
    # Also includes "Base (non-media)" — the sales that would have happened
    # even with zero advertising (brand equity, organic demand, etc.).
    logger.debug("[Router/results] GET /results/contribution")
    return generator.get_contribution()


@router.get("/diagnostics")
def get_diagnostics():
    # Model health checks. The key numbers to look at:
    #   R²       — what fraction of revenue variation the model explains (higher is better)
    #   MAPE     — average percentage error of the model's predictions (lower is better)
    #   R-hat    — convergence check for MCMC chains; values close to 1.0 mean the chains
    #              agreed with each other, which means the results are trustworthy
    #   ESS      — Effective Sample Size; how many truly independent draws the sampler
    #              produced (more is better; very low ESS suggests the chains got stuck)
    logger.debug("[Router/results] GET /results/diagnostics")
    return generator.get_diagnostics()


@router.get("/hill_params")
def get_hill_params():
    # The Hill (diminishing returns) curve describes how a channel's revenue
    # response grows as spend increases — fast at first, then levelling off.
    # ec   = the spend level where the channel reaches 50% of its maximum effect
    # slope = how steeply the curve rises before flattening out
    logger.debug("[Router/results] GET /results/hill_params")
    return generator.get_hill_params()


@router.get("/adstock")
def get_adstock_params():
    # Adstock (carryover) — some advertising keeps working after it runs.
    # A TV spot seen this week can still influence a purchase next month.
    # decayRate = fraction of the effect that carries over to the next week
    # (e.g. 0.65 means 65% of this week's TV effect persists into next week)
    logger.debug("[Router/results] GET /results/adstock")
    return generator.get_adstock_params()


@router.get("/geo")
def get_geo_breakdown():
    # For geographic datasets, returns per-region ROI so you can see which
    # markets are most efficient and whether spend should be rebalanced.
    logger.debug("[Router/results] GET /results/geo")
    return generator.get_geo_breakdown()
