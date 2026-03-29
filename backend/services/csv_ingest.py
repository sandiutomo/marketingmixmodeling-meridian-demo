# =============================================================================
# services/csv_ingest.py — The detective: figuring out what's inside any CSV
#
# When a user uploads their own marketing data file, we have no idea what it
# looks like ahead of time. Different companies name their columns differently —
# "date" vs "week" vs "time", "revenue" vs "kpi", "tv_spend" vs "Channel0_spend".
#
# This file's job is to take that unknown CSV and make sense of it by inspecting
# the column names. Once we know which column is time, which is revenue, and
# which ones are spend figures, we can pour the data into the same numeric array
# format that the Meridian pipeline expects. From that point on, an uploaded CSV
# is treated identically to one of the built-in sample datasets.
#
# There are two public functions here:
#
#   detect_columns(fieldnames)          — looks at the column headers and maps
#                                         each one to a role (time / geo / revenue
#                                         / spend / RF / control)
#
#   parse_csv_to_loaded_data(file_obj)  — reads the actual rows, calls detect_columns,
#                                         and fills numpy arrays for spend, KPI, and
#                                         any optional fields (RF reach/frequency,
#                                         control variables)
# =============================================================================

from __future__ import annotations

import csv
import io
import re
from typing import Any, BinaryIO, Dict, List, Optional, Tuple

import numpy as np


def _norm_header(h: str) -> str:
    # Strip whitespace and the UTF-8 BOM character (common in Excel exports),
    # then lowercase — so "  Date " and "\ufeffDATE" both become "date".
    return h.strip().strip("\ufeff").lower()


def _slug(name: str) -> str:
    # Turn a column name like "TV Spend" or "tv-spend" into a clean internal
    # key like "tv" that can be used as a dictionary key or channel identifier.
    s = re.sub(r"_spend$", "", name.strip(), flags=re.I)
    s = s.lower().replace(" ", "_").replace("-", "_")
    return re.sub(r"[^a-z0-9_]+", "_", s).strip("_") or "channel"


def detect_columns(fieldnames: List[str]) -> Dict[str, Any]:
    # Build a lowercased lookup so we can find columns case-insensitively.
    lower = {_norm_header(h): h for h in fieldnames}

    # ── Time column ────────────────────────────────────────────────────────
    # Every dataset must have a column that marks each row's time period.
    # We check common names in order of preference.
    time_key = None
    for cand in ("time", "date", "week", "period", "dt"):
        if cand in lower:
            time_key = lower[cand]
            break
    if not time_key:
        raise ValueError("CSV must include a time column (time, date, week, period, or dt).")

    # ── Geo column (optional) ──────────────────────────────────────────────
    # If the data is broken down by region, each row will have a geo identifier.
    # If no such column exists, we treat the entire dataset as national.
    geo_key = None
    for cand in ("geo", "region", "market", "dma"):
        if cand in lower:
            geo_key = lower[cand]
            break

    # ── Revenue / KPI column ───────────────────────────────────────────────
    # Revenue can be recorded directly, or calculated as conversions × revenue
    # per conversion. We look for direct revenue first.
    revenue_key = None
    if "revenue" in lower:
        revenue_key = lower["revenue"]
    elif "kpi" in lower:
        revenue_key = lower["kpi"]

    conv_key = lower.get("conversions")
    rpc_key = lower.get("revenue_per_conversion")

    # ── Spend columns ──────────────────────────────────────────────────────
    # We support two naming conventions:
    #   1. Meridian-style: Channel0_spend, Channel1_spend, ...
    #   2. Descriptive:    tv_spend, paid_search_spend, ...
    # Meridian-style columns are detected first and sorted by index number
    # to preserve channel order. Descriptive columns are sorted alphabetically.
    ch_pattern = re.compile(r"^Channel(\d+)_spend$", re.I)
    spend_by_index: List[Tuple[int, str]] = []
    loose_spend: List[str] = []
    for h in fieldnames:
        h_strip = h.strip()
        m = ch_pattern.match(h_strip)
        if m:
            spend_by_index.append((int(m.group(1)), h_strip))
        elif _norm_header(h).endswith("_spend") and not ch_pattern.match(h_strip):
            loose_spend.append(h_strip)

    spend_by_index.sort(key=lambda x: x[0])
    if spend_by_index:
        spend_cols = [x[1] for x in spend_by_index]
        channels = [f"channel_{i}" for i, _ in spend_by_index]
        labels = {f"channel_{i}": f"Channel {i}" for i, _ in spend_by_index}
    elif loose_spend:
        spend_cols = sorted(loose_spend, key=lambda x: x.lower())
        channels = [_slug(c) for c in spend_cols]
        labels = {ch: re.sub(r"_spend$", "", col, flags=re.I).replace("_", " ").title() for ch, col in zip(channels, spend_cols)}
    else:
        raise ValueError("No spend columns found. Use Channel{i}_spend or names ending in _spend (e.g. tv_spend).")

    # ── RF (Reach & Frequency) columns (optional) ──────────────────────────
    # Some Meridian-style datasets include Channel{i}_reach and Channel{i}_frequency
    # alongside the spend column. If both reach and frequency exist for a channel,
    # we mark it as an RF channel that gets special treatment in the model.
    rf_indices: List[int] = []
    if spend_by_index:
        for idx, _ in spend_by_index:
            rk = f"Channel{idx}_reach"
            fk = f"Channel{idx}_frequency"
            if any(x.strip() == rk for x in fieldnames) and any(x.strip() == fk for x in fieldnames):
                rf_indices.append(idx)

    # ── Control variable columns (optional) ────────────────────────────────
    # Control variables are non-spend factors the model should account for —
    # things like competitor activity or economic sentiment scores. Any column
    # with "control" in its name (that isn't geo or time) is treated as one.
    control_cols = [
        h.strip() for h in fieldnames
        if "control" in _norm_header(h) and _norm_header(h) not in ("geo", "time", "date")
    ]

    return {
        "time_col": time_key,
        "geo_col": geo_key,
        "revenue_col": revenue_key,
        "conversions_col": conv_key,
        "rpc_col": rpc_key,
        "spend_cols": spend_cols,
        "channels": channels,
        "channel_labels": labels,
        "rf_channel_indices": rf_indices,
        "control_cols": control_cols,
    }


def parse_csv_to_loaded_data(
    file_obj: BinaryIO,
    *,
    encoding: str = "utf-8-sig",
) -> Dict[str, Any]:
    # ── Step 1: Read the raw file bytes and decode to text ─────────────────
    raw = file_obj.read()
    if isinstance(raw, str):
        text = raw
    else:
        text = raw.decode(encoding, errors="replace")

    f = io.StringIO(text)
    reader = csv.DictReader(f)
    if not reader.fieldnames:
        raise ValueError("CSV has no header row.")

    # ── Step 2: Detect column roles from the header ────────────────────────
    fieldnames = list(reader.fieldnames)
    meta = detect_columns(fieldnames)
    rows = list(reader)

    for row in rows:
        row.pop("", None)  # remove any spurious empty-key column from Excel

    time_col = meta["time_col"]
    geo_col = meta["geo_col"]

    # ── Step 3: Build the list of unique time periods and geos ─────────────
    # Sorting ensures consistent ordering — the same file always produces the
    # same array layout regardless of row order in the CSV.
    times = sorted({str(row[time_col]).strip() for row in rows if row.get(time_col)})
    if not times:
        raise ValueError("No time values found.")

    has_geo = geo_col is not None
    if has_geo:
        geos = sorted({str(row[geo_col]).strip() for row in rows if row.get(geo_col)})
    else:
        geos = ["national"]

    n_geos = len(geos)
    n_times = len(times)
    channels: List[str] = meta["channels"]
    n_channels = len(channels)
    spend_cols = meta["spend_cols"]

    rf_indices = meta["rf_channel_indices"]
    rf_set = set(rf_indices)
    non_rf_indices = [i for i in range(n_channels) if i not in rf_set]

    control_cols = meta["control_cols"]
    n_controls = len(control_cols)

    # ── Step 4: Allocate zero-filled output arrays ─────────────────────────
    # We pre-allocate all arrays before looping through rows so that row order
    # in the CSV doesn't matter — each row is placed at its correct index.
    spend_data = np.zeros((n_geos, n_times, n_channels) if has_geo else (n_times, n_channels))
    kpi_data = np.zeros((n_geos, n_times) if has_geo else n_times)
    control_data = (
        np.zeros((n_geos, n_times, n_controls) if has_geo else (n_times, n_controls))
        if n_controls
        else None
    )

    n_rf = len(rf_indices)
    rf_data = None
    if n_rf > 0:
        # RF array layout: (geos, times, 2, rf_channels)
        # The "2" dimension holds [reach, frequency] for each RF channel.
        rf_data = np.zeros((n_geos, n_times, 2, n_rf) if has_geo else (n_times, 2, n_rf))

    rev_col = meta["revenue_col"]
    conv_col = meta["conversions_col"]
    rpc_col = meta["rpc_col"]

    if rev_col:
        pass  # direct revenue column — use it as-is
    elif conv_col and rpc_col:
        pass  # calculate revenue = conversions × revenue_per_conversion below
    else:
        raise ValueError("Need a revenue column or both conversions and revenue_per_conversion.")

    # ── Step 5: Fill the arrays row by row ─────────────────────────────────
    for row in rows:
        t = str(row[time_col]).strip()
        if t not in times:
            continue
        t_idx = times.index(t)
        if has_geo:
            g = str(row[geo_col]).strip()
            g_idx = geos.index(g)
        else:
            g_idx = 0

        # Revenue: either read directly or compute from conversions × RPC
        if rev_col:
            revenue = float(row.get(rev_col) or 0)
        else:
            conv = float(row.get(conv_col) or 0)
            rpc = float(row.get(rpc_col) or 0)
            revenue = conv * rpc

        if has_geo:
            kpi_data[g_idx, t_idx] += revenue
        else:
            kpi_data[t_idx] += revenue

        # Spend: one value per channel per row
        for ch_i, scol in enumerate(spend_cols):
            val = float(row.get(scol, 0) or 0)
            if has_geo:
                spend_data[g_idx, t_idx, ch_i] += val
            else:
                spend_data[t_idx, ch_i] += val

        # Control variables: optional contextual signals
        if control_data is not None:
            for c_i, ccol in enumerate(control_cols):
                val = float(row.get(ccol, 0) or 0)
                if has_geo:
                    control_data[g_idx, t_idx, c_i] += val
                else:
                    control_data[t_idx, c_i] += val

        # RF channels: fill reach and frequency in the dedicated array
        if rf_data is not None:
            for rf_i, ch_i in enumerate(rf_indices):
                rk = f"Channel{ch_i}_reach"
                fk = f"Channel{ch_i}_frequency"
                reach = float(row.get(rk, 0) or 0)
                freq = float(row.get(fk, 0) or 0)
                if has_geo:
                    rf_data[g_idx, t_idx, 0, rf_i] += reach
                    rf_data[g_idx, t_idx, 1, rf_i] += freq
                else:
                    rf_data[t_idx, 0, rf_i] += reach
                    rf_data[t_idx, 1, rf_i] += freq

    # ── Step 6: Return the assembled dataset dict ──────────────────────────
    # From this point the uploaded data looks identical to a built-in dataset
    # and can be passed directly into MeridianRunner or ResultsGeneratorService.
    return {
        "n_geos": n_geos,
        "n_times": n_times,
        "n_channels": n_channels,
        "channels": channels,
        "channel_labels": meta["channel_labels"],
        "geos": geos,
        "times": times,
        "kpi_data": kpi_data,
        "spend_data": spend_data,
        "control_data": control_data,
        "control_cols": control_cols,
        "rf_data": rf_data,
        "rf_channel_indices": rf_indices,
        "has_rf": n_rf > 0,
        "source": "uploaded_csv",
        "ingest_meta": meta,  # keep the column-detection metadata for the response summary
    }
