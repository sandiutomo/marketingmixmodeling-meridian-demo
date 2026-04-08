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
# allocation that maximises projected revenue, subject to constraints.
#
# Two constraint modes:
#   - Global defaults  : floor 5%, cap 50% per channel (diversification)
#   - Per-channel      : each channel can have its own min_ratio / max_ratio,
#                        matching Meridian's ChannelConstraintRel parameter
#
# Optional RF optimization:
#   - use_optimal_frequency : pass frequency-aware constraints to BudgetOptimizer
#   - max_frequency         : upper limit for frequency (recommended ≤ 10 when
#                             source data rows > 30; mirrors the notebook's param)
#
# If Google Meridian's BudgetOptimizer is available (Python 3.11+), it uses
# the full posterior to find the optimal allocation. Otherwise, it falls back
# to a simpler ROI-weighted proportional rebalance.
# =============================================================================

import logging
from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from typing import Optional, Dict
from services.optimizer import OptimizerService

logger = logging.getLogger(__name__)

router = APIRouter()
optimizer = OptimizerService()


class ChannelConstraint(BaseModel):
    """
    Per-channel spend bounds expressed as a fraction of the total budget.

    Mirrors Meridian's ChannelConstraintRel — each channel can have its own
    min and max ratio independently of other channels.

    min_ratio : minimum fraction of total budget this channel must receive
                (e.g. 0.05 = at least 5% of budget)
    max_ratio : maximum fraction of total budget this channel may receive
                (e.g. 0.20 = no more than 20% of budget)
    """
    min_ratio: float = Field(0.05, ge=0.0, le=1.0,
                             description="Minimum fraction of total budget (0.0–1.0)")
    max_ratio: float = Field(0.50, ge=0.0, le=1.0,
                             description="Maximum fraction of total budget (0.0–1.0)")

    @model_validator(mode='after')
    def min_must_be_less_than_max(self):
        if self.min_ratio >= self.max_ratio:
            raise ValueError(
                f'min_ratio ({self.min_ratio}) must be strictly less than '
                f'max_ratio ({self.max_ratio})'
            )
        return self


class OptimizationRequest(BaseModel):
    budget: float = Field(..., gt=0,
                          description="Total budget to allocate across all channels")
    scenario: Optional[Dict] = None
    channel_constraints: Optional[Dict[str, ChannelConstraint]] = Field(
        None,
        description=(
            "Per-channel spend bounds keyed by channel display name (e.g. 'TV'). "
            "Channels not listed use the global defaults (5% floor, 50% cap). "
            "Mirrors Meridian's ChannelConstraintRel."
        ),
    )
    use_optimal_frequency: bool = Field(
        False,
        description=(
            "When True, pass frequency-aware constraints to BudgetOptimizer for "
            "reach-and-frequency channels. Requires RF channels in the loaded dataset."
        ),
    )
    max_frequency: float = Field(
        10.0,
        gt=0,
        description=(
            "Upper limit for frequency optimisation. Recommended ≤ 10 when the "
            "source data has more than 30 rows (matches Meridian notebook default)."
        ),
    )


@router.post("/run")
def run_optimization(req: OptimizationRequest):
    logger.info(
        "[Router/optimization] POST /optimization/run  budget=%.2f  "
        "has_constraints=%s  use_optimal_frequency=%s  max_frequency=%.1f  scenario=%s",
        req.budget,
        req.channel_constraints is not None,
        req.use_optimal_frequency,
        req.max_frequency,
        req.scenario,
    )
    result = optimizer.optimize(
        total_budget=req.budget,
        scenario=req.scenario,
        channel_constraints=req.channel_constraints,
        use_optimal_frequency=req.use_optimal_frequency,
        max_frequency=req.max_frequency,
    )
    logger.info(
        "[Router/optimization] complete: improvement_pct=%.1f%%  is_real=%s",
        result.get('improvement_pct', 0),
        result.get('is_real_meridian'),
    )
    return {
        "status": "complete",
        "optimal_allocation": result["allocation"],
        "projected_revenue": result["projected_revenue"],
        "improvement_pct": result["improvement_pct"],
        "is_real_meridian": result.get("is_real_meridian", False),
        "message": "Optimization complete. See recommended allocation below.",
    }
