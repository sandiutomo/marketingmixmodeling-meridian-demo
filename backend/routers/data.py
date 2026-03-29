# =============================================================================
# routers/data.py — Act 1: Getting the raw material into the system
#
# Before any modelling can happen, we need data — specifically a table that
# records, week by week, how much was spent on each marketing channel and how
# much revenue came in. This router is where that data enters the platform.
#
# There are two ways to bring data in:
#
#   POST /data/load   — pick one of the built-in sample datasets by name.
#                       These are Google Meridian's official simulated CSV files
#                       (or synthetic stand-ins if the files aren't available).
#
#   POST /data/upload — upload your own CSV file. The platform will inspect it,
#                       figure out which columns are spend / revenue / time / geo,
#                       and load it automatically.
#
#   GET  /data/sources — returns the catalogue of built-in datasets the frontend
#                        can display in its dropdown menu.
#
# Once any of those two load paths completes, the data lives in memory (via
# DataLoaderService) and all subsequent /model and /results calls can use it.
# =============================================================================

import logging
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from services.data_loader import DataLoaderService
from services.csv_ingest import parse_csv_to_loaded_data

logger = logging.getLogger(__name__)

router = APIRouter()
loader = DataLoaderService()


class LoadDataRequest(BaseModel):
    data_source: str


@router.post("/load")
def load_data(req: LoadDataRequest):
    # The frontend sends us a dataset name like "geo_no_rf" or "national".
    # DataLoaderService maps that to the right CSV file (or synthetic fallback)
    # and parses it into the arrays the model later needs.
    logger.info("[Router/data] POST /data/load  data_source=%s", req.data_source)
    result = loader.load(req.data_source)
    logger.info("[Router/data] load complete: n_geos=%s  n_times=%s  n_channels=%s  "
                "total_revenue=%.2f  total_spend=%.2f",
                result.get('n_geos'), result.get('n_times'), result.get('n_channels'),
                result.get('total_revenue', 0), result.get('total_spend', 0))
    return {
        "status": "success",
        "data_source": req.data_source,
        "summary": result,
        "message": f"Successfully loaded {req.data_source} dataset",
    }


@router.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    """Ingest an arbitrary CSV (Meridian-style or *_{spend} + time + revenue)."""
    # The user may supply their own marketing data in CSV format. We accept any
    # layout as long as it has a time column and at least one column ending in
    # '_spend'. The csv_ingest service does the detective work of figuring out
    # the column structure before we hand the data off to DataLoaderService.
    logger.info("[Router/data] POST /data/upload  filename=%s", file.filename)
    if not file.filename or not file.filename.lower().endswith('.csv'):
        raise HTTPException(400, 'Please upload a .csv file')
    try:
        raw = await file.read()
        logger.debug("[Router/data] Upload file size: %d bytes", len(raw))
        import io

        data = parse_csv_to_loaded_data(io.BytesIO(raw))
    except ValueError as e:
        # ValueError means the CSV was readable but structurally wrong —
        # e.g. no spend columns detected. Tell the user exactly what's missing.
        logger.warning("[Router/data] Upload rejected (ValueError): %s", e)
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        logger.error("[Router/data] Upload parse error: %s", e, exc_info=True)
        raise HTTPException(400, f'Could not parse CSV: {e}') from e

    summary = loader.load_uploaded_dict(data)
    logger.info("[Router/data] Upload ingested: %s", summary)
    # Give the frontend enough metadata to show the user what we found in their file:
    # the date range covered, and which columns we mapped to which roles.
    ingest = data.get('ingest_meta') or {}
    times = data.get('times') or []
    return {
        'status': 'success',
        'data_source': 'custom_csv',
        'summary': summary,
        'timespan': {
            'start': times[0] if times else None,
            'end': times[-1] if times else None,
        },
        'column_detection': {
            'time_col': ingest.get('time_col'),
            'geo_col': ingest.get('geo_col'),
            'revenue_col': ingest.get('revenue_col'),
            'spend_cols': ingest.get('spend_cols'),
        },
        'message': f"Loaded {summary['n_times']} periods, {summary['n_channels']} channels, {summary['n_geos']} geo(s).",
    }


@router.get("/sources")
def list_sources():
    # This endpoint drives the dataset picker in the UI. Each entry describes
    # what channels and geographies the dataset contains so the user can make
    # an informed choice before loading.
    return {
        "sources": [
            {
                "id": "custom_csv",
                "label": "Upload your own CSV",
                "channels": [],
                "n_times": 0,
                "upload": True,
            },
            {
                "id": "geo_no_rf",
                "label": "Geographic Data (no RF)",
                "channels": ["tv", "paid_search", "social", "display", "radio"],
                "geos": ["northeast", "southeast", "midwest", "west", "southwest"],
                "n_times": 104,
            },
            {
                "id": "geo_with_rf",
                "label": "Geographic Data (with RF)",
                # These channels include Reach & Frequency (RF) measurements —
                # not just how much was spent, but how many people were reached.
                "channels": ["tv_rf", "youtube_rf", "paid_search", "display", "social"],
                "geos": ["northeast", "southeast", "midwest", "west", "southwest"],
                "n_times": 104,
            },
            {
                "id": "geo_organic",
                "label": "Geographic + Organic & Non-Media",
                "channels": ["paid_search", "display", "social", "email"],
                # non_media are signals without a spend budget — things like
                # promotions or seasonal effects that still influence sales.
                "non_media": ["promotions", "seasonality", "organic"],
                "geos": ["northeast", "southeast", "midwest", "west", "southwest"],
                "n_times": 104,
            },
            {
                "id": "national",
                "label": "National Data",
                "channels": ["tv", "radio", "paid_search", "social", "display", "ooh"],
                "n_times": 156,
            },
            {
                "id": "indonesia",
                "label": "Indonesia Market",
                "channels": ["ooh", "tiktok", "shopee", "tokopedia", "instagram", "youtube", "google_ads", "meta"],
                "n_times": 200,
                "currency": "IDR",
            },
        ]
    }
