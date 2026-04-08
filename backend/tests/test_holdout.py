"""
Unit + integration tests for ResultsGeneratorService.get_holdout_design()
and GET /results/holdout-design.

Covers:
  - National (single-geo) data → applicable=False
  - Geo data → applicable=True
  - treatment + control geos sum to n_geos
  - All geos appear in exactly one group
  - No overlap between groups
  - recommended_duration_weeks >= 4
  - Router returns 200
  - No data loaded → applicable=False
"""
import pytest


def _make_service():
    from services.results_generator import ResultsGeneratorService
    return ResultsGeneratorService()


# ---------------------------------------------------------------------------
# Single-geo (national) — not applicable
# ---------------------------------------------------------------------------

class TestHoldoutNationalData:
    def test_national_data_not_applicable(self, mock_loaded_data):
        """Single-geo (2D spend) dataset must return applicable=False."""
        svc = _make_service()
        result = svc.get_holdout_design()
        # mock_loaded_data has n_geos=1 and 2D spend_data
        assert result['applicable'] is False

    def test_national_result_has_required_keys(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_holdout_design()
        required = {'applicable', 'n_geos', 'treatment_geos', 'control_geos',
                    'assignments', 'recommended_duration_weeks', 'holdout_pct',
                    'method_note', 'is_real_meridian'}
        for key in required:
            assert key in result, f"Missing key: {key}"


# ---------------------------------------------------------------------------
# Multi-geo — applicable
# ---------------------------------------------------------------------------

class TestHoldoutGeoData:
    def test_geo_data_applicable(self, mock_loaded_data_geo):
        svc = _make_service()
        result = svc.get_holdout_design()
        assert result['applicable'] is True

    def test_treatment_plus_control_equals_total(self, mock_loaded_data_geo):
        svc = _make_service()
        result = svc.get_holdout_design()
        total = result['n_geos']
        assigned = len(result['treatment_geos']) + len(result['control_geos'])
        assert assigned == total

    def test_assignments_cover_all_geos(self, mock_loaded_data_geo):
        svc = _make_service()
        result = svc.get_holdout_design()
        all_assigned = set(result['treatment_geos']) | set(result['control_geos'])
        expected_geos = set(mock_loaded_data_geo['geos'])
        assert all_assigned == expected_geos

    def test_no_overlap_between_groups(self, mock_loaded_data_geo):
        svc = _make_service()
        result = svc.get_holdout_design()
        overlap = set(result['treatment_geos']) & set(result['control_geos'])
        assert overlap == set()

    def test_recommended_duration_at_least_4_weeks(self, mock_loaded_data_geo):
        svc = _make_service()
        result = svc.get_holdout_design()
        assert result['recommended_duration_weeks'] >= 4

    def test_assignments_list_covers_all_geos(self, mock_loaded_data_geo):
        svc = _make_service()
        result = svc.get_holdout_design()
        assigned_geos = {a['geo'] for a in result['assignments']}
        expected_geos = set(mock_loaded_data_geo['geos'])
        assert assigned_geos == expected_geos

    def test_assignment_groups_valid(self, mock_loaded_data_geo):
        svc = _make_service()
        result = svc.get_holdout_design()
        for a in result['assignments']:
            assert a['group'] in ('treatment', 'control')


# ---------------------------------------------------------------------------
# No data
# ---------------------------------------------------------------------------

class TestHoldoutNoData:
    def test_no_data_returns_not_applicable(self, monkeypatch):
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        result = svc.get_holdout_design()
        assert result['applicable'] is False


# ---------------------------------------------------------------------------
# Router integration
# ---------------------------------------------------------------------------

class TestHoldoutRouter:
    def test_router_returns_200(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/holdout-design')
        assert resp.status_code == 200
        body = resp.json()
        assert 'applicable' in body

    def test_router_geo_data_returns_200(self, test_client, mock_loaded_data_geo):
        resp = test_client.get('/results/holdout-design')
        assert resp.status_code == 200
        body = resp.json()
        assert body['applicable'] is True
