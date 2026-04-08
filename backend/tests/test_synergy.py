"""
Unit + integration tests for ResultsGeneratorService.get_synergy()
and GET /results/synergy.

Covers:
  - Result has required keys (channels, matrix, pairs, method)
  - Matrix is n×n square
  - Diagonal elements are 1.0
  - Matrix is symmetric
  - All pair correlations in [-1, 1]
  - Pairs sorted by abs(correlation) descending
  - No data loaded → empty result
  - Router returns 200
"""
import pytest
import math


def _make_service():
    from services.results_generator import ResultsGeneratorService
    return ResultsGeneratorService()


# ---------------------------------------------------------------------------
# Structure tests
# ---------------------------------------------------------------------------

class TestSynergyStructure:
    def test_result_has_required_keys(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_synergy()
        assert 'channels' in result
        assert 'matrix' in result
        assert 'pairs' in result
        assert 'method' in result

    def test_matrix_is_square(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_synergy()
        n = len(result['channels'])
        assert n > 0
        assert len(result['matrix']) == n
        for row in result['matrix']:
            assert len(row) == n

    def test_diagonal_is_one(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_synergy()
        for i in range(len(result['channels'])):
            assert math.isclose(result['matrix'][i][i], 1.0, abs_tol=1e-6)

    def test_matrix_is_symmetric(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_synergy()
        m = result['matrix']
        n = len(m)
        for i in range(n):
            for j in range(n):
                assert math.isclose(m[i][j], m[j][i], abs_tol=1e-6)

    def test_correlation_in_range(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_synergy()
        for pair in result['pairs']:
            assert -1.0 <= pair['correlation'] <= 1.0

    def test_pairs_sorted_by_abs_correlation_descending(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_synergy()
        pairs = result['pairs']
        for i in range(len(pairs) - 1):
            assert abs(pairs[i]['correlation']) >= abs(pairs[i + 1]['correlation']) - 1e-9

    def test_interpretation_valid_values(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_synergy()
        valid = {'strong', 'moderate', 'weak', 'negative'}
        for pair in result['pairs']:
            assert pair['interpretation'] in valid

    def test_method_is_string(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_synergy()
        assert result['method'] in ('meridian', 'pearson', 'mock')


# ---------------------------------------------------------------------------
# Empty / no data
# ---------------------------------------------------------------------------

class TestSynergyNoData:
    def test_no_data_returns_empty(self, monkeypatch):
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        result = svc.get_synergy()
        assert result['channels'] == []
        assert result['matrix'] == []
        assert result['pairs'] == []
        assert result['method'] == 'mock'


# ---------------------------------------------------------------------------
# Router integration
# ---------------------------------------------------------------------------

class TestSynergyRouter:
    def test_router_returns_200(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/synergy')
        assert resp.status_code == 200
        body = resp.json()
        assert 'channels' in body
        assert 'matrix' in body
        assert 'pairs' in body
