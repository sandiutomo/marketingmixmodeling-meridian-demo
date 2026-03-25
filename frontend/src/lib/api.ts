const BASE_URL = '/api/backend';

export async function checkHealth(): Promise<boolean> {
  try {
    console.log('[API] Checking backend health...')
    const res = await fetch(`${BASE_URL}/health`, { method: 'GET' })
    const ok = res.ok
    console.log(`[API] Backend health: ${ok ? '✅ online' : '❌ offline'} (HTTP ${res.status})`)
    return ok
  } catch (e) {
    console.warn('[API] Backend unreachable — running in demo mode:', e)
    return false
  }
}

export async function uploadCsv(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE_URL}/data/upload`, { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `Upload failed (${res.status})`);
  }
  return res.json() as Promise<{
    summary: import('./types').UploadedDataSummary;
    timespan: { start: string | null; end: string | null };
    column_detection: Record<string, unknown>;
    message: string;
  }>;
}

export async function loadData(dataSourceId: string) {
  console.log(`[API] Loading data source: "${dataSourceId}"`)
  const res = await fetch(`${BASE_URL}/data/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_source: dataSourceId }),
  });
  if (!res.ok) throw new Error('Failed to load data');
  const data = await res.json();
  console.log('[API] Data loaded successfully:', data)
  return data;
}

export async function configureModel(config: object) {
  console.log('[API] Configuring model with:', config)
  const res = await fetch(`${BASE_URL}/model/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to configure model');
  const data = await res.json();
  console.log('[API] Model configured:', data)
  return data;
}

export async function runModel() {
  console.log('[API] Starting model run...')
  const res = await fetch(`${BASE_URL}/model/run`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to run model');
  const data = await res.json();
  console.log('[API] Model run complete:', data)
  return data;
}

/** Background MCMC — poll with getModelJobStatus */
export async function startModelJob() {
  const res = await fetch(`${BASE_URL}/model/run/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start model job');
  return res.json() as Promise<{ job_id: string; message: string }>;
}

export async function getModelJobStatus(jobId: string) {
  const res = await fetch(`${BASE_URL}/model/run/status/${jobId}`);
  if (!res.ok) throw new Error('Job status failed');
  return res.json() as Promise<{
    job_id: string;
    status: string;
    progress?: number;
    message?: string;
    error?: string | null;
    diagnostics?: Record<string, unknown>;
  }>;
}

export async function getResults() {
  console.log('[API] Fetching results...')
  const res = await fetch(`${BASE_URL}/results`);
  if (!res.ok) throw new Error('Failed to get results');
  const data = await res.json();
  // Normalise snake_case flag from backend to camelCase
  if (data && 'is_real_meridian' in data) {
    data.isRealMeridian = data.is_real_meridian
  }
  console.log('[API] Results received:', data)
  return data;
}

export async function runOptimization(budget: number, scenario?: object) {
  console.log(`[API] Running budget optimization — total budget: $${budget.toLocaleString()}`, scenario ?? '')
  const res = await fetch(`${BASE_URL}/optimization/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ budget, scenario }),
  });
  if (!res.ok) throw new Error('Failed to run optimization');
  const data = await res.json();
  console.log('[API] Optimization results:', data)
  return data;
}

export async function saveModel(name: string) {
  console.log(`[API] Saving model snapshot: "${name}"`)
  const res = await fetch(`${BASE_URL}/model/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to save model');
  const data = await res.json();
  console.log('[API] Model saved:', data)
  return data;
}

export async function getModelStatus() {
  console.log('[API] Checking model status...')
  const res = await fetch(`${BASE_URL}/model/status`);
  if (!res.ok) throw new Error('Failed to get status');
  const data = await res.json();
  console.log('[API] Model status:', data)
  return data;
}

export async function getHillParams() {
  const res = await fetch(`${BASE_URL}/results/hill_params`)
  if (!res.ok) throw new Error('Failed to get Hill params')
  return res.json()
}

export async function getAdstockParams() {
  const res = await fetch(`${BASE_URL}/results/adstock`)
  if (!res.ok) throw new Error('Failed to get adstock params')
  return res.json()
}

export async function getGeoBreakdown() {
  const res = await fetch(`${BASE_URL}/results/geo`)
  if (!res.ok) throw new Error('Failed to get geo breakdown')
  return res.json()
}

export async function fetchComputedResults(
  sourceId: string,
  config?: { startDate?: string; endDate?: string; channels?: string[] }
) {
  let backendIsRealMeridian = false
  try {
    const data = await getResults()
    backendIsRealMeridian = data?.isRealMeridian === true
    if (data?.channels?.length) return data
  } catch (_) { /* fall through to client-side */ }
  if (sourceId === 'custom_csv') {
    throw new Error('Custom CSV results require the backend. Run the model after uploading.')
  }
  const { computeModelResults } = await import('./compute')
  const result = await computeModelResults(sourceId as import('./types').DataSourceType, config)
  return { ...result, isRealMeridian: backendIsRealMeridian }
}
