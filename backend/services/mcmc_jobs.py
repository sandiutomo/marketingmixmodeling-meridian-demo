# =============================================================================
# services/mcmc_jobs.py — The waiting room: running long tasks in the background
#
# MCMC sampling (the statistical process that trains the model) can take
# anywhere from a few minutes to tens of minutes depending on the dataset size
# and the number of sampling iterations chosen. That's too long to hold an HTTP
# connection open — browsers and proxies will time out.
#
# This module solves that by running the sampling work in a background thread
# and returning a job ID to the caller immediately. The frontend then polls
# GET /model/run/status/{job_id} every few seconds to check progress.
#
# How a job moves through its lifecycle:
#   queued → running → analyzing → complete  (happy path)
#   queued → running → error                  (if sampling fails)
#
# Each step of the sampling process calls a progress callback with a percentage
# (0–100) and a human-readable status message. The callback stores that into
# the job object so the polling endpoint always has something current to return.
#
# Memory management: we keep at most 50 jobs in memory. If more arrive, the
# 25 oldest are evicted. Since this is a single-user demo, hitting that limit
# would only happen through repeated testing, not normal use.
# =============================================================================

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class McmcJob:
    # Everything the polling endpoint needs to know about one sampling run.
    job_id: str
    status: str = "queued"  # queued | running | analyzing | complete | error
    progress: float = 0.0   # 0–100 percentage for the frontend progress bar
    message: str = ""        # human-readable description of what's happening now
    error: Optional[str] = None
    diagnostics: Optional[Dict[str, Any]] = None  # filled in when status = "complete"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


# In-memory store of all active and recently completed jobs.
# Protected by a lock because the background thread and the HTTP request
# handler thread will both read and write this dict concurrently.
_jobs: Dict[str, McmcJob] = {}
_lock = threading.Lock()


def _touch(job: McmcJob, **kwargs) -> None:
    # Convenience helper: update multiple fields on a job and stamp the time.
    for k, v in kwargs.items():
        setattr(job, k, v)
    job.updated_at = time.time()


def get_job(job_id: str) -> Optional[McmcJob]:
    with _lock:
        return _jobs.get(job_id)


def start_mcmc_job(run_fn: Callable[[Callable[[float, str], None]], Dict[str, Any]]) -> str:
    """
    run_fn receives a progress callback (pct 0-100, message) and must return
    the same diagnostics dict as ModelRunnerService.run().
    """
    job_id = str(uuid.uuid4())
    job = McmcJob(job_id=job_id)
    logger.info("[McmcJobs] New job created: job_id=%s", job_id)
    with _lock:
        _jobs[job_id] = job
        # Evict the oldest jobs if the store is getting too large.
        # In normal use this limit is never reached; it's a safeguard.
        if len(_jobs) > 50:
            stale = sorted(_jobs.items(), key=lambda x: x[1].updated_at)[:25]
            for k, _ in stale:
                _jobs.pop(k, None)
            logger.debug("[McmcJobs] Evicted %d stale jobs (total now %d)", len(stale), len(_jobs))

    def progress(pct: float, msg: str) -> None:
        # Called repeatedly by the sampling code as it advances through phases
        # (building InputData, running adaptation, running burn-in, kept draws…).
        # At 95% we flip the status to "analyzing" to signal that sampling is
        # done and we're now computing the summaries (ROI, R-hat, ESS, etc.).
        with _lock:
            j = _jobs.get(job_id)
            if j:
                _touch(j, progress=pct, message=msg, status="running" if pct < 95 else "analyzing")
        logger.info("[McmcJobs] job=%s  progress=%.1f%%  — %s", job_id[:8], pct, msg)

    def worker() -> None:
        # This function runs in its own thread. The main thread returns the
        # job_id to the HTTP caller while this runs in parallel.
        t0 = time.time()
        with _lock:
            j = _jobs.get(job_id)
            if j:
                _touch(j, status="running", progress=2, message="Preparing InputData & ModelSpec…")
        logger.info("[McmcJobs] job=%s  status=running  (thread started)", job_id[:8])
        try:
            def cb(p: float, m: str) -> None:
                progress(p, m)

            # This is the actual long-running work — hands off to MeridianRunner.
            result = run_fn(cb)
            elapsed = time.time() - t0
            with _lock:
                j = _jobs.get(job_id)
                if j:
                    _touch(
                        j,
                        status="complete",
                        progress=100,
                        message="Sampling complete.",
                        diagnostics=result,  # the full diagnostics dict from MeridianRunner
                    )
            logger.info("[McmcJobs] job=%s  status=complete  elapsed=%.1fs  is_real_meridian=%s",
                        job_id[:8], elapsed, result.get('is_real_meridian'))
        except Exception as e:
            logger.error("[McmcJobs] job=%s  status=error  elapsed=%.1fs  error=%s",
                         job_id[:8], time.time() - t0, e, exc_info=True)
            with _lock:
                j = _jobs.get(job_id)
                if j:
                    _touch(j, status="error", error=str(e), message="Job failed.", progress=0)

    # daemon=True means the thread won't block the server from shutting down.
    threading.Thread(target=worker, daemon=True).start()
    return job_id
