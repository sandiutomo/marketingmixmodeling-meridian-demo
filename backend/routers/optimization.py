# =============================================================================
# routers/optimization.py — Act 4: Finding the best use of the budget
#
# This is the payoff endpoint — the reason the whole platform exists.
#
# After loading data and training the model, we know each channel's ROI and
# its diminishing-returns curve (the Hill function). Now we can ask:
#   "Given a total budget of X, how should we split it across channels
#    to get the most revenue?"
#
# The user sends a total budget figure; the optimizer works out the per-channel
# allocation that maximises projected revenue, subject to constraints:
#   - No single channel gets more than 50% of budget (diversification)
#   - No single channel gets less than 5% of budget (floor spend)
#
# If Google Meridian's BudgetOptimizer is available (Python 3.11+), it uses
# the full posterior to find the optimal allocation. Otherwise, it falls back
# to a simpler ROI-weighted proportional rebalance.
#
# The response shows, for each channel:
#   current_spend   — what was spent in the loaded dataset
#   optimal_spend   — the recommended spend under the new budget
#   change / change_pct — how much to shift money up or down
# =============================================================================

import logging
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict
from services.optimizer import OptimizerService

logger = logging.getLogger(__name__)

router = APIRouter()
optimizer = OptimizerService()


class OptimizationRequest(BaseModel):
    budget: float              # total budget to allocate across all channels
    scenario: Optional[Dict] = None  # reserved for future "what-if" overrides


@router.post("/run")
def run_optimization(req: OptimizationRequest):
    # Pass the budget to OptimizerService and get back the recommended
    # per-channel split along with the projected revenue uplift.
    logger.info("[Router/optimization] POST /optimization/run  budget=%.2f  scenario=%s",
                req.budget, req.scenario)
    result = optimizer.optimize(req.budget, req.scenario)
    logger.info("[Router/optimization] complete: improvement_pct=%.1f%%  is_real=%s",
                result.get('improvement_pct', 0), result.get('is_real_meridian'))
    return {
        "status": "complete",
        "optimal_allocation": result["allocation"],
        "projected_revenue": result["projected_revenue"],
        "improvement_pct": result["improvement_pct"],
        "is_real_meridian": result.get("is_real_meridian", False),
        "message": "Optimization complete. See recommended allocation below.",
    }
