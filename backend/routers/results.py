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
from fastapi import APIRouter, Query
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


@router.get("/timeseries")
def get_timeseries(
    period: str = Query(
        "quarterly",
        pattern="^(weekly|monthly|quarterly|yearly)$",
        description=(
            "Time granularity for the breakdown. "
            "One of: weekly | monthly | quarterly | yearly. "
            "Mirrors the Meridian Scenario Planner notebook's time_breakdown_generators."
        ),
    )
):
    """
    Return channel revenue attribution broken down by time period.

    Mirrors the Meridian Scenario Planner notebook's time_breakdown_generators
    parameter. Produces a stacked bar/area chart data structure with one row per
    period bucket and one column per marketing channel plus a Base (non-media) column.

    Valid period values:
      - weekly    : one data point per week
      - monthly   : aggregated to calendar month
      - quarterly : aggregated to calendar quarter (Q1–Q4)
      - yearly    : aggregated to calendar year
    """
    logger.info("[Router/results] GET /results/timeseries  period=%s", period)
    return generator.get_timeseries(period)


@router.get("/synergy")
def get_synergy():
    """
    Pairwise Pearson correlation of weekly channel spend series.
    Returns an n×n correlation matrix and a filtered pairs list sorted by
    absolute correlation descending.

    When a real Meridian posterior is available, method='meridian'.
    Otherwise method='pearson' (correlation on historical spend data).
    """
    logger.info("[Router/results] GET /results/synergy")
    return generator.get_synergy()


@router.get("/saturation")
def get_saturation():
    """
    Per-channel saturation frontier: current spend vs. Hill-curve ec (half-saturation
    point), marginal ROI at current spend, and a status label
    ('saturated' | 'efficient' | 'room_to_grow').
    """
    logger.info("[Router/results] GET /results/saturation")
    return generator.get_saturation()


@router.get("/waterfall")
def get_waterfall(
    period: str = Query(
        "quarterly",
        pattern="^(weekly|monthly|quarterly|yearly)$",
        description="Time granularity for the waterfall breakdown. Same values as /timeseries.",
    )
):
    """
    Period-over-period revenue change per channel.
    First period = baseline (absolute values). Subsequent periods = delta vs previous.
    Designed for a waterfall / stacked bar chart showing what drove revenue changes.
    """
    logger.info("[Router/results] GET /results/waterfall  period=%s", period)
    return generator.get_waterfall(period)


@router.get("/model_fit")
def get_model_fit():
    """
    Weekly actual vs model-predicted revenue.
    Equivalent to Meridian's visualizer.ModelFit.plot_model_fit().
    Used by the frontend ModelFitChart to show how well the model tracks reality.
    """
    logger.info("[Router/results] GET /results/model_fit")
    return generator.get_model_fit()


@router.get("/mroi")
def get_mroi():
    """
    Marginal ROI per channel: revenue from the last dollar spent.
    Computed as the Hill curve derivative at current spend levels.
    Equivalent to Meridian's visualizer.MediaSummary.plot_roi_vs_mroi() data.
    """
    logger.info("[Router/results] GET /results/mroi")
    return generator.get_mroi()


@router.get("/cpik")
def get_cpik():
    """
    Cost Per Incremental KPI per channel.
    CPIK = spend ÷ incremental_revenue — lower is better.
    Equivalent to Meridian's visualizer.MediaSummary.plot_cpik().
    """
    logger.info("[Router/results] GET /results/cpik")
    return generator.get_cpik()


@router.get("/export/csv")
def export_csv():
    """
    Looker Studio–ready flat CSV of all channel metrics.
    Upload to Google Sheets → connect a Looker Studio report pre-built
    with the channel metrics schema.
    """
    from fastapi.responses import Response
    logger.info("[Router/results] GET /results/export/csv")
    csv_content = generator.get_export_csv()
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="meridian_channel_metrics.csv"'},
    )


@router.get("/export/html")
def export_html():
    """
    Self-contained HTML report — mirrors Meridian's Summarizer.output_model_results_summary().
    All styles are inlined; renders in any browser without external dependencies.
    """
    from fastapi.responses import Response
    logger.info("[Router/results] GET /results/export/html")
    html_content = generator.get_export_html()
    return Response(
        content=html_content,
        media_type="text/html",
        headers={"Content-Disposition": 'attachment; filename="meridian_model_report.html"'},
    )


@router.get("/holdout-design")
def get_holdout_design():
    """
    Suggest treatment/control geo assignments for a media lift test.
    Geos are sorted by portfolio ROI and alternately assigned to each group.
    Returns applicable=False for single-geo (national) datasets.
    """
    logger.info("[Router/results] GET /results/holdout-design")
    return generator.get_holdout_design()
