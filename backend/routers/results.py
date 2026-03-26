import logging
from fastapi import APIRouter
from services.results_generator import ResultsGeneratorService

logger = logging.getLogger(__name__)

router = APIRouter()
generator = ResultsGeneratorService()


@router.get("")
def get_results():
    logger.info("[Router/results] GET /results  (all results bundle)")
    return generator.get_all_results()


@router.get("/roi")
def get_roi():
    logger.debug("[Router/results] GET /results/roi")
    return generator.get_roi()


@router.get("/contribution")
def get_contribution():
    logger.debug("[Router/results] GET /results/contribution")
    return generator.get_contribution()


@router.get("/diagnostics")
def get_diagnostics():
    logger.debug("[Router/results] GET /results/diagnostics")
    return generator.get_diagnostics()


@router.get("/hill_params")
def get_hill_params():
    logger.debug("[Router/results] GET /results/hill_params")
    return generator.get_hill_params()


@router.get("/adstock")
def get_adstock_params():
    logger.debug("[Router/results] GET /results/adstock")
    return generator.get_adstock_params()


@router.get("/geo")
def get_geo_breakdown():
    logger.debug("[Router/results] GET /results/geo")
    return generator.get_geo_breakdown()
