"""
Unit + integration tests for ResultsGeneratorService.get_saturation()
and GET /results/saturation.

Covers:
  - Result has channels list and is_real_meridian flag
  - Each channel entry has all required fields
  - Status values are valid enum members
  - Saturation ratio is non-negative
  - No data loaded → empty result
  - Router returns 200
"""
import pytest


def _make_service():
    from services.results_generator import ResultsGeneratorService
    return ResultsGeneratorService()


# ---------------------------------------------------------------------------
# Structure tests
# ---------------------------------------------------------------------------

class TestSaturationStructure:
    def test_result_has_channels_and_flag(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_saturation()
        assert 'channels' in result
        assert 'is_real_meridian' in result
        assert isinstance(result['channels'], list)
        assert isinstance(result['is_real_meridian'], bool)

    def test_channel_fields_complete(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_saturation()
        assert len(result['channels']) > 0
        required = {'channel', 'channel_key', 'current_spend', 'saturation_ratio', 'roi', 'status', 'is_real_meridian'}
        for ch in result['channels']:
            for field in required:
                assert field in ch, f"Missing field '{field}' in channel entry: {ch}"

    def test_status_valid_values(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_saturation()
        valid = {'saturated', 'efficient', 'room_to_grow'}
        for ch in result['channels']:
            assert ch['status'] in valid, f"Invalid status '{ch['status']}'"

    def test_saturation_ratio_non_negative(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_saturation()
        for ch in result['channels']:
            assert ch['saturation_ratio'] >= 0.0, f"Negative saturation_ratio for {ch['channel']}"

    def test_roi_positive(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_saturation()
        for ch in result['channels']:
            assert ch['roi'] > 0.0, f"Non-positive ROI for {ch['channel']}"

    def test_current_spend_non_negative(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_saturation()
        for ch in result['channels']:
            assert ch['current_spend'] >= 0.0


# ---------------------------------------------------------------------------
# Empty / no data
# ---------------------------------------------------------------------------

class TestSaturationNoData:
    def test_no_data_returns_empty(self, monkeypatch):
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        result = svc.get_saturation()
        assert result['channels'] == []
        assert result['is_real_meridian'] is False


# ---------------------------------------------------------------------------
# Router integration
# ---------------------------------------------------------------------------

class TestSaturationRouter:
    def test_router_returns_200(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/saturation')
        assert resp.status_code == 200
        body = resp.json()
        assert 'channels' in body
        assert 'is_real_meridian' in body
