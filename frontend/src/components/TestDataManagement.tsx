import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './TestDataManagement.css';

const API_URL = 'http://localhost:3001/api';

interface Script {
  id: string;
  name: string;
  code: string;
}

interface FieldBinding {
  csvHeader: string;
  placeholder: string;
  confidence: 'exact' | 'fuzzy' | 'none';
}

interface CsvDataRow {
  index: number;
  values: Record<string, string>;
}

interface UploadResponse {
  success: boolean;
  csvHeaders: string[];
  rowCount: number;
  fieldBindings: FieldBinding[];
  unmappedHeaders: string[];
  unmappedPlaceholders: string[];
  dataRows: CsvDataRow[];
  savedSuiteId?: string;
  savedCount?: number;
}

interface PreviewData {
  originalCode: string;
  substitutedCode: string;
  appliedValues: Record<string, string>;
  previewRowIndex: number;
  totalRows: number;
}

interface DataDrivenRun {
  id: string;
  scriptId: string;
  scriptName?: string;
  name: string;
  status: string;
  totalRows: number;
  completedRows: number;
  passedRows: number;
  failedRows: number;
  browser: string;
  executionMode: string;
  aggregateReportUrl?: string;
  duration?: number;
  createdAt: string;
}

interface RowResult {
  rowIndex: number;
  dataValues: Record<string, any>;
  testRunId: string;
  status: string;
  duration: number;
  errorMsg: string | null;
  reportUrl: string | null;
}

type TabType = 'upload' | 'parse' | 'preview' | 'execute' | 'manage';

export const TestDataManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('upload');
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string>('');
  const [selectedScriptCode, setSelectedScriptCode] = useState<string>('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  const [suiteName, setSuiteName] = useState('');
  const [environment, setEnvironment] = useState('dev');
  const [saveToDb, setSaveToDb] = useState(false);

  // Parse CSV - Optional Analysis Features
  const [parseScriptId, setParseScriptId] = useState<string>('');
  const [analyzeBindings, setAnalyzeBindings] = useState(false);
  const [validateData, setValidateData] = useState(false);
  const [detectFieldTypes, setDetectFieldTypes] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // Manual binding overrides
  const [manualBindings, setManualBindings] = useState<FieldBinding[]>([]);

  // Execute tab state
  const [execBrowser, setExecBrowser] = useState('chromium');
  const [execMode, setExecMode] = useState('sequential');
  const [stopOnFirstFailure, setStopOnFirstFailure] = useState(false);
  const [delayBetweenRows, setDelayBetweenRows] = useState(0);
  const [activeDdrId, setActiveDdrId] = useState<string | null>(null);
  const [activeDdr, setActiveDdr] = useState<DataDrivenRun | null>(null);
  const [rowResults, setRowResults] = useState<RowResult[]>([]);
  const [ddrHistory, setDdrHistory] = useState<DataDrivenRun[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    loadScripts();
  }, []);

  useEffect(() => {
    if (selectedScriptId) {
      const script = scripts.find(s => s.id === selectedScriptId);
      if (script) setSelectedScriptCode(script.code);
    }
  }, [selectedScriptId, scripts]);

  // Sync manual bindings when upload response changes
  useEffect(() => {
    if (uploadResponse) {
      setManualBindings([...uploadResponse.fieldBindings]);
    }
  }, [uploadResponse]);

  // Poll for active DDR status
  useEffect(() => {
    if (activeDdrId && activeDdr?.status === 'running') {
      pollRef.current = setInterval(() => pollDdrStatus(activeDdrId), 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [activeDdrId, activeDdr?.status]);

  const loadScripts = async () => {
    try {
      const res = await axios.get(`${API_URL}/scripts`, { headers });
      setScripts(res.data.data || []);
    } catch (err: any) {
      setError('Failed to load scripts');
    }
  };

  const loadDdrHistory = async () => {
    try {
      const res = await axios.get(`${API_URL}/data-driven-runs`, { headers });
      setDdrHistory(res.data.data || []);
    } catch (err: any) {
      console.error('Failed to load DDR history', err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setCsvFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUploadCsv = async () => {
    if (!csvFile || !selectedScriptId) {
      setError('Please select both a CSV file and a script');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      formData.append('scriptId', selectedScriptId);
      if (suiteName) formData.append('suiteName', suiteName);
      formData.append('environment', environment);
      formData.append('save', saveToDb.toString());

      const res = await axios.post(
        `${API_URL}/testdata/csv/upload-and-bind`,
        formData,
        { headers: { ...headers, 'Content-Type': 'multipart/form-data' } }
      );

      if (res.data.success) {
        const normalizedResponse: UploadResponse = {
          success: true,
          csvHeaders: res.data.csv?.headers || [],
          rowCount: res.data.csv?.rowCount || 0,
          fieldBindings: res.data.analysis?.fieldBindings?.mapped || [],
          unmappedHeaders: res.data.analysis?.fieldBindings?.unmapped?.columns || [],
          unmappedPlaceholders: res.data.analysis?.fieldBindings?.unmapped?.placeholders || [],
          dataRows: res.data.csv?.rows || [],
          ...(res.data.persistence && { savedSuiteId: res.data.persistence.suiteId, savedCount: res.data.persistence.savedCount })
        };
        setUploadResponse(normalizedResponse);
        setSuccess(`CSV uploaded: ${normalizedResponse.rowCount} rows, ${normalizedResponse.fieldBindings.length} bindings detected`);
        setCsvFile(null);
        setSuiteName('');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to upload CSV');
    } finally {
      setLoading(false);
    }
  };

  const handleParseCsv = async () => {
    if (!csvContent.trim()) {
      setError('Please enter CSV content');
      return;
    }
    if (analyzeBindings && !parseScriptId) {
      setError('Please select a script for binding analysis');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await axios.post(
        `${API_URL}/testdata/csv/parse`,
        {
          csvContent,
          delimiter: ',',
          scriptId: analyzeBindings ? parseScriptId : undefined,
          analyzeBindings,
          validateData,
          detectFieldTypes
        },
        { headers }
      );

      setSuccess(`Parsed: ${res.data.csv?.rowCount || 0} rows`);
      setUploadResponse({
        success: true,
        csvHeaders: res.data.csv?.headers || [],
        rowCount: res.data.csv?.rowCount || 0,
        fieldBindings: res.data.analysis?.fieldBindings?.mapped || [],
        unmappedHeaders: res.data.analysis?.fieldBindings?.unmapped?.columns || [],
        unmappedPlaceholders: res.data.analysis?.fieldBindings?.unmapped?.placeholders || [],
        dataRows: res.data.csv?.rows || []
      });
      setAnalysisResult({
        analysis: res.data.analysis,
        fieldTypes: res.data.fieldTypes,
        validation: res.data.validation
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to parse CSV');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewBinding = async () => {
    if (!selectedScriptCode || !uploadResponse) {
      setError('Please upload CSV and select a script first');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const fieldBindings: Record<string, string> = {};
      (manualBindings.length > 0 ? manualBindings : uploadResponse.fieldBindings).forEach(fb => {
        if (fb.confidence !== 'none') {
          fieldBindings[fb.placeholder] = fb.csvHeader;
        }
      });

      const csvRow = uploadResponse.dataRows[previewRowIndex]?.values || {};

      const res = await axios.post(
        `${API_URL}/testdata/csv/preview-binding`,
        { scriptCode: selectedScriptCode, fieldBindings, csvRow },
        { headers }
      );

      const normalizedPreview: PreviewData = {
        originalCode: res.data.preview?.code?.original || res.data.originalCode || '',
        substitutedCode: res.data.preview?.code?.substituted || res.data.substitutedCode || '',
        appliedValues: res.data.preview?.appliedValues || res.data.appliedValues || {},
        previewRowIndex: res.data.preview?.rowIndex || res.data.previewRowIndex || 0,
        totalRows: res.data.preview?.totalRows || res.data.totalRows || 0
      };
      setPreviewData(normalizedPreview);
      setSuccess('Preview generated');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to generate preview');
    } finally {
      setLoading(false);
    }
  };

  // Manual binding update
  const updateBinding = (idx: number, field: 'csvHeader' | 'placeholder', value: string) => {
    const updated = [...manualBindings];
    updated[idx] = { ...updated[idx], [field]: value, confidence: 'exact' as const };
    setManualBindings(updated);
  };

  const addBinding = () => {
    setManualBindings([...manualBindings, { csvHeader: '', placeholder: '', confidence: 'exact' }]);
  };

  const removeBinding = (idx: number) => {
    setManualBindings(manualBindings.filter((_, i) => i !== idx));
  };

  // Execute: Create and start data-driven run
  const handleExecuteRun = async () => {
    if (!selectedScriptId || !uploadResponse) {
      setError('Please upload CSV and select a script first');
      return;
    }

    const bindings = manualBindings.length > 0 ? manualBindings : uploadResponse.fieldBindings;
    const fieldBindings: Record<string, string> = {};
    bindings.forEach(fb => {
      if (fb.confidence !== 'none' && fb.placeholder && fb.csvHeader) {
        fieldBindings[fb.placeholder] = fb.csvHeader;
      }
    });

    if (Object.keys(fieldBindings).length === 0) {
      setError('No valid field bindings. Map at least one CSV column to a placeholder.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setRowResults([]);

    try {
      // 1. Create DataDrivenRun
      const createRes = await axios.post(
        `${API_URL}/data-driven-runs`,
        {
          scriptId: selectedScriptId,
          dataRows: uploadResponse.dataRows.map(r => r.values),
          fieldBindings,
          browser: execBrowser,
          executionMode: execMode,
          executionConfig: {
            stopOnFirstFailure,
            delayBetweenRows: delayBetweenRows > 0 ? delayBetweenRows * 1000 : undefined,
          }
        },
        { headers }
      );

      const ddrId = createRes.data.data.id;
      setActiveDdrId(ddrId);
      setActiveDdr(createRes.data.data);

      // 2. Start execution
      await axios.post(`${API_URL}/data-driven-runs/${ddrId}/start`, {}, { headers });
      setSuccess(`Data-driven run started: ${uploadResponse.rowCount} rows`);

      // Fetch initial status
      pollDdrStatus(ddrId);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start data-driven run');
    } finally {
      setLoading(false);
    }
  };

  const pollDdrStatus = async (ddrId: string) => {
    try {
      const res = await axios.get(`${API_URL}/data-driven-runs/${ddrId}/results`, { headers });
      const data = res.data;

      setActiveDdr(data.dataDrivenRun);
      setRowResults(data.rowResults || []);

      if (!['running', 'pending'].includes(data.dataDrivenRun.status)) {
        if (pollRef.current) clearInterval(pollRef.current);
        setSuccess(`Run completed: ${data.summary.passed}/${data.summary.total} passed (${data.summary.passRate}%)`);
      }
    } catch (err: any) {
      console.error('Poll error:', err);
    }
  };

  const handleStopRun = async () => {
    if (!activeDdrId) return;
    try {
      await axios.post(`${API_URL}/data-driven-runs/${activeDdrId}/stop`, {}, { headers });
      setSuccess('Run stopped');
      if (pollRef.current) clearInterval(pollRef.current);
      pollDdrStatus(activeDdrId);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to stop run');
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'exact': return '#4caf50';
      case 'fuzzy': return '#ff9800';
      case 'none': return '#f44336';
      default: return '#999';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'passed': return '#4caf50';
      case 'failed': return '#f44336';
      case 'running': return '#2196f3';
      case 'partial': return '#ff9800';
      case 'cancelled': return '#9e9e9e';
      default: return '#999';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'running': return '⏳';
      case 'partial': return '⚠️';
      case 'cancelled': return '🚫';
      case 'queued': return '⏸️';
      default: return '❓';
    }
  };

  return (
    <div className="test-data-management">
      <h1 className="page-title">Test Data Management</h1>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')}>
          Upload CSV
        </button>
        <button className={`tab ${activeTab === 'parse' ? 'active' : ''}`} onClick={() => setActiveTab('parse')}>
          Parse CSV
        </button>
        <button
          className={`tab ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
          disabled={!uploadResponse}
        >
          Preview & Bind
        </button>
        <button
          className={`tab ${activeTab === 'execute' ? 'active' : ''}`}
          onClick={() => { setActiveTab('execute'); loadDdrHistory(); }}
          disabled={!uploadResponse}
        >
          Execute
        </button>
        <button className={`tab ${activeTab === 'manage' ? 'active' : ''}`} onClick={() => setActiveTab('manage')}>
          Manage Data
        </button>
      </div>

      {/* Alert Messages */}
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Upload CSV Tab */}
      {activeTab === 'upload' && (
        <div className="tab-content">
          <h2>Upload CSV File & Auto-Bind Fields</h2>

          <div className="form-group">
            <label>Select Playwright Script *</label>
            <select value={selectedScriptId} onChange={(e) => setSelectedScriptId(e.target.value)} className="form-control">
              <option value="">-- Select a script --</option>
              {scripts.map(script => (
                <option key={script.id} value={script.id}>{script.name}</option>
              ))}
            </select>
            <small>Script must contain {'{{'}placeholders{'}}'}  for field binding</small>
          </div>

          {selectedScriptCode && (
            <div className="form-group">
              <label>Script Code Preview</label>
              <div className="code-preview"><pre>{selectedScriptCode}</pre></div>
            </div>
          )}

          <div className="form-group">
            <label>CSV File *</label>
            <input type="file" accept=".csv" onChange={handleFileChange} className="form-control" />
            {csvFile && <small>{csvFile.name}</small>}
          </div>

          <div className="form-group">
            <label>Test Suite Name (Optional)</label>
            <input type="text" value={suiteName} onChange={(e) => setSuiteName(e.target.value)} placeholder="e.g., Login Test Data" className="form-control" />
          </div>

          <div className="form-group">
            <label>Environment</label>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="form-control">
              <option value="dev">Dev</option>
              <option value="staging">Staging</option>
              <option value="prod">Production</option>
            </select>
          </div>

          <div className="form-group checkbox">
            <input type="checkbox" id="saveToDb" checked={saveToDb} onChange={(e) => setSaveToDb(e.target.checked)} />
            <label htmlFor="saveToDb">Save data to database</label>
          </div>

          <button onClick={handleUploadCsv} disabled={loading || !csvFile || !selectedScriptId} className="btn btn-primary">
            {loading ? 'Uploading...' : 'Upload & Analyze'}
          </button>
        </div>
      )}

      {/* Parse CSV Tab */}
      {activeTab === 'parse' && (
        <div className="tab-content">
          <h2>Parse CSV Content (Inline)</h2>

          <div className="form-group">
            <label>CSV Content *</label>
            <textarea
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              placeholder={"email,password\nalice@example.com,Pass@123\nbob@example.com,Secure456!"}
              className="form-control"
              rows={10}
            />
          </div>

          <div style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '6px', marginTop: '20px', marginBottom: '20px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '15px', fontSize: '1rem' }}>Optional: Add Analysis</h3>

            <div className="form-group checkbox">
              <input type="checkbox" id="analyzeBindings" checked={analyzeBindings} onChange={(e) => setAnalyzeBindings(e.target.checked)} />
              <label htmlFor="analyzeBindings">Analyze field bindings to script</label>
            </div>

            {analyzeBindings && (
              <div className="form-group">
                <label>Select Script (for binding analysis) *</label>
                <select value={parseScriptId} onChange={(e) => setParseScriptId(e.target.value)} className="form-control">
                  <option value="">-- Select a script --</option>
                  {scripts.map(script => (
                    <option key={script.id} value={script.id}>{script.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group checkbox">
              <input type="checkbox" id="detectFieldTypes" checked={detectFieldTypes} onChange={(e) => setDetectFieldTypes(e.target.checked)} />
              <label htmlFor="detectFieldTypes">Auto-detect field types (email, password, URL, etc.)</label>
            </div>

            <div className="form-group checkbox">
              <input type="checkbox" id="validateData" checked={validateData} onChange={(e) => setValidateData(e.target.checked)} />
              <label htmlFor="validateData">Validate data formats</label>
            </div>
          </div>

          <button onClick={handleParseCsv} disabled={loading || !csvContent.trim() || (analyzeBindings && !parseScriptId)} className="btn btn-primary">
            {loading ? 'Parsing...' : 'Parse CSV'}
          </button>
        </div>
      )}

      {/* Preview & Bind Tab */}
      {activeTab === 'preview' && uploadResponse && (
        <div className="tab-content">
          <h2>Preview & Manual Binding</h2>

          {/* Manual Binding Override */}
          <div className="manual-binding-section">
            <h3>Field Bindings</h3>
            <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '12px' }}>
              Edit mappings below or add new ones. CSV Column maps to Script {'{{'}Placeholder{'}}'}.
            </p>
            <table className="bindings-edit-table">
              <thead>
                <tr>
                  <th>CSV Column</th>
                  <th></th>
                  <th>Script Placeholder</th>
                  <th>Confidence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {manualBindings.map((fb, idx) => (
                  <tr key={idx}>
                    <td>
                      <select value={fb.csvHeader} onChange={(e) => updateBinding(idx, 'csvHeader', e.target.value)} className="form-control-sm">
                        <option value="">-- Select --</option>
                        {uploadResponse.csvHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#667eea' }}>→</td>
                    <td>
                      <input type="text" value={fb.placeholder} onChange={(e) => updateBinding(idx, 'placeholder', e.target.value)} className="form-control-sm" placeholder="placeholder_name" />
                    </td>
                    <td>
                      <span className={`badge badge-${fb.confidence}`} style={{ backgroundColor: getConfidenceColor(fb.confidence) }}>
                        {fb.confidence.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <button onClick={() => removeBinding(idx)} className="btn-icon btn-danger-sm" title="Remove">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={addBinding} className="btn btn-secondary btn-sm" style={{ marginTop: '8px' }}>
              + Add Binding
            </button>
          </div>

          {/* Row preview */}
          <div style={{ marginTop: '24px' }}>
            <h3>Substitution Preview</h3>
            <div className="form-group" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <select value={previewRowIndex} onChange={(e) => setPreviewRowIndex(parseInt(e.target.value))} className="form-control" style={{ maxWidth: '200px' }}>
                {uploadResponse.dataRows.map((_row, idx) => (
                  <option key={idx} value={idx}>Row {idx + 1}</option>
                ))}
              </select>
              <button onClick={handlePreviewBinding} disabled={loading} className="btn btn-primary">
                {loading ? 'Generating...' : 'Generate Preview'}
              </button>
            </div>

            {previewData && (
              <div className="preview-result">
                <div className="preview-columns">
                  <div className="preview-col">
                    <h4>Original Code</h4>
                    <div className="code-preview original"><pre>{previewData.originalCode}</pre></div>
                  </div>
                  <div className="preview-col">
                    <h4>Substituted Code</h4>
                    <div className="code-preview substituted"><pre>{previewData.substitutedCode}</pre></div>
                  </div>
                </div>

                <h4>Applied Values</h4>
                <table>
                  <thead><tr><th>Placeholder</th><th>Value</th></tr></thead>
                  <tbody>
                    {Object.entries(previewData.appliedValues).map(([key, value]) => (
                      <tr key={key}><td><code>{`{{${key}}}`}</code></td><td><code>{value}</code></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Execute Tab */}
      {activeTab === 'execute' && (
        <div className="tab-content">
          <h2>Execute Data-Driven Tests</h2>

          {uploadResponse ? (
            <div>
              {/* Config */}
              <div className="exec-config">
                <div className="config-row">
                  <div className="form-group">
                    <label>Browser</label>
                    <select value={execBrowser} onChange={(e) => setExecBrowser(e.target.value)} className="form-control">
                      <option value="chromium">Chromium</option>
                      <option value="firefox">Firefox</option>
                      <option value="webkit">WebKit</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Execution Mode</label>
                    <select value={execMode} onChange={(e) => setExecMode(e.target.value)} className="form-control">
                      <option value="sequential">Sequential</option>
                      <option value="parallel">Parallel</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Delay Between Rows (sec)</label>
                    <input type="number" value={delayBetweenRows} onChange={(e) => setDelayBetweenRows(parseInt(e.target.value) || 0)} className="form-control" min={0} max={30} />
                  </div>
                </div>

                <div className="form-group checkbox">
                  <input type="checkbox" id="stopOnFirstFailure" checked={stopOnFirstFailure} onChange={(e) => setStopOnFirstFailure(e.target.checked)} />
                  <label htmlFor="stopOnFirstFailure">Stop on first failure</label>
                </div>

                <div className="exec-summary">
                  <span><strong>Script:</strong> {scripts.find(s => s.id === selectedScriptId)?.name || 'N/A'}</span>
                  <span><strong>Rows:</strong> {uploadResponse.rowCount}</span>
                  <span><strong>Bindings:</strong> {(manualBindings.length > 0 ? manualBindings : uploadResponse.fieldBindings).filter(b => b.confidence !== 'none').length}</span>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                  <button
                    onClick={handleExecuteRun}
                    disabled={loading || activeDdr?.status === 'running'}
                    className="btn btn-primary btn-lg"
                  >
                    {loading ? 'Starting...' : 'Run All Rows'}
                  </button>
                  {activeDdr?.status === 'running' && (
                    <button onClick={handleStopRun} className="btn btn-danger">Stop Run</button>
                  )}
                </div>
              </div>

              {/* Live Progress */}
              {activeDdr && (
                <div className="exec-progress" style={{ marginTop: '24px' }}>
                  <h3>
                    Run Progress
                    <span className="status-badge" style={{ backgroundColor: getStatusColor(activeDdr.status), marginLeft: '12px' }}>
                      {activeDdr.status.toUpperCase()}
                    </span>
                  </h3>

                  <div className="progress-bar-container">
                    <div className="progress-bar-track">
                      <div className="progress-bar-fill passed" style={{ width: `${activeDdr.totalRows ? (activeDdr.passedRows / activeDdr.totalRows) * 100 : 0}%` }}></div>
                      <div className="progress-bar-fill failed" style={{ width: `${activeDdr.totalRows ? (activeDdr.failedRows / activeDdr.totalRows) * 100 : 0}%` }}></div>
                    </div>
                    <div className="progress-label">
                      {activeDdr.completedRows}/{activeDdr.totalRows} rows completed
                    </div>
                  </div>

                  <div className="stats-grid">
                    <div className="stat-card"><div className="stat-value">{activeDdr.totalRows}</div><div className="stat-label">Total</div></div>
                    <div className="stat-card" style={{ borderTopColor: '#4caf50' }}><div className="stat-value" style={{ color: '#4caf50' }}>{activeDdr.passedRows}</div><div className="stat-label">Passed</div></div>
                    <div className="stat-card" style={{ borderTopColor: '#f44336' }}><div className="stat-value" style={{ color: '#f44336' }}>{activeDdr.failedRows}</div><div className="stat-label">Failed</div></div>
                    <div className="stat-card"><div className="stat-value">{activeDdr.totalRows > 0 ? Math.round((activeDdr.passedRows / activeDdr.totalRows) * 100) : 0}%</div><div className="stat-label">Pass Rate</div></div>
                  </div>

                  {activeDdr.aggregateReportUrl && (
                    <div style={{ marginTop: '12px' }}>
                      <a href={`http://localhost:3001${activeDdr.aggregateReportUrl}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                        View Allure Report
                      </a>
                    </div>
                  )}

                  {/* Per-row results */}
                  {rowResults.length > 0 && (
                    <div className="row-results" style={{ marginTop: '20px' }}>
                      <h3>Row Results</h3>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Status</th>
                            <th>Duration</th>
                            <th>Data</th>
                            <th>Error</th>
                            <th>Report</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowResults.map((row) => (
                            <tr key={row.rowIndex} className={`row-${row.status}`}>
                              <td>{row.rowIndex + 1}</td>
                              <td>
                                <span style={{ color: getStatusColor(row.status) }}>
                                  {getStatusIcon(row.status)} {row.status}
                                </span>
                              </td>
                              <td>{row.duration ? `${(row.duration / 1000).toFixed(1)}s` : '-'}</td>
                              <td className="data-cell">
                                <code>{row.dataValues ? JSON.stringify(row.dataValues).substring(0, 80) : '-'}</code>
                              </td>
                              <td className="error-cell">
                                {row.errorMsg ? <span className="error-text" title={row.errorMsg}>{row.errorMsg.substring(0, 60)}...</span> : '-'}
                              </td>
                              <td>
                                {row.reportUrl && (
                                  <a href={`http://localhost:3001${row.reportUrl}`} target="_blank" rel="noopener noreferrer">View</a>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* DDR History */}
              {ddrHistory.length > 0 && !activeDdr && (
                <div style={{ marginTop: '24px' }}>
                  <h3>Recent Runs</h3>
                  <table className="data-table">
                    <thead>
                      <tr><th>Name</th><th>Status</th><th>Rows</th><th>Pass Rate</th><th>Date</th><th>Report</th></tr>
                    </thead>
                    <tbody>
                      {ddrHistory.slice(0, 10).map(run => (
                        <tr key={run.id}>
                          <td>{run.name || run.scriptName}</td>
                          <td><span style={{ color: getStatusColor(run.status) }}>{getStatusIcon(run.status)} {run.status}</span></td>
                          <td>{run.passedRows}/{run.totalRows}</td>
                          <td>{run.totalRows > 0 ? Math.round((run.passedRows / run.totalRows) * 100) : 0}%</td>
                          <td>{new Date(run.createdAt).toLocaleDateString()}</td>
                          <td>
                            {run.aggregateReportUrl && (
                              <a href={`http://localhost:3001${run.aggregateReportUrl}`} target="_blank" rel="noopener noreferrer">View</a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <p>Upload a CSV file in the "Upload CSV" tab first, then come back here to execute.</p>
            </div>
          )}
        </div>
      )}

      {/* Field Binding Analysis (shown below active tab) */}
      {uploadResponse && activeTab !== 'execute' && activeTab !== 'preview' && (
        <div className="upload-response">
          <h2>Field Binding Analysis</h2>

          <div className="stats-grid">
            <div className="stat-card"><div className="stat-value">{uploadResponse.rowCount}</div><div className="stat-label">CSV Rows</div></div>
            <div className="stat-card"><div className="stat-value">{uploadResponse.csvHeaders.length}</div><div className="stat-label">Columns</div></div>
            <div className="stat-card"><div className="stat-value">{uploadResponse.fieldBindings.filter(fb => fb.confidence !== 'none').length}</div><div className="stat-label">Bound Fields</div></div>
            <div className="stat-card"><div className="stat-value">{uploadResponse.unmappedPlaceholders.length}</div><div className="stat-label">Unmapped</div></div>
          </div>

          <h3>Field Bindings</h3>
          <div className="bindings-table">
            <table>
              <thead><tr><th>CSV Column</th><th>Placeholder</th><th>Confidence</th></tr></thead>
              <tbody>
                {uploadResponse.fieldBindings.map((fb, idx) => (
                  <tr key={idx}>
                    <td><code>{fb.csvHeader}</code></td>
                    <td><code>{`{{${fb.placeholder}}}`}</code></td>
                    <td><span className={`badge badge-${fb.confidence}`} style={{ backgroundColor: getConfidenceColor(fb.confidence) }}>{fb.confidence.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {uploadResponse.unmappedHeaders.length > 0 && (
            <div className="warning-box">
              <strong>Unmapped Columns:</strong> {uploadResponse.unmappedHeaders.join(', ')}
            </div>
          )}
          {uploadResponse.unmappedPlaceholders.length > 0 && (
            <div className="warning-box">
              <strong>Unmapped Placeholders:</strong> {uploadResponse.unmappedPlaceholders.join(', ')}
            </div>
          )}

          <h3>Data Preview</h3>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  {uploadResponse.csvHeaders.map(header => (<th key={header}>{header}</th>))}
                </tr>
              </thead>
              <tbody>
                {uploadResponse.dataRows.slice(0, 5).map((row) => (
                  <tr key={row.index}>
                    <td className="row-number">{row.index + 1}</td>
                    {uploadResponse.csvHeaders.map(header => (
                      <td key={`${row.index}-${header}`}>{row.values[header]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {uploadResponse.dataRows.length > 5 && (
            <p className="text-muted">Showing 5 of {uploadResponse.dataRows.length} rows</p>
          )}

          {uploadResponse.savedSuiteId && (
            <div className="success-box">
              Saved to Suite: <code>{uploadResponse.savedSuiteId}</code> ({uploadResponse.savedCount} rows)
            </div>
          )}
        </div>
      )}

      {/* Analysis Results */}
      {analysisResult && (
        <div className="upload-response" style={{ marginTop: '30px' }}>
          <h2>Analysis Results</h2>

          {analysisResult.fieldTypes && (
            <div style={{ marginBottom: '30px' }}>
              <h3>Detected Field Types</h3>
              <table>
                <thead><tr><th>Column</th><th>Detected Type</th></tr></thead>
                <tbody>
                  {Object.entries(analysisResult.fieldTypes).map(([column, type]) => (
                    <tr key={column}>
                      <td><code>{column}</code></td>
                      <td><span style={{ display: 'inline-block', padding: '4px 8px', backgroundColor: '#e3f2fd', borderRadius: '4px', fontSize: '0.9rem', color: '#1976d2' }}>{String(type).replace(/_/g, ' ')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {analysisResult.validation && (
            <div>
              <h3>Data Validation</h3>
              <p><strong>Status:</strong> {analysisResult.validation.valid ? 'Valid' : 'Has Errors'}</p>
              <p><strong>Errors:</strong> {analysisResult.validation.errorCount} | <strong style={{ marginLeft: '20px' }}>Warnings:</strong> {analysisResult.validation.warningCount}</p>

              {analysisResult.validation.issues?.length > 0 && (
                <div style={{ backgroundColor: '#ffebee', border: '1px solid #ef5350', borderRadius: '4px', padding: '12px', marginTop: '12px' }}>
                  {analysisResult.validation.issues.map((issue: any, idx: number) => (
                    <div key={idx} style={{ marginBottom: '8px' }}>
                      <strong>Row {issue.row}, "{issue.column}":</strong> {issue.issue}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TestDataManagement;
