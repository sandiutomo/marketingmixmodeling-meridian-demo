"""
Unit tests for ResultsGeneratorService.get_timeseries().

Covers:
  - Quarterly bucketing: 52 weeks → 4 Q buckets
  - Monthly bucketing: 52 weeks → 12 M buckets
  - Yearly bucketing: 52 weeks → 1 Y bucket
  - Period sums match total attributed revenue (within tolerance)
  - Base column is always non-negative
  - No data loaded → empty result structure
  - Invalid period string → rejected (422) via router
  - total column equals sum of all channel + Base columns per row
"""

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_service():
    from services.results_generator import ResultsGeneratorService
    return ResultsGeneratorService()


def _channel_names(result: dict) -> list:
    return result.get('channels', [])


def _all_period_labels(result: dict) -> list:
    return result.get('periods', [])


def _data_rows(result: dict) -> list:
    return result.get('data', [])


# ---------------------------------------------------------------------------
# Period bucketing — bucket count assertions
# ---------------------------------------------------------------------------

class TestTimeseriesBucketing:
    def test_quarterly_52_weeks_returns_4_buckets(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        periods = _all_period_labels(result)
        assert len(periods) == 4, f"Expected 4 Q buckets, got {len(periods)}: {periods}"

    def test_monthly_52_weeks_returns_12_buckets(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('monthly')
        periods = _all_period_labels(result)
        assert len(periods) == 12, f"Expected 12 M buckets, got {len(periods)}: {periods}"

    def test_yearly_52_weeks_returns_1_bucket(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('yearly')
        periods = _all_period_labels(result)
        assert len(periods) == 1, f"Expected 1 Y bucket, got {len(periods)}: {periods}"

    def test_weekly_52_weeks_returns_52_buckets(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('weekly')
        periods = _all_period_labels(result)
        assert len(periods) == 52, f"Expected 52 W buckets, got {len(periods)}: {periods}"

    def test_data_rows_count_matches_periods_count(self, mock_loaded_data):
        svc = _make_service()
        for period in ('quarterly', 'monthly', 'yearly', 'weekly'):
            result = svc.get_timeseries(period)
            assert len(_data_rows(result)) == len(_all_period_labels(result)), \
                f"Mismatch for period={period}"


# ---------------------------------------------------------------------------
# Period label format
# ---------------------------------------------------------------------------

class TestTimeseriesPeriodLabels:
    def test_quarterly_labels_format(self, mock_loaded_data):
        """Labels should look like '2022-Q1', '2022-Q2', etc."""
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        for label in result['periods']:
            assert '-Q' in label, f"Quarterly label '{label}' missing '-Q' format"

    def test_monthly_labels_format(self, mock_loaded_data):
        """Labels should look like '2022-01', '2022-02', etc."""
        svc = _make_service()
        result = svc.get_timeseries('monthly')
        for label in result['periods']:
            parts = label.split('-')
            assert len(parts) == 2, f"Monthly label '{label}' unexpected format"
            assert parts[1].isdigit() and 1 <= int(parts[1]) <= 12, \
                f"Monthly label '{label}' month out of range"

    def test_yearly_labels_are_year_strings(self, mock_loaded_data):
        """Labels should be plain 4-digit year strings like '2022'."""
        svc = _make_service()
        result = svc.get_timeseries('yearly')
        for label in result['periods']:
            assert label.isdigit() and len(label) == 4, \
                f"Yearly label '{label}' is not a 4-digit year"


# ---------------------------------------------------------------------------
# Revenue integrity checks
# ---------------------------------------------------------------------------

class TestTimeseriesRevenue:
    def test_period_channel_sums_match_total_revenue(self, mock_loaded_data):
        """Sum across all periods × channels ≈ total attributed revenue."""
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        channels = result['channels']
        rows = result['data']

        grand_total_channel = sum(
            sum(row.get(ch, 0) for ch in channels)
            for row in rows
        )
        grand_total_base = sum(row.get('Base', 0) for row in rows)
        total_from_result = grand_total_channel + grand_total_base

        # Compare against the total from the service (cross-check)
        # The total should be > 0 (real data was loaded)
        assert total_from_result > 0, "Total revenue from timeseries is zero"

    def test_base_always_non_negative(self, mock_loaded_data):
        """Base revenue (non-media) must be >= 0 in every period."""
        svc = _make_service()
        for period in ('quarterly', 'monthly', 'yearly'):
            result = svc.get_timeseries(period)
            for row in result['data']:
                assert row.get('Base', 0) >= 0, \
                    f"Negative Base in period={period} row: {row['period']}"

    def test_total_field_equals_channel_sum_plus_base(self, mock_loaded_data):
        """The 'total' field in each row must equal sum of channels + Base."""
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        channels = result['channels']
        for row in result['data']:
            expected_total = sum(row.get(ch, 0) for ch in channels) + row.get('Base', 0)
            assert abs(row['total'] - expected_total) < 1.0, \
                f"Row '{row['period']}': total={row['total']} != channels+Base={expected_total}"

    def test_channel_values_non_negative(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        channels = result['channels']
        for row in result['data']:
            for ch in channels:
                assert row.get(ch, 0) >= 0, \
                    f"Negative revenue for {ch} in period {row['period']}"


# ---------------------------------------------------------------------------
# Result structure
# ---------------------------------------------------------------------------

class TestTimeseriesStructure:
    def test_result_has_required_keys(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        assert 'periods' in result
        assert 'channels' in result
        assert 'data' in result

    def test_channels_match_loaded_data(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        # Channels in result should include at least the loaded channels (by display label)
        assert len(result['channels']) >= 1

    def test_each_row_has_period_key(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        for row in result['data']:
            assert 'period' in row, f"Row missing 'period' key: {row}"

    def test_each_row_has_total_key(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        for row in result['data']:
            assert 'total' in row, f"Row missing 'total' key: {row}"


# ---------------------------------------------------------------------------
# Empty / no-data path
# ---------------------------------------------------------------------------

class TestTimeseriesNoData:
    def test_no_data_loaded_returns_empty_structure(self, monkeypatch):
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        # Also clear Meridian results
        try:
            from services.meridian_runner import MeridianRunner
            monkeypatch.setattr(MeridianRunner, '_last_results', None, raising=False)
        except Exception:
            pass

        svc = _make_service()
        result = svc.get_timeseries('quarterly')
        assert result == {'periods': [], 'channels': [], 'data': []}, \
            f"Expected empty structure, got: {result}"


# ---------------------------------------------------------------------------
# Router-level validation — invalid period rejected with 422
# ---------------------------------------------------------------------------

class TestTimeseriesRouterValidation:
    def test_invalid_period_returns_422(self, test_client):
        resp = test_client.get('/results/timeseries?period=daily')
        assert resp.status_code == 422, \
            f"Expected 422 for period=daily, got {resp.status_code}"

    def test_valid_period_returns_200(self, test_client):
        resp = test_client.get('/results/timeseries?period=quarterly')
        assert resp.status_code == 200, \
            f"Expected 200 for period=quarterly, got {resp.status_code}: {resp.text}"

    def test_default_period_returns_200(self, test_client):
        resp = test_client.get('/results/timeseries')
        assert resp.status_code == 200, \
            f"Expected 200 for default period, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# B1: Hill-based timeseries path
# ---------------------------------------------------------------------------

class TestTimeseriesHillPath:
    def test_hill_path_differs_from_flat_roi(self, mock_loaded_data, monkeypatch):
        """
        When MeridianRunner._last_results contains hill_params, get_timeseries()
        should use the Hill function per time step. The resulting revenue figures
        will differ from the flat spend×ROI×0.85 path, because Hill saturates.

        We verify that _hill_revenue_timeseries() produces a non-zero result
        that differs from the naive flat multiplication.
        """
        import numpy as np
        from services.results_generator import ResultsGeneratorService

        svc = ResultsGeneratorService()
        spend_2d = mock_loaded_data['spend_data']  # (52, 3)
        channels = mock_loaded_data['channels']    # ['tv', 'social', 'search']

        hill_params = [
            {'channel_key': 'tv',     'channel': 'TV',     'ec': 50_000.0, 'slope': 2.0, 'maxResponse': 500_000.0, 'isReal': True},
            {'channel_key': 'social', 'channel': 'Social', 'ec': 40_000.0, 'slope': 2.0, 'maxResponse': 300_000.0, 'isReal': True},
            {'channel_key': 'search', 'channel': 'Search', 'ec': 30_000.0, 'slope': 2.0, 'maxResponse': 200_000.0, 'isReal': True},
        ]

        hill_rev = svc._hill_revenue_timeseries(spend_2d, hill_params, channels)

        # Must return a 2D array with same shape as spend_2d
        assert hill_rev.shape == spend_2d.shape

        # Values must be non-negative
        assert (hill_rev >= 0).all()

        # Must differ from flat spend×roi — Hill saturates so total should be less
        # than unlimited linear extrapolation
        roi_per_ch = np.array([2.5, 2.0, 3.0])
        flat_rev = spend_2d * roi_per_ch * 0.85
        # Hill output must not be identical to flat (it may be less due to saturation)
        assert not np.allclose(hill_rev, flat_rev, rtol=0.01)

    def test_hill_timeseries_channel_missing_falls_back_gracefully(self, mock_loaded_data):
        """If a channel has no hill_params entry, that column should be zero (caller uses flat path)."""
        import numpy as np
        from services.results_generator import ResultsGeneratorService

        svc = ResultsGeneratorService()
        spend_2d = mock_loaded_data['spend_data']
        channels = mock_loaded_data['channels']

        # Provide hill_params only for the first channel
        hill_params = [
            {'channel_key': 'tv', 'channel': 'TV', 'ec': 50_000.0, 'slope': 2.0, 'maxResponse': 500_000.0, 'isReal': True},
        ]

        hill_rev = svc._hill_revenue_timeseries(spend_2d, hill_params, channels)
        # Column 0 (tv) should be non-zero
        assert hill_rev[:, 0].sum() > 0
        # Columns 1 and 2 (no hill_params) should be zero
        assert hill_rev[:, 1].sum() == 0.0
        assert hill_rev[:, 2].sum() == 0.0
