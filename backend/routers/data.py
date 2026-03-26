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
    logger.info("[Router/data] POST /data/upload  filename=%s", file.filename)
    if not file.filename or not file.filename.lower().endswith('.csv'):
        raise HTTPException(400, 'Please upload a .csv file')
    try:
        raw = await file.read()
        logger.debug("[Router/data] Upload file size: %d bytes", len(raw))
        import io

        data = parse_csv_to_loaded_data(io.BytesIO(raw))
    except ValueError as e:
        logger.warning("[Router/data] Upload rejected (ValueError): %s", e)
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        logger.error("[Router/data] Upload parse error: %s", e, exc_info=True)
        raise HTTPException(400, f'Could not parse CSV: {e}') from e

    summary = loader.load_uploaded_dict(data)
    logger.info("[Router/data] Upload ingested: %s", summary)
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
                "channels": ["tv_rf", "youtube_rf", "paid_search", "display", "social"],
                "geos": ["northeast", "southeast", "midwest", "west", "southwest"],
                "n_times": 104,
            },
            {
                "id": "geo_organic",
                "label": "Geographic + Organic & Non-Media",
                "channels": ["paid_search", "display", "social", "email"],
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
