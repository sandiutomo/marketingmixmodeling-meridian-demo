import numpy as np
from typing import Dict, Any


def generate_geo_data(include_rf: bool = False, include_organic: bool = False) -> Dict[str, Any]:
    """
    Generate synthetic geo-level MMM data.
    Mirrors the structure expected by meridian.data.DataLoader for geo data.
    """
    np.random.seed(42)
    n_geos = 5
    n_times = 104  # 2 years weekly

    channels = _get_channels(include_rf, include_organic)
    n_channels = len(channels)

    # Spend data: (n_geos, n_times, n_channels)
    spend_data = np.abs(np.random.lognormal(mean=10, sigma=0.8, size=(n_geos, n_times, n_channels)))

    # Revenue KPI: driven by spend with added noise
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
        # RF data for video channels: (n_geos, n_times, n_rf_channels, 2) — reach + frequency
        result["rf_data"] = np.abs(np.random.lognormal(mean=5, sigma=0.5, size=(n_geos, n_times, 2, 2)))

    if include_organic:
        result["organic_data"] = np.abs(np.random.lognormal(mean=8, sigma=0.4, size=(n_geos, n_times, 3)))
        result["organic_channels"] = ["promotions", "seasonality", "organic"]

    return result


def generate_national_data() -> Dict[str, Any]:
    """
    Generate synthetic national-level MMM data.
    Mirrors meridian.data.DataLoader for national (non-geo) data.
    """
    np.random.seed(123)
    n_times = 156  # 3 years weekly
    channels = ["tv", "radio", "paid_search", "social", "display", "ooh"]

    spend_data = np.abs(np.random.lognormal(mean=11, sigma=0.9, size=(n_times, len(channels))))
    base = np.random.lognormal(mean=12, sigma=0.25, size=n_times)
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
    if include_rf:
        return ["tv_rf", "youtube_rf", "paid_search", "display", "social"]
    elif include_organic:
        return ["paid_search", "display", "social", "email"]
    else:
        return ["tv", "paid_search", "social", "display", "radio"]
