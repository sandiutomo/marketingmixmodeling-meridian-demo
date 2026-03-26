import logging
import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from routers import data, model, results, optimization

# ── Centralised logging config ───────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)-8s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
# Reduce noise from third-party libraries while keeping our code verbose
for _noisy in ("uvicorn.access", "httpx", "httpcore", "tensorflow", "jax",
               "absl", "h5py", "matplotlib"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="MMM Demo API",
    description="Marketing Mix Modeling demo powered by Google Meridian patterns",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router, prefix="/data", tags=["Data"])
app.include_router(model.router, prefix="/model", tags=["Model"])
app.include_router(results.router, prefix="/results", tags=["Results"])
app.include_router(optimization.router, prefix="/optimization", tags=["Optimization"])


@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info("→ %s %s", request.method, request.url.path)
    response = await call_next(request)
    logger.info("← %s %s  status=%d", request.method, request.url.path, response.status_code)
    return response


@app.get("/health")
def health():
    logger.debug("[health] ping")
    return {"status": "ok", "service": "MMM Demo API"}


logger.info("MMM Demo API starting — routers: /data /model /results /optimization")
