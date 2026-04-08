"""
Integration tests for POST /optimization/run.

Uses FastAPI TestClient to test the full request → router → service → response
pipeline, including Pydantic validation errors (422).
"""

import pytest


# ---------------------------------------------------------------------------
# Basic endpoint behaviour
# ---------------------------------------------------------------------------

class TestOptimizationRouterBasic:
    def test_post_run_returns_200(self, test_client):
        resp = test_client.post('/optimization/run', json={'budget': 1_000_000})
        assert resp.status_code == 200, resp.text

    def test_post_run_response_has_required_keys(self, test_client):
        resp = test_client.post('/optimization/run', json={'budget': 1_000_000})
        body = resp.json()
        assert 'status' in body
        assert 'optimal_allocation' in body
        assert 'projected_revenue' in body
        assert 'improvement_pct' in body
        assert 'is_real_meridian' in body

    def test_post_run_status_is_complete(self, test_client):
        resp = test_client.post('/optimization/run', json={'budget': 1_000_000})
        assert resp.json()['status'] == 'complete'

    def test_post_run_allocation_is_list(self, test_client):
        resp = test_client.post('/optimization/run', json={'budget': 1_000_000})
        alloc = resp.json()['optimal_allocation']
        assert isinstance(alloc, list)
        assert len(alloc) > 0

    def test_post_run_allocation_items_have_required_fields(self, test_client):
        resp = test_client.post('/optimization/run', json={'budget': 500_000})
        for item in resp.json()['optimal_allocation']:
            assert 'channel' in item
            assert 'current_spend' in item
            assert 'optimal_spend' in item
            assert 'change' in item
            assert 'change_pct' in item


# ---------------------------------------------------------------------------
# Budget validation
# ---------------------------------------------------------------------------

class TestOptimizationRouterBudgetValidation:
    def test_negative_budget_returns_422(self, test_client):
        resp = test_client.post('/optimization/run', json={'budget': -500})
        assert resp.status_code == 422, resp.text

    def test_zero_budget_returns_422(self, test_client):
        resp = test_client.post('/optimization/run', json={'budget': 0})
        assert resp.status_code == 422, resp.text

    def test_string_budget_returns_422(self, test_client):
        resp = test_client.post('/optimization/run', json={'budget': 'lots'})
        assert resp.status_code == 422, resp.text

    def test_missing_budget_returns_422(self, test_client):
        resp = test_client.post('/optimization/run', json={})
        assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# Per-channel constraint validation
# ---------------------------------------------------------------------------

class TestOptimizationRouterConstraintValidation:
    def test_valid_constraint_accepted(self, test_client):
        payload = {
            'budget': 1_000_000,
            'channel_constraints': {
                'TV': {'min_ratio': 0.05, 'max_ratio': 0.20},
            },
        }
        resp = test_client.post('/optimization/run', json=payload)
        assert resp.status_code == 200, resp.text

    def test_constraint_min_gt_max_returns_422(self, test_client):
        payload = {
            'budget': 1_000_000,
            'channel_constraints': {
                'TV': {'min_ratio': 0.80, 'max_ratio': 0.20},
            },
        }
        resp = test_client.post('/optimization/run', json=payload)
        assert resp.status_code == 422, resp.text

    def test_constraint_min_equals_max_returns_422(self, test_client):
        payload = {
            'budget': 1_000_000,
            'channel_constraints': {
                'TV': {'min_ratio': 0.30, 'max_ratio': 0.30},
            },
        }
        resp = test_client.post('/optimization/run', json=payload)
        assert resp.status_code == 422, resp.text

    def test_max_ratio_above_1_returns_422(self, test_client):
        payload = {
            'budget': 1_000_000,
            'channel_constraints': {
                'TV': {'min_ratio': 0.05, 'max_ratio': 1.5},
            },
        }
        resp = test_client.post('/optimization/run', json=payload)
        assert resp.status_code == 422, resp.text

    def test_constraint_cap_respected_in_output(self, test_client, mock_loaded_data):
        """TV capped at 20% of budget must not exceed that in the response."""
        total = 1_000_000
        payload = {
            'budget': total,
            'channel_constraints': {
                'TV': {'min_ratio': 0.05, 'max_ratio': 0.20},
            },
        }
        resp = test_client.post('/optimization/run', json=payload)
        assert resp.status_code == 200
        for item in resp.json()['optimal_allocation']:
            if item['channel'] == 'TV':
                share = item['optimal_spend'] / total
                assert share <= 0.201, f"TV share {share:.3f} > 20% cap"


# ---------------------------------------------------------------------------
# Optional frequency parameters
# ---------------------------------------------------------------------------

class TestOptimizationRouterFrequency:
    def test_use_optimal_frequency_accepted(self, test_client):
        payload = {
            'budget': 1_000_000,
            'use_optimal_frequency': True,
            'max_frequency': 8.0,
        }
        resp = test_client.post('/optimization/run', json=payload)
        assert resp.status_code == 200, resp.text

    def test_max_frequency_zero_returns_422(self, test_client):
        payload = {'budget': 1_000_000, 'max_frequency': 0}
        resp = test_client.post('/optimization/run', json=payload)
        assert resp.status_code == 422, resp.text
