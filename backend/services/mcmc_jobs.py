"""Background MCMC jobs — in-process thread pool with polling-friendly status."""
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
    job_id: str
    status: str = "queued"  # queued | running | analyzing | complete | error
    progress: float = 0.0
    message: str = ""
    error: Optional[str] = None
    diagnostics: Optional[Dict[str, Any]] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


_jobs: Dict[str, McmcJob] = {}
_lock = threading.Lock()


def _touch(job: McmcJob, **kwargs) -> None:
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
        if len(_jobs) > 50:
            stale = sorted(_jobs.items(), key=lambda x: x[1].updated_at)[:25]
            for k, _ in stale:
                _jobs.pop(k, None)
            logger.debug("[McmcJobs] Evicted %d stale jobs (total now %d)", len(stale), len(_jobs))

    def progress(pct: float, msg: str) -> None:
        with _lock:
            j = _jobs.get(job_id)
            if j:
                _touch(j, progress=pct, message=msg, status="running" if pct < 95 else "analyzing")
        logger.info("[McmcJobs] job=%s  progress=%.1f%%  — %s", job_id[:8], pct, msg)

    def worker() -> None:
        t0 = time.time()
        with _lock:
            j = _jobs.get(job_id)
            if j:
                _touch(j, status="running", progress=2, message="Preparing InputData & ModelSpec…")
        logger.info("[McmcJobs] job=%s  status=running  (thread started)", job_id[:8])
        try:
            def cb(p: float, m: str) -> None:
                progress(p, m)

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
                        diagnostics=result,
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

    threading.Thread(target=worker, daemon=True).start()
    return job_id
