"""
Flexible CSV → Meridian NDArrayInputDataBuilder-compatible dict.

Supports Meridian-style columns (time, geo, Channel{i}_spend, conversions,
revenue_per_conversion) and common variants (date, revenue, *_spend).
"""
from __future__ import annotations

import csv
import io
import re
from typing import Any, BinaryIO, Dict, List, Optional, Tuple

import numpy as np


def _norm_header(h: str) -> str:
    return h.strip().strip("\ufeff").lower()


def _slug(name: str) -> str:
    s = re.sub(r"_spend$", "", name.strip(), flags=re.I)
    s = s.lower().replace(" ", "_").replace("-", "_")
    return re.sub(r"[^a-z0-9_]+", "_", s).strip("_") or "channel"


def detect_columns(fieldnames: List[str]) -> Dict[str, Any]:
    lower = {_norm_header(h): h for h in fieldnames}

    time_key = None
    for cand in ("time", "date", "week", "period", "dt"):
        if cand in lower:
            time_key = lower[cand]
            break
    if not time_key:
        raise ValueError("CSV must include a time column (time, date, week, period, or dt).")

    geo_key = None
    for cand in ("geo", "region", "market", "dma"):
        if cand in lower:
            geo_key = lower[cand]
            break

    revenue_key = None
    if "revenue" in lower:
        revenue_key = lower["revenue"]
    elif "kpi" in lower:
        revenue_key = lower["kpi"]

    conv_key = lower.get("conversions")
    rpc_key = lower.get("revenue_per_conversion")

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

    rf_indices: List[int] = []
    if spend_by_index:
        for idx, _ in spend_by_index:
            rk = f"Channel{idx}_reach"
            fk = f"Channel{idx}_frequency"
            if any(x.strip() == rk for x in fieldnames) and any(x.strip() == fk for x in fieldnames):
                rf_indices.append(idx)

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
    raw = file_obj.read()
    if isinstance(raw, str):
        text = raw
    else:
        text = raw.decode(encoding, errors="replace")

    f = io.StringIO(text)
    reader = csv.DictReader(f)
    if not reader.fieldnames:
        raise ValueError("CSV has no header row.")

    fieldnames = list(reader.fieldnames)
    meta = detect_columns(fieldnames)
    rows = list(reader)

    for row in rows:
        row.pop("", None)

    time_col = meta["time_col"]
    geo_col = meta["geo_col"]

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
        rf_data = np.zeros((n_geos, n_times, 2, n_rf) if has_geo else (n_times, 2, n_rf))

    rev_col = meta["revenue_col"]
    conv_col = meta["conversions_col"]
    rpc_col = meta["rpc_col"]

    if rev_col:
        pass
    elif conv_col and rpc_col:
        pass
    else:
        raise ValueError("Need a revenue column or both conversions and revenue_per_conversion.")

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

        for ch_i, scol in enumerate(spend_cols):
            val = float(row.get(scol, 0) or 0)
            if has_geo:
                spend_data[g_idx, t_idx, ch_i] += val
            else:
                spend_data[t_idx, ch_i] += val

        if control_data is not None:
            for c_i, ccol in enumerate(control_cols):
                val = float(row.get(ccol, 0) or 0)
                if has_geo:
                    control_data[g_idx, t_idx, c_i] += val
                else:
                    control_data[t_idx, c_i] += val

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
        "ingest_meta": meta,
    }
