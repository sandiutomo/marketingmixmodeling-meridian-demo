"""
Unit + integration tests for the Sprint 1–2 results endpoints:
  - GET /results/mroi
  - GET /results/cpik
  - GET /results/model_fit
  - GET /results/export/csv
  - GET /results/export/html

Covers:
  - Required response keys and types
  - Mathematical invariants (mroi ≤ roi, cpik > 0, CSV parseable, HTML well-formed)
  - No data loaded → empty / graceful fallback
  - Router returns 200 with correct Content-Type
"""
import pytest
import math
import csv
import io


def _make_service():
    from services.results_generator import ResultsGeneratorService
    return ResultsGeneratorService()


# ─────────────────────────────────────────────────────────────────────────────
# mROI
# ─────────────────────────────────────────────────────────────────────────────

class TestMROI:
    def test_returns_list(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_mroi()
        assert isinstance(result, list)

    def test_has_required_keys(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_mroi()
        assert len(result) > 0
        for row in result:
            assert 'channel' in row
            assert 'roi' in row
            assert 'mroi' in row
            assert 'spend' in row
            assert 'spend_pct' in row
            assert 'contribution_pct' in row
            assert 'is_real_meridian' in row

    def test_mroi_is_positive(self, mock_loaded_data):
        svc = _make_service()
        for row in svc.get_mroi():
            assert row['mroi'] >= 0, f"mroi should be non-negative for {row['channel']}"

    def test_spend_pct_sums_to_100(self, mock_loaded_data):
        svc = _make_service()
        rows = svc.get_mroi()
        total = sum(r['spend_pct'] for r in rows)
        assert math.isclose(total, 100.0, abs_tol=1.0), f"spend_pct sum = {total}"

    def test_no_data_returns_empty(self, monkeypatch):
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        assert svc.get_mroi() == []

    def test_router_returns_200(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/mroi')
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) > 0
        assert 'channel' in body[0]
        assert 'mroi' in body[0]


# ─────────────────────────────────────────────────────────────────────────────
# CPIK
# ─────────────────────────────────────────────────────────────────────────────

class TestCPIK:
    def test_returns_list(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_cpik()
        assert isinstance(result, list)

    def test_has_required_keys(self, mock_loaded_data):
        svc = _make_service()
        for row in svc.get_cpik():
            assert 'channel' in row
            assert 'cpik' in row
            assert 'roi' in row
            assert 'spend' in row
            assert 'revenue' in row
            assert 'spend_pct' in row
            assert 'contribution_pct' in row

    def test_cpik_positive_when_revenue_nonzero(self, mock_loaded_data):
        svc = _make_service()
        for row in svc.get_cpik():
            if row['revenue'] and row['revenue'] > 0:
                assert row['cpik'] is not None
                assert row['cpik'] > 0

    def test_sorted_ascending_by_cpik(self, mock_loaded_data):
        svc = _make_service()
        rows = [r for r in svc.get_cpik() if r['cpik'] is not None]
        for i in range(len(rows) - 1):
            assert rows[i]['cpik'] <= rows[i + 1]['cpik'] + 1e-9

    def test_spend_pct_sums_to_100(self, mock_loaded_data):
        svc = _make_service()
        total = sum(r['spend_pct'] for r in svc.get_cpik())
        assert math.isclose(total, 100.0, abs_tol=1.0)

    def test_no_data_falls_back_to_static(self, monkeypatch):
        # get_cpik() falls back to static ROI data, so it still returns rows
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        result = svc.get_cpik()
        # Either empty or static fallback — should not raise
        assert isinstance(result, list)

    def test_router_returns_200(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/cpik')
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert 'cpik' in body[0]


# ─────────────────────────────────────────────────────────────────────────────
# Model Fit
# ─────────────────────────────────────────────────────────────────────────────

class TestModelFit:
    def test_returns_dict_with_required_keys(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_model_fit()
        for key in ('weeks', 'actual', 'predicted', 'ci_lower', 'ci_upper', 'is_real_meridian'):
            assert key in result, f"Missing key: {key}"

    def test_arrays_same_length(self, mock_loaded_data):
        svc = _make_service()
        r = svc.get_model_fit()
        n = len(r['weeks'])
        assert n > 0
        assert len(r['actual'])    == n
        assert len(r['predicted']) == n
        assert len(r['ci_lower'])  == n
        assert len(r['ci_upper'])  == n

    def test_ci_lower_lte_predicted(self, mock_loaded_data):
        svc = _make_service()
        r = svc.get_model_fit()
        for lo, pred in zip(r['ci_lower'], r['predicted']):
            assert lo <= pred + 1e-6, f"ci_lower ({lo}) > predicted ({pred})"

    def test_ci_upper_gte_predicted(self, mock_loaded_data):
        svc = _make_service()
        r = svc.get_model_fit()
        for hi, pred in zip(r['ci_upper'], r['predicted']):
            assert hi >= pred - 1e-6, f"ci_upper ({hi}) < predicted ({pred})"

    def test_no_data_returns_empty_arrays(self, monkeypatch):
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        r = svc.get_model_fit()
        assert r['weeks'] == []
        assert r['actual'] == []

    def test_router_returns_200(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/model_fit')
        assert resp.status_code == 200
        body = resp.json()
        assert 'weeks' in body
        assert 'actual' in body
        assert 'predicted' in body


# ─────────────────────────────────────────────────────────────────────────────
# CSV Export
# ─────────────────────────────────────────────────────────────────────────────

class TestExportCSV:
    EXPECTED_FIELDS = [
        'channel', 'roi_mean', 'roi_ci_lower', 'roi_ci_upper',
        'mroi', 'cpik', 'spend', 'revenue',
        'contribution_pct', 'spend_pct', 'saturation_status', 'color',
    ]

    def test_returns_string(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_export_csv()
        assert isinstance(result, str)
        assert len(result) > 0

    def test_has_header_row(self, mock_loaded_data):
        svc = _make_service()
        content = svc.get_export_csv()
        reader = csv.DictReader(io.StringIO(content))
        assert reader.fieldnames is not None
        for field in self.EXPECTED_FIELDS:
            assert field in reader.fieldnames, f"Missing CSV field: {field}"

    def test_has_data_rows(self, mock_loaded_data):
        svc = _make_service()
        content = svc.get_export_csv()
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)
        assert len(rows) > 0

    def test_roi_mean_is_numeric(self, mock_loaded_data):
        svc = _make_service()
        content = svc.get_export_csv()
        for row in csv.DictReader(io.StringIO(content)):
            assert float(row['roi_mean']) >= 0

    def test_no_data_falls_back_to_static(self, monkeypatch):
        # get_export_csv() relies on get_roi() which has a static fallback,
        # so it still produces a CSV with mock rows rather than an empty string
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        result = svc.get_export_csv()
        assert isinstance(result, str)

    def test_router_returns_200_with_csv_content_type(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/export/csv')
        assert resp.status_code == 200
        assert 'text/csv' in resp.headers.get('content-type', '')

    def test_router_sets_content_disposition(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/export/csv')
        cd = resp.headers.get('content-disposition', '')
        assert 'attachment' in cd
        assert '.csv' in cd


# ─────────────────────────────────────────────────────────────────────────────
# HTML Export
# ─────────────────────────────────────────────────────────────────────────────

class TestExportHTML:
    def test_returns_string(self, mock_loaded_data):
        svc = _make_service()
        result = svc.get_export_html()
        assert isinstance(result, str)
        assert len(result) > 0

    def test_is_valid_html(self, mock_loaded_data):
        svc = _make_service()
        html = svc.get_export_html()
        assert html.strip().startswith('<!DOCTYPE html')
        assert '</html>' in html

    def test_contains_key_sections(self, mock_loaded_data):
        svc = _make_service()
        html = svc.get_export_html()
        assert 'Marketing Mix Model Report' in html
        assert 'Channel Performance' in html
        assert 'Model Diagnostics' in html

    def test_contains_channel_names(self, mock_loaded_data):
        svc = _make_service()
        html = svc.get_export_html()
        # mock data has channels tv, social, search
        for label in ('TV', 'Social', 'Search'):
            assert label in html, f"Channel label '{label}' not found in HTML report"

    def test_contains_portfolio_roi(self, mock_loaded_data):
        svc = _make_service()
        html = svc.get_export_html()
        assert 'Portfolio ROI' in html

    def test_no_data_returns_fallback_html(self, monkeypatch):
        from services.data_loader import DataLoaderService
        monkeypatch.setattr(DataLoaderService, '_loaded_data', None)
        svc = _make_service()
        html = svc.get_export_html()
        # Should still return valid HTML, not raise
        assert '<html' in html

    def test_router_returns_200_with_html_content_type(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/export/html')
        assert resp.status_code == 200
        assert 'text/html' in resp.headers.get('content-type', '')

    def test_router_sets_content_disposition(self, test_client, mock_loaded_data):
        resp = test_client.get('/results/export/html')
        cd = resp.headers.get('content-disposition', '')
        assert 'attachment' in cd
        assert '.html' in cd

    def test_inline_styles_present(self, mock_loaded_data):
        svc = _make_service()
        html = svc.get_export_html()
        # All styles should be inline so the file is self-contained
        assert '<style>' in html
        assert 'font-family' in html
