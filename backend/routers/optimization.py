import logging
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict
from services.optimizer import OptimizerService

logger = logging.getLogger(__name__)

router = APIRouter()
optimizer = OptimizerService()


class OptimizationRequest(BaseModel):
    budget: float
    scenario: Optional[Dict] = None


@router.post("/run")
def run_optimization(req: OptimizationRequest):
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
