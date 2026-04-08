"""
Unit + integration tests for ResultsGeneratorService.get_waterfall()
and GET /results/waterfall.

Covers:
  - Result has required keys (periods, channels, bars, is_real_meridian)
  - First bar for each channel has is_baseline=True
  - Delta math: delta == current_cumulative - prev_cumulative
  - No data loaded → empty result
  - Router returns 200 for valid periods
  - Router returns 422 for invalid period
  - All channels present in bars
"""
import pytest


def _make_service():
    from services.results_generator import ResultsGeneratorService
    return ResultsGeneratorService()


# ---------------------------------------------------------------------------
# Structure tests
# ---------------------------------------------------------------------------

class TestWaterfallStructure:
    def test_result_has_required_keys(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_waterfall('quarterly')
        assert 'periods' in result
        assert 'channels' in result
        assert 'bars' in result
        assert 'is_real_meridian' in result

    def test_quarterly_first_bars_are_baseline(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_waterfall('quarterly')
        bars = result['bars']
        assert len(bars) > 0
        first_period = result['periods'][0]
        baseline_bars = [b for b in bars if b['period'] == first_period]
        assert len(baseline_bars) > 0
        for b in baseline_bars:
            assert b['is_baseline'] is True

    def test_non_baseline_bars_are_not_baseline(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_waterfall('quarterly')
        if len(result['periods']) < 2:
            pytest.skip("Need at least 2 periods")
        second_period = result['periods'][1]
        non_baseline = [b for b in result['bars'] if b['period'] == second_period]
        for b in non_baseline:
            assert b['is_baseline'] is False

    def test_delta_math_correct(self, mock_loaded_data):
        """For non-baseline bars, delta == cumulative[n] - cumulative[n-1]."""
        svc = _make_service()
        result = svc.get_waterfall('quarterly')
        periods = result['periods']
        if len(periods) < 2:
            pytest.skip("Need at least 2 periods to check delta math")
        channels = result['channels'] + ['Base']
        for ch in channels:
            ch_bars = [b for b in result['bars'] if b['channel'] == ch]
            for i in range(1, len(ch_bars)):
                prev_cum = ch_bars[i - 1]['cumulative']
                cur_cum  = ch_bars[i]['cumulative']
                expected_delta = round(cur_cum - prev_cum, 2)
                actual_delta   = round(ch_bars[i]['delta'], 2)
                assert abs(actual_delta - expected_delta) <= 1.0, (
                    f"{ch} period {ch_bars[i]['period']}: "
                    f"delta={actual_delta} != cumulative diff={expected_delta}"
                )

    def test_all_channels_present_in_bars(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_waterfall('quarterly')
        bar_channels = {b['channel'] for b in result['bars']}
        for ch in result['channels']:
            assert ch in bar_channels
        assert 'Base' in bar_channels

    def test_baseline_cumulative_equals_delta(self, mock_loaded_data):
        """For baseline bars, cumulative should equal delta (both start from 0)."""
        svc = _make_service()
        result = svc.get_waterfall('quarterly')
        first_period = result['periods'][0]
        for b in result['bars']:
            if b['period'] == first_period:
                assert abs(b['cumulative'] - b['delta']) <= 1.0


# ---------------------------------------------------------------------------
# Empty / no data
# ---------------------------------------------------------------------------

class TestWaterfallNoData:
    def test_no_data_returns_empty(self, monkeypatch):
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        result = svc.get_waterfall('quarterly')
        assert result['periods'] == []
        assert result['channels'] == []
        assert result['bars'] == []
        assert result['is_real_meridian'] is False


# ---------------------------------------------------------------------------
# Router integration
# ---------------------------------------------------------------------------

class TestWaterfallRouter:
    def test_router_valid_period_returns_200(self, test_client, mock_loaded_data):
        for period in ('quarterly', 'monthly', 'yearly', 'weekly'):
            resp = test_client.get(f'/results/waterfall?period={period}')
            assert resp.status_code == 200, f"Expected 200 for period={period}, got {resp.status_code}"

    def test_router_invalid_period_returns_422(self, test_client):
        resp = test_client.get('/results/waterfall?period=daily')
        assert resp.status_code == 422

    def test_router_default_period_returns_200(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/waterfall')
        assert resp.status_code == 200
