# =============================================================================
# main.py — The front door of the Marketing Mix Modeling platform
#
# This file is where the whole backend comes to life. Think of it as the lobby
# of a building: it sets the ground rules, points visitors to the right rooms,
# and keeps a record of everyone who walks in and out.
#
# The platform answers one core business question:
#   "Given a marketing budget, which channels drove the most sales —
#    and how should we redistribute spend to do even better?"
#
# To answer that, we need four things to work in sequence:
#   1. Load and prepare the raw marketing data          → /data
#   2. Train a statistical model on that data           → /model
#   3. Read back what the model learned                 → /results
#   4. Run budget scenarios through the model           → /optimization
#
# Everything below wires those four steps into a single running API.
# =============================================================================

import logging
import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from routers import data, model, results, optimization

# -----------------------------------------------------------------------------
# Chapter 1 — Setting up a diary
#
# Before we do any real work, we set up logging. Logging is just the app
# writing a timestamped diary of everything that happens while it runs.
# Each line records the time, how serious the message is (DEBUG / INFO /
# WARNING / ERROR), and which part of the code wrote it.
#
# We write everything to the terminal (stdout) so it's visible in real time —
# useful when running locally or watching a cloud deployment's log stream.
# -----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)-8s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)

# Third-party libraries like TensorFlow, JAX, and Matplotlib are very chatty
# at DEBUG level — they'd flood the diary with internal housekeeping notes that
# aren't useful to us. We turn those down to WARNING so only genuinely
# important messages from them come through, while our own code stays verbose.
for _noisy in ("uvicorn.access", "httpx", "httpcore", "tensorflow", "jax",
               "absl", "h5py", "matplotlib"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# Chapter 2 — Opening the building
#
# FastAPI is the web framework that turns Python functions into HTTP endpoints
# — the URLs the frontend calls to get data back. We give the API a name and
# version so the auto-generated docs page (available at /docs when the server
# is running) is self-describing and easy to share with teammates.
# -----------------------------------------------------------------------------
app = FastAPI(
    title="Marketing Mix Model Studio API",
    description="Marketing Mix Model Studio — powered by Google Meridian",
    version="1.0.0",
)

# -----------------------------------------------------------------------------
# Chapter 3 — Deciding who is allowed inside
#
# Browsers have a security rule called CORS (Cross-Origin Resource Sharing).
# It means a webpage hosted at one address is normally blocked from talking to
# an API sitting at a different address — a safeguard against malicious sites
# quietly calling your API on a user's behalf.
#
# We explicitly tell the browser: "It's fine, the frontend at localhost:3000
# has permission to call this API." Without this, every request from the React
# app would be silently blocked by the browser before it even reached us.
# -----------------------------------------------------------------------------
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

# -----------------------------------------------------------------------------
# Chapter 4 — Hanging up the signposts
#
# The platform's four analytical steps each live in their own router file
# under /routers/. Here we attach them to the main app and give each one a
# URL prefix so requests are routed to the right place:
#
#   /data         — upload or generate the marketing dataset
#   /model        — train the Bayesian regression model on that dataset
#   /results      — fetch what the trained model learned (coefficients,
#                   channel contributions, model fit statistics, etc.)
#   /optimization — run "what-if" budget scenarios through the model to find
#                   the spend allocation that maximises predicted revenue
#
# The tags are just labels that group endpoints together on the /docs page.
# -----------------------------------------------------------------------------
app.include_router(data.router, prefix="/data", tags=["Data"])
app.include_router(model.router, prefix="/model", tags=["Model"])
app.include_router(results.router, prefix="/results", tags=["Results"])
app.include_router(optimization.router, prefix="/optimization", tags=["Optimization"])

# -----------------------------------------------------------------------------
# Chapter 5 — The doorman who logs every visitor
#
# This middleware function runs for every single HTTP request that arrives,
# before the request reaches the actual endpoint, and again after the endpoint
# sends its response. Think of it as a doorman who notes in the diary:
#   "→ Someone just walked in asking for /model/train"
#   "← They left and we sent them back a 200 (success)"
#
# Having both the incoming arrow (→) and the outgoing arrow (←) makes it easy
# to spot which requests are slow, which ones are failing, and in what order
# things happened when debugging a problem.
# -----------------------------------------------------------------------------
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info("→ %s %s", request.method, request.url.path)
    response = await call_next(request)
    logger.info("← %s %s  status=%d", request.method, request.url.path, response.status_code)
    return response

# -----------------------------------------------------------------------------
# Chapter 6 — The "are you still there?" check
#
# Load balancers, monitoring tools, and the frontend itself occasionally ping
# /health just to confirm the server is alive and responding. This endpoint
# does nothing fancy — it simply says "yes, I'm here and my name is Marketing Mix Model Studio
# API." If this call ever fails, something is seriously wrong with the server.
# -----------------------------------------------------------------------------
@app.get("/health")
def health():
    logger.debug("[health] ping")
    return {"status": "ok", "service": "Marketing Mix Model Studio API"}

# -----------------------------------------------------------------------------
# Epilogue — The building is open
#
# This line runs once at startup, writing a single diary entry that confirms
# all four routers registered successfully and the API is ready to accept
# requests from the frontend.
# -----------------------------------------------------------------------------
logger.info("Marketing Mix Model Studio API starting — routers: /data /model /results /optimization")