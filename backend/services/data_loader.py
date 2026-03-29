# =============================================================================
# services/data_loader.py — The librarian: fetching and serving the dataset
#
# This service acts as the single source of truth for the current dataset.
# Everything else in the platform (the model runner, the results generator,
# the optimizer) reads data from here.
#
# The service supports two load paths:
#
#   load(data_source)          — loads one of the built-in named datasets.
#                                First it tries to read the official Google
#                                Meridian simulated CSV files from disk.
#                                If those files aren't present (e.g. first run
#                                before downloading them), it falls back to the
#                                synthetic generator in data/mock_data.py.
#
#   load_uploaded_dict(data)   — accepts a pre-parsed dict from csv_ingest.py
#                                (the user's own CSV). Just stores it.
#
# Once either method runs, the parsed dataset is held in _loaded_data as a
# class-level variable. This makes it globally accessible to any service that
# imports DataLoaderService — a simple in-memory store that works fine for a
# single-user demo server.
# =============================================================================

import logging
from typing import Optional
import os
import csv
import numpy as np
from data.mock_data import generate_geo_data, generate_national_data

logger = logging.getLogger(__name__)

# Location of Google Meridian's official simulated CSV files on disk.
# These are downloaded separately from the google/meridian GitHub repository.
MERIDIAN_DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'meridian_sample')

# Maps each dataset name to the filename inside MERIDIAN_DATA_DIR.
CSV_FILES = {
    'geo_no_rf':   'geo_media.csv',
    'geo_with_rf': 'geo_media_rf.csv',
    'geo_organic': 'geo_all_channels.csv',
    'national':    'national_all_channels.csv',
    'indonesia':   'indonesia.csv',
}

# Meridian's CSV files use generic "Channel0", "Channel1" column names.
# This lookup maps each dataset's channels to descriptive names the UI can display.
CHANNEL_NAMES = {
    'geo_no_rf':   ['tv', 'paid_search', 'social', 'display'],
    'geo_with_rf': ['tv', 'paid_search', 'social', 'youtube'],
    'geo_organic': ['tv', 'paid_search', 'social', 'display', 'ooh'],
    'national':    ['tv', 'radio', 'paid_search', 'social', 'display'],
    'indonesia':   ['channel_0', 'channel_1', 'channel_2', 'channel_3', 'channel_4', 'channel_5', 'channel_6', 'channel_7'],
}


def _load_meridian_csv(source: str) -> dict:
    """Load from the real Meridian simulated_data CSV files."""
    filepath = os.path.join(MERIDIAN_DATA_DIR, CSV_FILES[source])
    logger.info("[DataLoader] Loading CSV: source=%s  path=%s", source, filepath)

    with open(filepath, newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    logger.debug("[DataLoader] CSV read: %d rows, columns=%s", len(rows), list(rows[0].keys()) if rows else [])

    # Remove unnamed index column if present (common artefact from pandas to_csv())
    for row in rows:
        row.pop('', None)

    # ── Discover dimensions from the data ─────────────────────────────────
    # Rather than hard-coding counts, we derive them from what's actually in
    # the file — safer if different CSV versions have different time ranges.
    has_geo = 'geo' in rows[0]
    geos = sorted(set(r['geo'] for r in rows)) if has_geo else ['national']
    times = sorted(set(r['time'] for r in rows))

    n_geos = len(geos)
    n_times = len(times)
    channels = CHANNEL_NAMES[source]
    n_channels = len(channels)
    logger.info("[DataLoader] Dimensions: n_geos=%d  n_times=%d  n_channels=%d  has_geo=%s",
                n_geos, n_times, n_channels, has_geo)
    logger.debug("[DataLoader] Geos: %s", geos)
    logger.debug("[DataLoader] Time range: %s → %s", times[0] if times else "?", times[-1] if times else "?")
    logger.debug("[DataLoader] Channels: %s", channels)

    # ── Control columns ────────────────────────────────────────────────────
    # Control variables are external signals the model should "see" but that
    # aren't marketing channels (e.g. competitor activity, sentiment scores).
    # Different CSV files use different column names, so we check for each one.
    control_cols = [c for c in [
        'competitor_sales_control',
        'competitor_activity_score_control',
        'sentiment_score_control',
    ] if c in rows[0]]
    n_controls = len(control_cols)
    logger.debug("[DataLoader] Control columns detected (%d): %s", n_controls, control_cols)

    # ── RF (Reach & Frequency) detection ──────────────────────────────────
    # The geo_with_rf dataset has Channel{i}_reach and Channel{i}_frequency
    # columns alongside the spend column. These are needed for Meridian's
    # RF media model (as opposed to the simpler spend-only media model).
    rf_channel_indices = [i for i in range(n_channels) if f'Channel{i}_reach' in rows[0] and f'Channel{i}_frequency' in rows[0]]
    has_rf = len(rf_channel_indices) > 0
    logger.debug("[DataLoader] RF channel indices: %s  has_rf=%s", rf_channel_indices, has_rf)
    # rf_data shape: (n_geos, n_times, 2, n_rf_channels) — axis 2 is [reach, frequency]
    n_rf = len(rf_channel_indices)
    rf_data = np.zeros((n_geos, n_times, 2, n_rf) if has_geo else (n_times, 2, n_rf)) if has_rf else None

    # ── Pre-allocate output arrays ─────────────────────────────────────────
    spend_data   = np.zeros((n_geos, n_times, n_channels) if has_geo else (n_times, n_channels))
    kpi_data     = np.zeros((n_geos, n_times) if has_geo else n_times)
    control_data = np.zeros((n_geos, n_times, n_controls) if has_geo else (n_times, n_controls)) if n_controls else None

    # ── Fill arrays row by row ─────────────────────────────────────────────
    for row in rows:
        t_idx = times.index(row['time'])
        g_idx = geos.index(row['geo']) if has_geo else 0

        # Spend: columns are named Channel0_spend, Channel1_spend, …
        for ch_i in range(n_channels):
            col = f'Channel{ch_i}_spend'
            val = float(row.get(col, 0) or 0)
            if has_geo:
                spend_data[g_idx, t_idx, ch_i] = val
            else:
                spend_data[t_idx, ch_i] = val

        # Revenue: Meridian's CSVs store conversions and revenue_per_conversion
        # rather than a direct revenue figure. Multiply them to get the KPI.
        conv = float(row.get('conversions', 0) or 0)
        rpc  = float(row.get('revenue_per_conversion', 0) or 0)
        revenue = conv * rpc
        if has_geo:
            kpi_data[g_idx, t_idx] = revenue
        else:
            kpi_data[t_idx] = revenue

        if control_data is not None:
            for c_i, col in enumerate(control_cols):
                val = float(row.get(col, 0) or 0)
                if has_geo:
                    control_data[g_idx, t_idx, c_i] = val
                else:
                    control_data[t_idx, c_i] = val

        if rf_data is not None:
            for rf_i, ch_i in enumerate(rf_channel_indices):
                reach = float(row.get(f'Channel{ch_i}_reach', 0) or 0)
                freq  = float(row.get(f'Channel{ch_i}_frequency', 0) or 0)
                if has_geo:
                    rf_data[g_idx, t_idx, 0, rf_i] = reach
                    rf_data[g_idx, t_idx, 1, rf_i] = freq
                else:
                    rf_data[t_idx, 0, rf_i] = reach
                    rf_data[t_idx, 1, rf_i] = freq

    total_revenue = float(kpi_data.sum())
    total_spend   = float(spend_data.sum())
    logger.info("[DataLoader] Loaded — total_revenue=%.2f  total_spend=%.2f  ratio=%.3f",
                total_revenue, total_spend, total_revenue / max(total_spend, 1))
    per_ch_spend = spend_data.reshape(-1, n_channels).sum(axis=0)
    for i, ch in enumerate(channels):
        logger.debug("[DataLoader]   channel[%d] %-20s  spend=%.2f", i, ch, per_ch_spend[i])

    return {
        'n_geos': n_geos,
        'n_times': n_times,
        'n_channels': n_channels,
        'channels': channels,
        'geos': geos,
        'times': times,                 # list of date strings — Meridian builder needs these as coords
        'kpi_data': kpi_data,
        'spend_data': spend_data,
        'control_data': control_data,   # None if no control columns exist in this CSV
        'control_cols': control_cols,
        'rf_data': rf_data,             # None unless this dataset has reach+frequency columns
        'rf_channel_indices': rf_channel_indices,  # which channel positions are RF-type
        'has_rf': has_rf,
        'source': 'meridian_simulated_data',
    }


class DataLoaderService:
    """
    Loads Google Meridian's official simulated_data CSV files.
    Falls back to synthetic generation if files are unavailable.
    """

    # Class-level storage so any part of the backend can access the
    # currently loaded dataset without having to pass it around explicitly.
    _loaded_data: Optional[dict] = None
    _source_type: Optional[str] = None

    def load(self, data_source: str) -> dict:
        logger.info("[DataLoader] load() called: data_source=%s", data_source)
        try:
            # Happy path: read the real Meridian CSV file from disk.
            data = _load_meridian_csv(data_source)
        except Exception as e:
            # If the file isn't there yet (or can't be read for any reason),
            # fall back to synthetically generated data so the demo keeps working.
            logger.warning("[DataLoader] Meridian CSV unavailable (%s), using synthetic fallback", e)
            if data_source == 'geo_no_rf':
                data = generate_geo_data(include_rf=False, include_organic=False)
            elif data_source == 'geo_with_rf':
                data = generate_geo_data(include_rf=True, include_organic=False)
            elif data_source == 'geo_organic':
                data = generate_geo_data(include_rf=False, include_organic=True)
            elif data_source == 'national':
                data = generate_national_data()
            else:
                raise ValueError(f'Unknown data source: {data_source}')

        # Store the full dataset at the class level so other services can read it.
        self.__class__._loaded_data = data
        self.__class__._source_type = data_source
        # Return a lightweight summary to the router (not the full arrays —
        # those stay in memory and are accessed directly by the other services).
        summary = {
            'n_geos': data.get('n_geos', 1),
            'n_times': data['n_times'],
            'n_channels': data['n_channels'],
            'channels': data['channels'],
            'channel_labels': data.get('channel_labels'),
            'geos': data.get('geos'),
            'kpi': 'revenue',
            'total_revenue': float(np.sum(data['kpi_data'])),
            'total_spend': float(np.sum(data['spend_data'])),
            'data_source': data.get('source', 'synthetic'),
        }
        logger.info("[DataLoader] load() complete: n_geos=%d  n_times=%d  n_channels=%d  "
                    "total_revenue=%.2f  total_spend=%.2f",
                    summary['n_geos'], summary['n_times'], summary['n_channels'],
                    summary['total_revenue'], summary['total_spend'])
        return summary

    def load_uploaded_dict(self, data: dict) -> dict:
        """Store client-parsed or server-parsed uploaded CSV payload."""
        # The csv_ingest service already parsed the uploaded file into the
        # same dict format that _load_meridian_csv produces, so we just
        # store it and return the summary — no extra processing needed.
        logger.info("[DataLoader] load_uploaded_dict(): n_channels=%d  n_times=%d  n_geos=%d",
                    data.get('n_channels', '?'), data.get('n_times', '?'), data.get('n_geos', 1))
        self.__class__._loaded_data = data
        self.__class__._source_type = 'custom_csv'
        return {
            'n_geos': data.get('n_geos', 1),
            'n_times': data['n_times'],
            'n_channels': data['n_channels'],
            'channels': data['channels'],
            'channel_labels': data.get('channel_labels'),
            'geos': data.get('geos'),
            'kpi': 'revenue',
            'total_revenue': float(np.sum(data['kpi_data'])),
            'total_spend': float(np.sum(data['spend_data'])),
            'data_source': data.get('source', 'uploaded_csv'),
        }
