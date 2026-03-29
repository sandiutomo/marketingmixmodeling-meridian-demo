# =============================================================================
# mock_data.py — The understudy: synthetic data for when the real CSVs aren't around
#
# The platform is designed to run against Google Meridian's official simulated
# sample data files. But those files aren't always present — for example during
# local development, a CI run, or a demo on a machine that skipped the download.
#
# This file is the safety net. It generates realistic-looking marketing datasets
# entirely from random numbers so the rest of the code always has something to
# work with. The data is fake, but its *shape* and *scale* match what the real
# Meridian CSV files produce, so every downstream function behaves identically.
#
# There are two flavours of dataset the platform supports:
#   - Geo-level   — five regional markets, each with their own spend and revenue
#   - National    — a single country-level view with longer history
# =============================================================================

import numpy as np
from typing import Dict, Any


def generate_geo_data(include_rf: bool = False, include_organic: bool = False) -> Dict[str, Any]:
    """
    Generate synthetic geo-level MMM data.
    Mirrors the structure expected by meridian.data.DataLoader for geo data.
    """
    # Fix the random seed so results are reproducible — every run with the same
    # settings produces the exact same synthetic dataset. Useful for debugging.
    np.random.seed(42)
    n_geos = 5
    n_times = 104  # 2 years of weekly data

    channels = _get_channels(include_rf, include_organic)
    n_channels = len(channels)

    # ---------------------------------------------------------------------
    # Spend data — shape: (geos, weeks, channels)
    #
    # We use a log-normal distribution here because real marketing spend is
    # always positive and tends to have a long right tail: most weeks have
    # modest spend, with occasional high-spend bursts (e.g. Black Friday).
    # mean=10 gives spend figures roughly in the tens-of-thousands range.
    # ---------------------------------------------------------------------
    spend_data = np.abs(np.random.lognormal(mean=10, sigma=0.8, size=(n_geos, n_times, n_channels)))

    # ---------------------------------------------------------------------
    # Revenue (KPI) — shape: (geos, weeks)
    #
    # Revenue is made up of two parts:
    #   1. A "base" — sales the brand would have made with no advertising at all
    #   2. A "media effect" — additional revenue driven by spending across channels
    #
    # The 0.3 multiplier means media accounts for roughly 30% of total revenue,
    # which is a realistic ratio for most consumer brands.
    # ---------------------------------------------------------------------
    base = np.random.lognormal(mean=11, sigma=0.3, size=(n_geos, n_times))
    media_effect = spend_data.sum(axis=2) * np.random.uniform(0.8, 1.2, size=(n_geos, n_times))
    kpi_data = base + media_effect * 0.3

    result: Dict[str, Any] = {
        "n_geos": n_geos,
        "n_times": n_times,
        "n_channels": n_channels,
        "channels": channels,
        "geos": ["northeast", "southeast", "midwest", "west", "southwest"],
        "kpi_data": kpi_data,
        "spend_data": spend_data,
        "include_rf": include_rf,
        "include_organic": include_organic,
    }

    if include_rf:
        # Some video channels (TV, YouTube) are measured not just by spend but by
        # Reach (how many unique people saw the ad) and Frequency (how many times
        # each person saw it). Shape: (geos, weeks, rf_channels, 2) — the last
        # dimension is [reach, frequency].
        result["rf_data"] = np.abs(np.random.lognormal(mean=5, sigma=0.5, size=(n_geos, n_times, 2, 2)))

    if include_organic:
        # Organic signals are non-paid drivers: promotions, natural search, and
        # seasonal effects. They're included as "context" variables the model can
        # learn from even though there's no spend behind them.
        result["organic_data"] = np.abs(np.random.lognormal(mean=8, sigma=0.4, size=(n_geos, n_times, 3)))
        result["organic_channels"] = ["promotions", "seasonality", "organic"]

    return result


def generate_national_data() -> Dict[str, Any]:
    """
    Generate synthetic national-level MMM data.
    Mirrors meridian.data.DataLoader for national (non-geo) data.
    """
    # Different seed from geo data so the two datasets look distinct.
    np.random.seed(123)
    n_times = 156  # 3 years of weekly data — longer history for a national view
    channels = ["tv", "radio", "paid_search", "social", "display", "ooh"]

    # At national level there's no geo dimension — everything is a single
    # time series. Shape is (weeks, channels) for spend and (weeks,) for revenue.
    spend_data = np.abs(np.random.lognormal(mean=11, sigma=0.9, size=(n_times, len(channels))))
    base = np.random.lognormal(mean=12, sigma=0.25, size=n_times)
    # Media drives 35% of revenue at national level (slightly higher than geo
    # because national campaigns tend to be more efficient).
    kpi_data = base + spend_data.sum(axis=1) * 0.35

    return {
        "n_geos": 1,
        "n_times": n_times,
        "n_channels": len(channels),
        "channels": channels,
        "kpi_data": kpi_data,
        "spend_data": spend_data,
    }


def _get_channels(include_rf: bool, include_organic: bool) -> list:
    # The channel list depends on which dataset variant was requested.
    # RF datasets swap regular TV/YouTube for their reach+frequency equivalents.
    if include_rf:
        return ["tv_rf", "youtube_rf", "paid_search", "display", "social"]
    elif include_organic:
        return ["paid_search", "display", "social", "email"]
    else:
        return ["tv", "paid_search", "social", "display", "radio"]
