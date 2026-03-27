# MMM Studio — Marketing Mix Modeling

A full-stack Marketing Mix Modeling platform powered by **Google Meridian** — real Bayesian MCMC inference, not a simulation. Built as a credible demo that works end-to-end with real data even when Meridian is not installed, via a correlation-based fallback.

---

## Quick Start

### Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | 18+ | Frontend (Next.js) |
| Python | 3.11+ | google-meridian (confirmed on 3.13 via Homebrew) |
| Python | 3.9 | Backend-only mode (no MCMC, correlation fallback) |

### 1. Backend

```bash
cd backend

# Python 3.13 venv (full Meridian MCMC)
/opt/homebrew/bin/python3.13 -m venv venv313
source venv313/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

Backend runs at **http://localhost:8001** · Swagger UI at **http://localhost:8000/docs**

```bash
curl http://localhost:8001/health
# → {"status":"ok","service":"MMM Demo API"}
```

> **Python 3.9 venv**: If google-meridian is unavailable, the backend still runs. All endpoints respond normally — results use the correlation-based fallback instead of real MCMC posteriors.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at **http://localhost:3000**

---

## How It Works

### User Flow (3-step wizard)

1. **Select dataset** — choose from 5 built-in datasets or upload your own CSV
2. **Configure model** — set date range, geos, channels, MCMC settings (chains, adapt, burnin, keep), adstock, priors, calibration periods, holdout
3. **Run model** — backend fits Meridian or falls back to correlation; 6 insight tabs unlock

### Frontend (browser)

- CSV is fetched from `/public/data/` and parsed client-side
- **Correlation-based attribution** runs immediately as a preview:
  - Pearson correlation × spend weights attribute the 85% media-driven revenue fraction
  - ROI = attributed revenue / total spend per channel
  - mROI = slope of Hill saturation curve at current spend
  - Saturation status = mROI / ROI ratio (< 0.55 saturated, < 0.80 efficient, else room to grow)
  - 90% credible interval width estimated from coefficient of variation
- Preview numbers show in all tabs instantly; real posterior replaces them after backend completes

### Backend (real Meridian MCMC)

When **Run Model** is clicked, the backend:

1. Loads the selected CSV into numpy arrays via `DataLoaderService`
2. Builds `InputData` via `NDArrayInputDataBuilder` — kpi, media spend, RF reach/frequency, control variables
3. Constructs `ModelSpec` — adstock decay, prior type, media effects distribution, holdout mask, calibration period boolean mask
4. Fits `Meridian(input_data=..., model_spec=...)` using `model.sample_posterior(n_chains, n_adapt, n_burnin, n_keep, seed)`
5. Extracts real posterior results via `Analyzer`:
   - `summary_metrics(confidence_level=0.9)` → ROI mean + 90% CI + incremental outcome per channel
   - `rhat_summary()` → R-hat convergence diagnostics per parameter
   - `predictive_accuracy()` → R² and MAPE
   - `hill_curves()` → saturation curve values; ec/slope fitted via `scipy.optimize.curve_fit`
   - `adstock_decay()` → geometric decay rate at lag=1 per channel
6. ArviZ computes ESS and BFMI from `model.inference_data` (posterior quality indicators)
7. Real posterior results replace the illustrative numbers throughout all UI tabs

### Graceful Fallback Chain

```
Real Meridian MCMC (Python 3.11+ with google-meridian)
  └─ if unavailable → Correlation-based attribution (Pearson × spend weights)
       └─ if no data loaded → Static hardcoded demo values
```

All layers return the same API response shape. `is_real_meridian: true/false` distinguishes them.

---

## Data Sources

| ID | File | Channels | Notes |
|---|---|---|---|
| `geo_no_rf` | `geo_media.csv` | TV, Paid Search, Social, Display | Geo-level, no reach/frequency |
| `geo_with_rf` | `geo_media_rf.csv` | TV, Paid Search, Social, YouTube | Geo-level with RF (YouTube) |
| `geo_organic` | `geo_all_channels.csv` | TV, Paid Search, Social, Display, OOH | Geo-level + organic channels |
| `national` | `national_all_channels.csv` | TV, Radio, Paid Search, Social, Display | National aggregate |
| `indonesia` | `indonesia.csv` | OOH, TikTok, Shopee, Tokopedia, Instagram, YouTube, Google Ads, Meta | Indonesian e-commerce · IDR currency |

All CSVs follow the Meridian column schema:
`time`, `geo`, `conversions`, `revenue_per_conversion`, `Channel0_spend`, `Channel1_spend`, ...

Reach/frequency datasets also include: `Channel{i}_reach`, `Channel{i}_frequency`

Control variables: `competitor_activity_score_control`, `competitor_sales_control`, `sentiment_score_control`

### Upload Your Own CSV

POST to `/data/upload` (multipart form) or use the UI upload panel. The ingest service auto-detects:
- Time column (`time`, `date`, `week`, `period`, or first date-like column)
- Revenue column (`revenue`, `sales`, `conversions`, `kpi`)
- Spend columns (`*_spend`, `*_cost`, `*_budget`)
- Geo column (optional — triggers geo-level model)

---

## Features

### Modeling
- **Real Meridian MCMC** — `model.sample_posterior()` with configurable chains, adapt steps, burnin, keep draws
- **Background MCMC jobs** — non-blocking; poll `GET /model/run/status/{job_id}` for progress %
- **Calibration periods** — geo-holdout or matched-market experiments wired to `roi_calibration_period` boolean mask
- **Per-channel ROI priors** — UI-configurable LogNormal(μ, σ) on `roi_m` / `roi_rf` via `PriorDistribution`
- **RF channels** — reach × frequency via `builder.with_reach()` (geo_with_rf dataset)
- **Control variables** — competitor activity score, competitor sales, sentiment score auto-detected from CSV
- **Holdout masking** — last N% of time periods excluded via `holdout_id` boolean matrix

### Results & Diagnostics
- **6 model health checks** — Convergence (R-hat), Baseline Health, Prediction Fit, Accuracy, Data Signal, ROI Consistency
- **R-hat bar chart** — per-parameter convergence (green < 1.1, amber 1.1–1.2, red ≥ 1.2)
- **ESS + BFMI** — ArviZ effective sample size and Bayesian Fraction of Missing Information
- **Actual vs Predicted** — model fit quality chart over the last 26 weeks
- **mROI (Marginal ROI)** — return on the next dollar, with saturation status badges
- **Spend-Response Curves** — Hill saturation curves with Current and Recommended reference lines
- **Adstock / carryover** — geometric decay rates per channel from posterior or channel-type heuristics
- **90% Credible Intervals** — posterior uncertainty shown in ROI Reliability table and CI bar chart

### Budget Optimization

Two paths depending on environment:

| Path | When | Method |
|---|---|---|
| **Real** | Meridian ran + `_last_model` is set | `BudgetOptimizer(meridian=model).optimize()` from `meridian.analysis.optimizer` |
| **Fallback** | No fitted model | Proportional rebalance — ROI^0.5 weights, 5%–50% per-channel bounds |

**getMROI fix** — the frontend fallback `computeOptimizedAllocation` previously computed marginal ROI without the Hill scale factor, causing lower-spend channels to always rank higher (mROI ∝ 1/spend). Now multiplied by `h.scale` for correct relative ordering.

**Safety check** — if optimized allocation projects lower revenue than current, the optimizer returns current allocation unchanged.

### Insight Tabs

| Tab | What it shows |
|---|---|
| **Budget Allocation** | Current vs optimized spend per channel; ROI Reliability table with 90% CI and confidence badges; Portfolio ROI (spend-weighted) |
| **Measuring True ROI** | ROI bar chart with CI bands; CI width chart; full posterior credible interval table |
| **Scenario Planning** | Per-channel spend sliders; real total budget from data (not hardcoded); bar chart of projected revenue delta per channel (linear model with diminishing returns for increases) |
| **Channel Contribution** | Pie chart of media-attributed revenue share; base vs media split |
| **Cross-Channel Impact** | Interaction and halo effects between channels |
| **Geo Breakdown** | Per-geo portfolio ROI, spend, and revenue |

### IDR Currency Support
- Indonesia dataset automatically shows values in Indonesian Rupiah
- All number formatting is IDR-aware: `Rp 1.2T`, `Rp 450B`, `Rp 13.7B`
- Diminishing returns chart labels "per Rp 1,000" (not "per Rp 1") for correct denomination display
- Scenario Planning budget slider and revenue projections use raw IDR values from data

---

## Key Design Decisions

### Scenario Planning — Linear Model (not Hill)

Scenario revenue projection uses a linear model with a diminishing returns penalty, not the Hill saturation function:

```
satFactor = max(0.70, 1 - adjPct / 250)    # only for spend increases
projectedRevenue = newSpend × roi × satFactor
```

**Why not Hill:** The Hill function requires ec (half-saturation point) and spend to be in matching units. When `scaledBase` is raw IDR (e.g. 1.1T) and `ec` is derived from a different scale, both current and projected land near `maxResponse`, producing near-zero deltas that are invisible on the bar chart. The linear model guarantees visible changes: at −30% spend the bar shows −30% revenue; at +30% spend the bar shows ~+14% (satFactor = 0.88).

### Portfolio ROI — Spend-Weighted Average

Portfolio ROI shown at the bottom of the ROI Reliability table is:

```
Portfolio ROI = Total attributed revenue ÷ Total spend
```

This is **not** a simple average of channel ROIs. High-spend channels (e.g. TV) pull it toward their ROI. A channel with 2× the spend has 2× the weight. The table footer explains this calculation inline so users making budget decisions have the right mental model.

### 90% Credible Intervals in Budget Allocation

CI information is surfaced directly in the Budget Allocation tab (ROI Reliability table) — not only in the Measuring True ROI tab. This is intentional: users making budget decisions in the allocation tab should not need to navigate away to assess confidence. The table shows:
- ROI point estimate
- 90% CI range [lower, upper]
- Reliability badge: High (CV < 0.35) · Medium (CV < 0.65) · Low (CV ≥ 0.65)

---

## Project Structure

```
mmm-demo/
├── backend/
│   ├── main.py                      # FastAPI app, CORS, router registration, logging config
│   ├── requirements.txt             # Python deps (requires Python 3.11+)
│   ├── venv313/                     # Python 3.13 venv with google-meridian installed
│   ├── routers/
│   │   ├── data.py                  # POST /data/load, POST /data/upload, GET /data/sources
│   │   ├── model.py                 # POST /model/configure, /model/run, /model/run/start
│   │   │                            #   GET /model/run/status/{job_id}, /model/status
│   │   ├── results.py               # GET /results, /results/roi, /results/contribution,
│   │   │                            #   /results/diagnostics, /results/hill_params,
│   │   │                            #   /results/adstock, /results/geo
│   │   └── optimization.py          # POST /optimization/run
│   ├── services/
│   │   ├── meridian_runner.py       # Full Meridian pipeline: NDArrayInputDataBuilder →
│   │   │                            #   ModelSpec + PriorDistribution → sample_posterior →
│   │   │                            #   Analyzer (ROI/CI/Rhat/R²/MAPE/Hill/Adstock) → ArviZ ESS/BFMI
│   │   ├── model_runner.py          # Orchestrator — calls MeridianRunner, handles fallbacks
│   │   ├── data_loader.py           # CSV → numpy arrays (spend, kpi, controls, RF)
│   │   ├── results_generator.py     # Real posterior → UI payload; correlation fallback
│   │   ├── optimizer.py             # BudgetOptimizer (real) or proportional rebalance (fallback)
│   │   ├── csv_ingest.py            # Auto-detect schema for uploaded CSVs
│   │   └── mcmc_jobs.py             # Background thread job queue with progress polling
│   └── data/
│       └── meridian_sample/         # Official Meridian simulated_data CSVs
│           ├── geo_media.csv
│           ├── geo_media_rf.csv
│           ├── geo_all_channels.csv
│           ├── national_all_channels.csv
│           └── indonesia.csv
│
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx             # Main page: 3-step wizard + 6 result tabs
    │   │   ├── layout.tsx           # Root layout, global fonts
    │   │   └── globals.css          # Tailwind base styles
    │   ├── components/
    │   │   ├── tabs/
    │   │   │   ├── BudgetAllocation.tsx    # Optimizer + ROI Reliability table (90% CI)
    │   │   │   ├── MeasuringROI.tsx        # CI bar chart, full credible interval table
    │   │   │   ├── ScenarioPlanning.tsx    # Spend sliders, linear revenue projection, dynamic bars
    │   │   │   ├── ChannelContribution.tsx # Pie chart, media vs base split
    │   │   │   ├── CrossChannelImpact.tsx  # Halo + interaction effects
    │   │   │   └── GeoBreakdown.tsx        # Per-geo ROI table
    │   │   ├── charts/
    │   │   │   ├── SpendResponseChart.tsx  # Hill curve with Current + Recommended reference lines
    │   │   │   ├── DiminishingReturnsChart.tsx  # mROI vs spend; IDR "per Rp 1,000" label
    │   │   │   ├── ROIBarChart.tsx          # ROI with CI error bars
    │   │   │   └── ContributionPieChart.tsx
    │   │   ├── model/
    │   │   │   ├── ModelConfigPanel.tsx    # MCMC settings, priors, calibration periods
    │   │   │   ├── ModelDiagnosticsPanel.tsx  # R-hat bar chart, health checks
    │   │   │   └── CodeExecutionButton.tsx # Shows generated Python code
    │   │   ├── data/
    │   │   │   ├── DataSourcePanel.tsx     # Dataset selector + CSV upload
    │   │   │   └── DataPreviewModal.tsx    # Column preview before running
    │   │   ├── insights/
    │   │   │   ├── ExportModal.tsx         # Export results to CSV/JSON
    │   │   │   ├── InsightsPanel.tsx       # Auto-generated narrative insights
    │   │   │   ├── PlanningCycleSummary.tsx
    │   │   │   └── AdstockPanel.tsx        # Carryover decay visualization
    │   │   └── ui/
    │   │       └── MeridianBadge.tsx       # "Powered by Meridian" badge (real vs fallback)
    │   └── lib/
    │       ├── compute.ts           # Client-side correlation attribution (preview)
    │       ├── types.ts             # TypeScript interfaces (ModelResults, ChannelResult, etc.)
    │       ├── format.ts            # Number formatting — USD / IDR aware (fmt, fmtDelta, fmtPct)
    │       └── api.ts               # Backend API calls with typed responses
    └── public/
        └── data/                    # CSV files served statically (mirrors backend/data/meridian_sample/)
```

---

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Recharts |
| Backend | FastAPI, Python 3.13, google-meridian 1.5.3, TensorFlow Probability |
| Modeling | Google Meridian — Bayesian MMM with NUTS MCMC |
| Diagnostics | ArviZ — ESS, BFMI from `model.inference_data` |
| Curve fitting | SciPy `curve_fit` — Hill ec/slope from `analyzer.hill_curves()` output |
| Fallback | Pearson correlation attribution (client-side + backend) |

---

## Logging

### Backend (Python — uvicorn console)

Configured in `main.py` with level `DEBUG`. Format:

```
YYYY-MM-DD HH:MM:SS [LEVEL   ] module — message
```

Third-party noise (`tensorflow`, `jax`, `absl`, `uvicorn.access`, `httpx`) is silenced to `WARNING`. All application modules log `DEBUG` / `INFO` / `WARNING` / `ERROR`.

| Prefix | File | What is logged |
|---|---|---|
| `[main]` | `main.py` | Every HTTP request method + path; response status code |
| `[Router/data]` | `routers/data.py` | `POST /data/load` data_source; upload filename + bytes; load summary |
| `[DataLoader]` | `services/data_loader.py` | CSV path + row count; detected columns; n_geos / n_times / n_channels; RF indices; control columns; per-channel spend; total_revenue / total_spend / ratio |
| `[Router/model]` | `routers/model.py` | Configure params (channels, geos, n_chains, n_keep); sync run start/complete; background job ID |
| `[ModelRunner]` | `services/model_runner.py` | Configure summary; data shape; Meridian attempt; elapsed time; R-hat / R² / MAPE / ESS; fallback reason + error |
| `[MeridianRunner]` | `services/meridian_runner.py` | Input array shapes; media vs RF split; InputData build time; ModelSpec params; calibration mask period count; holdout period count; prior draws; posterior n_chains / n_adapt / n_burnin / n_keep; per-phase elapsed; per-channel ROI mean + 90% CI; R-hat max/mean/all_below_1.2; R² / MAPE; ESS min/mean; BFMI mean; per-channel Hill ec/slope/maxResponse; per-channel adstock decay rate; total fit elapsed |
| `[ResultsGenerator]` | `services/results_generator.py` | Path selected (real / correlation / static); per-channel ROI / CI / confidence / Pearson r; geo breakdown errors |
| `[Optimizer]` | `services/optimizer.py` | Budget + scenario; per-channel spend / ROI / revenue; Meridian BudgetOptimizer attempt vs proportional rebalance; per-channel current → optimal + % change; projected revenue + improvement % |
| `[McmcJobs]` | `services/mcmc_jobs.py` | Job UUID created; progress % + message at every MCMC phase; complete with elapsed + is_real_meridian; error with traceback |

**Sample output — full Indonesia run:**

```
2025-01-15 10:23:01 [INFO    ] routers.data — [Router/data] POST /data/load  data_source=indonesia
2025-01-15 10:23:01 [INFO    ] services.data_loader — [DataLoader] Dimensions: n_geos=1  n_times=200  n_channels=8  has_geo=False
2025-01-15 10:23:01 [INFO    ] services.data_loader — [DataLoader] Loaded — total_revenue=452317891200.00  total_spend=19404800000.00  ratio=23.31
2025-01-15 10:23:04 [INFO    ] services.meridian_runner — [MeridianRunner] sample_posterior: n_chains=4  n_adapt=1000  n_burnin=500  n_keep=1000  seed=42
2025-01-15 10:26:44 [INFO    ] services.meridian_runner — [MeridianRunner] MCMC posterior sampling done (219.3s)
2025-01-15 10:26:47 [INFO    ] services.meridian_runner — [MeridianRunner] ROI  channel_0             mean=2.8412  ci_lo=1.9831  ci_hi=3.7204
2025-01-15 10:26:47 [INFO    ] services.meridian_runner — [MeridianRunner] R-hat: max=1.0042  mean=1.0011  all_below_1.2=True
2025-01-15 10:26:47 [INFO    ] services.meridian_runner — [MeridianRunner] Predictive accuracy: R²=0.9631  MAPE=0.0421
2025-01-15 10:26:48 [INFO    ] services.optimizer — [Optimizer] optimize(): total_budget=19404800000.00
2025-01-15 10:26:48 [INFO    ] services.optimizer — [Optimizer] Proportional rebalance: improvement=+4.2%
```

To filter only app logs:
```bash
uvicorn main:app --reload --port 8000 2>&1 | grep -E "\[(INFO|DEBUG|WARNING|ERROR)"
```

### Frontend (browser DevTools Console)

| Log | When |
|---|---|
| `[compute] Correlation attribution complete` | Client-side preview computed after CSV parsed |
| `[api] POST /data/load` | Dataset load request sent |
| `[api] POST /model/run/start` | Background MCMC job queued |
| `[api] polling job_id=... progress=XX%` | Progress polling during MCMC |
| `[api] POST /optimization/run` | Budget optimizer called |

---

## Validation

To confirm real Meridian is running (not correlation fallback):

```bash
# 1. Load data
curl -X POST http://localhost:8000/data/load \
  -H "Content-Type: application/json" \
  -d '{"data_source": "geo_no_rf"}'

# 2. Configure
curl -X POST http://localhost:8000/model/configure \
  -H "Content-Type: application/json" \
  -d '{"startDate":"2020-01-01","endDate":"2022-12-31","geos":["geo_1"],
       "channels":["tv","paid_search","social","display"],
       "nChains":4,"nAdapt":500,"nBurnin":200,"nKeep":500,
       "maxLag":8,"adstockDecay":"geometric","mediaPriorType":"roi","holdoutPct":0}'

# 3. Run (synchronous — blocks until complete)
curl -X POST http://localhost:8000/model/run

# 4. Check — "is_real_meridian": true confirms real MCMC
curl http://localhost:8000/results/diagnostics
```

**Real results:** `"is_real_meridian": true`, R-hat values vary per parameter, uvicorn console shows per-channel ROI posteriors + elapsed MCMC time.

**Fallback results:** `"is_real_meridian": false`, R-hat values deterministic from spend CV (1.002–1.011).

### Background job (non-blocking)

```bash
# Start job
JOB=$(curl -s -X POST http://localhost:8000/model/run/start | jq -r '.job_id')

# Poll
curl http://localhost:8000/model/run/status/$JOB
# → {"status":"running","progress":44.0,"message":"sample_posterior: adaptation + burn-in..."}

# When complete
# → {"status":"complete","progress":100,"diagnostics":{...}}
```