"""
Shared pytest fixtures for all backend tests.

Provides:
  - mock_channel_data   : minimal 3-channel spend/kpi numpy arrays
  - mock_loaded_data    : patches DataLoaderService._loaded_data with mock_channel_data
  - test_client         : FastAPI TestClient with the full app
"""

import sys
import os
import numpy as np
import pytest

# Ensure the backend source directory is on sys.path so imports resolve without
# installing the package (test runner invoked from backend/).
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient


@pytest.fixture
def mock_channel_data():
    """
    3-channel, 52-week, 1-geo synthetic dataset.

    spend_data : shape (52, 3)  — weekly spend per channel
    kpi_data   : shape (52,)    — weekly revenue
    channels   : ['tv', 'social', 'search']
    time_coords: 52 ISO-date strings starting 2022-01-03
    """
    rng = np.random.default_rng(42)
    n_weeks = 52
    n_channels = 3
    spend = rng.uniform(10_000, 100_000, size=(n_weeks, n_channels)).astype(np.float64)
    # Revenue loosely correlated with total spend + noise
    kpi = spend.sum(axis=1) * 2.5 + rng.normal(0, 50_000, size=n_weeks)
    kpi = np.clip(kpi, 0, None)

    import datetime
    start = datetime.date(2022, 1, 3)
    time_coords = [(start + datetime.timedelta(weeks=i)).isoformat() for i in range(n_weeks)]

    return {
        'spend_data':   spend,
        'kpi_data':     kpi,
        'channels':     ['tv', 'social', 'search'],
        'channel_labels': {'tv': 'TV', 'social': 'Social', 'search': 'Search'},
        'time_coords':  time_coords,
        'n_geos':       1,
        'n_times':      n_weeks,
        'n_channels':   n_channels,
        'total_revenue': float(kpi.sum()),
        'total_spend':   float(spend.sum()),
        'data_source':  'custom_csv',
        'currency':     'USD',
    }


@pytest.fixture
def mock_loaded_data(monkeypatch, mock_channel_data):
    """
    Patches DataLoaderService._loaded_data so OptimizerService and
    ResultsGeneratorService use the synthetic dataset instead of real files.
    """
    from services.data_loader import DataLoaderService
    monkeypatch.setattr(DataLoaderService, '_loaded_data', mock_channel_data)
    return mock_channel_data


@pytest.fixture
def test_client():
    """FastAPI TestClient wrapping the full application."""
    from main import app
    return TestClient(app)


@pytest.fixture
def mock_loaded_data_geo(monkeypatch):
    """
    4-geo, 52-week, 3-channel dataset for holdout design tests.

    spend_data : shape (4, 52, 3)  — geo × week × channel
    kpi_data   : shape (4, 52)     — geo × week
    geos       : ['geo_0', 'geo_1', 'geo_2', 'geo_3']
    """
    import datetime
    rng = np.random.default_rng(99)
    n_geos, n_weeks, n_channels = 4, 52, 3
    spend = rng.uniform(10_000, 100_000, (n_geos, n_weeks, n_channels)).astype(np.float64)
    kpi = spend.sum(axis=2) * 2.5 + rng.normal(0, 50_000, (n_geos, n_weeks))
    kpi = np.clip(kpi, 0, None)

    start = datetime.date(2022, 1, 3)
    time_coords = [(start + datetime.timedelta(weeks=i)).isoformat() for i in range(n_weeks)]

    data = {
        'spend_data':     spend,
        'kpi_data':       kpi,
        'channels':       ['tv', 'social', 'search'],
        'channel_labels': {'tv': 'TV', 'social': 'Social', 'search': 'Search'},
        'geos':           ['geo_0', 'geo_1', 'geo_2', 'geo_3'],
        'time_coords':    time_coords,
        'n_geos':         n_geos,
        'n_times':        n_weeks,
        'n_channels':     n_channels,
        'total_revenue':  float(kpi.sum()),
        'total_spend':    float(spend.sum()),
        'data_source':    'custom_csv',
        'currency':       'USD',
    }
    from services.data_loader import DataLoaderService
    monkeypatch.setattr(DataLoaderService, '_loaded_data', data)
    return data
