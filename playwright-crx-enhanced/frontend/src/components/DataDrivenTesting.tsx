import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Wand2,
  Download,
  Upload,
  Play,
  Copy,
  Trash2,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Eye,
  Code,
  FileText,
  Database,
  Sparkles,
  Link,
  Settings,
  Square,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  AlertTriangle
} from 'lucide-react';
import './DataDrivenTesting.css';

const API_URL = 'http://localhost:3001/api';

interface Script {
  id: string;
  name: string;
  code: string;
  language: string;
}

interface ExtractedField {
  name: string;
  type: string;
  selector?: string;
  confidence: number;
}

interface GeneratedTestData {
  _testDataType: string;
  _index: number;
  [key: string]: any;
}

interface CsvDataRow {
  index: number;
  values: Record<string, string>;
}

interface Placeholder {
  name: string;
  line: number;
  context: string;
}

interface RowResult {
  rowIndex: number;
  dataValues: Record<string, any>;
  testRunId: string;
  status: string;
  duration: number | null;
  errorMsg: string | null;
  reportUrl: string | null;
  steps: { stepNumber: number; action: string; selector: string; value: string; status: string; duration: number; errorMsg: string | null }[];
}

interface DDRResult {
  dataDrivenRun: any;
  summary: {
    total: number;
    completed: number;
    passed: number;
    failed: number;
    passRate: number;
    totalDuration: number;
  };
  rowResults: RowResult[];
}

const DataDrivenTesting = () => {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([]);
  const [extractingFields, setExtractingFields] = useState(false);
  const [showFields, setShowFields] = useState(true);
  const [testDataType, setTestDataType] = useState<'all' | 'boundary' | 'positive' | 'negative' | 'security' | 'equivalence'>('all');
  const [dataCount, setDataCount] = useState(10);
  const [generatedData, setGeneratedData] = useState<GeneratedTestData[]>([]);
  const [dataSource, setDataSource] = useState<string>('');
  const [dataContext, setDataContext] = useState<any>(null);
  const [generatingData, setGeneratingData] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [uploadedScript, setUploadedScript] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);

  // Step 3: Field Binding
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [fieldBindings, setFieldBindings] = useState<Record<string, string>>({});
  const [loadingPlaceholders, setLoadingPlaceholders] = useState(false);

  // Step 4: Execution Config
  const [executionMode, setExecutionMode] = useState<'sequential' | 'parallel'>('sequential');
  const [stopOnFirstFailure, setStopOnFirstFailure] = useState(false);
  const [delayBetweenRows, setDelayBetweenRows] = useState(500);
  const [executionBrowser, setExecutionBrowser] = useState('chromium');

  // Step 5: Results
  const [dataDrivenRunId, setDataDrivenRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState('idle');
  const [runResults, setRunResults] = useState<DDRResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeStep, setActiveStep] = useState(1);

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    loadScripts();
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  const loadScripts = async () => {
    setLoadingScripts(true);
    try {
      const res = await axios.get(`${API_URL}/scripts`, { headers });
      setScripts(res.data?.data || res.data?.scripts || []);
    } catch (error) {
      console.error('Failed to load scripts:', error);
    } finally {
      setLoadingScripts(false);
    }
  };

  const loadScriptCode = async (scriptId: string): Promise<string> => {
    try {
      const res = await axios.get(`${API_URL}/scripts/${scriptId}`, { headers });
      return res.data?.data?.code || res.data?.code || '';
    } catch { return ''; }
  };

  const extractFieldsWithAI = async (scriptCode: string) => {
    if (!scriptCode) { setExtractedFields([]); return; }
    setExtractingFields(true);
    setExtractedFields([]);
    try {
      const response = await axios.post(`${API_URL}/ai-analysis/xpath-analyze`, { scriptCode }, { headers });
      setExtractedFields(response.data?.fields || []);
      setShowFields(true);
    } catch {
      setExtractedFields(extractFieldsManually(scriptCode));
    } finally {
      setExtractingFields(false);
    }
  };

  const extractFieldsManually = (code: string): ExtractedField[] => {
    if (!code) return [];
    const fields: ExtractedField[] = [];
    const patterns = [/fill\(['"]#?([^'"`]+)['"]/, /fill\(['"]\.([^'"`]+)['"]/, /getByPlaceholder\(['"]([^'"`]+)['"]/, /getByLabel\(['"]([^'"`]+)['"]/];
    patterns.forEach(pattern => {
      const matches = code.matchAll(new RegExp(pattern, 'g'));
      for (const match of matches) {
        const fieldName = match[1];
        if (fieldName && !fields.find(f => f.name === fieldName)) {
          fields.push({ name: fieldName, type: inferFieldType(fieldName), confidence: 0.6 });
        }
      }
    });
    return fields;
  };

  const inferFieldType = (fieldName: string): string => {
    const n = fieldName.toLowerCase();
    if (n.includes('email')) return 'email';
    if (n.includes('password')) return 'password';
    if (n.includes('phone')) return 'phone';
    if (n.includes('amount') || n.includes('price')) return 'number';
    return 'text';
  };

  const doExtractPlaceholders = async () => {
    if (!selectedScript) return;
    setLoadingPlaceholders(true);
    try {
      const res = await axios.post(`${API_URL}/data-driven-runs/extract-placeholders`, { scriptId: selectedScript.id }, { headers });
      const phs: Placeholder[] = res.data?.placeholders || [];
      setPlaceholders(phs);
      autoBindFields(phs);
    } catch {
      const code = selectedScript.code || '';
      const phs: Placeholder[] = [];
      const seen = new Set<string>();
      code.split('\n').forEach((line, i) => {
        for (const match of line.matchAll(/\{\{(\w+)\}\}/g)) {
          if (!seen.has(match[1])) { seen.add(match[1]); phs.push({ name: match[1], line: i + 1, context: line.trim().substring(0, 80) }); }
        }
      });
      setPlaceholders(phs);
      autoBindFields(phs);
    } finally {
      setLoadingPlaceholders(false);
    }
  };

  const autoBindFields = (phs: Placeholder[]) => {
    if (generatedData.length === 0) return;
    const dataFields = Object.keys(generatedData[0]).filter(k => !k.startsWith('_'));
    const bindings: Record<string, string> = {};
    for (const ph of phs) {
      const exact = dataFields.find(f => f.toLowerCase() === ph.name.toLowerCase());
      if (exact) { bindings[ph.name] = exact; continue; }
      const fuzzy = dataFields.find(f => f.toLowerCase().includes(ph.name.toLowerCase()) || ph.name.toLowerCase().includes(f.toLowerCase()));
      if (fuzzy) bindings[ph.name] = fuzzy;
    }
    setFieldBindings(bindings);
  };

  const generateTestData = async () => {
    if (!selectedScript && !uploadedScript) { alert('Please select a script first'); return; }
    setGeneratingData(true);
    setGeneratedData([]);
    try {
      const scriptCode = selectedScript?.code || uploadedScript;
      const endpoints: Record<string, string> = {
        all: `${API_URL}/external-api/testdata/all`, boundary: `${API_URL}/external-api/testdata/boundary`,
        positive: `${API_URL}/external-api/testdata/positive`, negative: `${API_URL}/external-api/testdata/negative`,
        security: `${API_URL}/external-api/testdata/security`, equivalence: `${API_URL}/external-api/testdata/equivalence`
      };
      const response = await axios.post(endpoints[testDataType] || endpoints.all, { scriptCode, count: dataCount, testDataType: testDataType === 'all' ? undefined : testDataType }, { headers });
      const data = response.data?.data || [];
      setGeneratedData(data);
      setDataSource(response.data?.source || '');
      setDataContext(response.data?.context || null);
      setShowPreview(true);
      if (data.length > 0) setActiveStep(3);
    } catch (error: any) {
      alert(`Failed to generate test data: ${error.response?.data?.error || error.message}`);
    } finally {
      setGeneratingData(false);
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedScript) return;
    setCsvUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('scriptId', selectedScript.id);
      const res = await axios.post(`${API_URL}/testdata/csv/upload-and-bind`, formData, {
        headers: { ...headers, 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.success) {
        const rows: CsvDataRow[] = res.data.csv?.rows || [];
        const csvData: GeneratedTestData[] = rows.map((r: CsvDataRow, i: number) => ({
          _testDataType: 'csv-upload',
          _index: i + 1,
          ...r.values
        }));
        setGeneratedData(csvData);
        setShowPreview(true);

        // Auto-bind from API response
        const mapped = res.data.analysis?.fieldBindings?.mapped || [];
        const bindings: Record<string, string> = {};
        const phs: Placeholder[] = [];
        mapped.forEach((fb: any) => {
          if (fb.confidence !== 'none') {
            bindings[fb.placeholder] = fb.csvHeader;
            phs.push({ name: fb.placeholder, line: 0, context: `Bound to CSV column: ${fb.csvHeader}` });
          }
        });
        setPlaceholders(phs);
        setFieldBindings(bindings);
        setActiveStep(phs.length > 0 ? 3 : 2);
      }
    } catch (error: any) {
      alert(`CSV upload failed: ${error.response?.data?.error || error.message}`);
    } finally {
      setCsvUploading(false);
      e.target.value = '';
    }
  };

  const downloadTestData = (format: 'json' | 'csv') => {
    if (generatedData.length === 0) return;
    if (format === 'json') {
      const link = document.createElement('a');
      link.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(generatedData, null, 2)));
      link.setAttribute('download', `test-data-${Date.now()}.json`);
      link.click();
    } else {
      const h = Object.keys(generatedData[0]);
      const csv = [h.join(','), ...generatedData.map(row => h.map(k => `"${typeof row[k] === 'string' ? row[k] : JSON.stringify(row[k])}"`).join(','))].join('\n');
      const link = document.createElement('a');
      link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv));
      link.setAttribute('download', `test-data-${Date.now()}.csv`);
      link.click();
    }
  };

  const startDataDrivenRun = async () => {
    if (!selectedScript || generatedData.length === 0 || Object.keys(fieldBindings).length === 0) {
      alert('Please complete all steps before starting a run');
      return;
    }
    setIsExecuting(true);
    setRunStatus('starting');
    try {
      const createRes = await axios.post(`${API_URL}/data-driven-runs`, {
        scriptId: selectedScript.id, dataRows: generatedData, fieldBindings,
        browser: executionBrowser, executionMode,
        executionConfig: { stopOnFirstFailure, delayBetweenRows, maxParallel: executionMode === 'parallel' ? 3 : 1 }
      }, { headers });
      const ddrId = createRes.data.data.id;
      setDataDrivenRunId(ddrId);
      await axios.post(`${API_URL}/data-driven-runs/${ddrId}/start`, {}, { headers });
      setRunStatus('running');
      setActiveStep(5);
      startPolling(ddrId);
    } catch (error: any) {
      alert(`Failed to start run: ${error.response?.data?.error || error.message}`);
      setIsExecuting(false);
      setRunStatus('idle');
    }
  };

  const startPolling = (ddrId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    const poll = async () => {
      try {
        const res = await axios.get(`${API_URL}/data-driven-runs/${ddrId}/results`, { headers });
        setRunResults(res.data);
        const status = res.data.dataDrivenRun.status;
        setRunStatus(status);
        if (['passed', 'failed', 'partial', 'cancelled'].includes(status)) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setIsExecuting(false);
        }
      } catch (error) { console.error('Polling error:', error); }
    };
    poll();
    pollIntervalRef.current = setInterval(poll, 2000);
  };

  const stopDataDrivenRun = async () => {
    if (!dataDrivenRunId) return;
    try {
      await axios.post(`${API_URL}/data-driven-runs/${dataDrivenRunId}/stop`, {}, { headers });
      setRunStatus('cancelled');
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setIsExecuting(false);
    } catch (error: any) { console.error('Failed to stop run:', error); }
  };

  const toggleRowExpand = (idx: number) => {
    setExpandedRows(prev => { const next = new Set(prev); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; });
  };

  const clearAll = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setSelectedScript(null); setUploadedScript(''); setExtractedFields([]); setGeneratedData([]);
    setPlaceholders([]); setFieldBindings({}); setDataDrivenRunId(null); setRunStatus('idle');
    setRunResults(null); setIsExecuting(false); setActiveStep(1); setExpandedRows(new Set());
  };

  const getStatusClass = (status: string) => {
    const map: Record<string, string> = { passed: 'ddt-badge-passed', failed: 'ddt-badge-failed', running: 'ddt-badge-running', partial: 'ddt-badge-partial', cancelled: 'ddt-badge-cancelled', queued: 'ddt-badge-queued' };
    return map[status] || 'ddt-badge-pending';
  };

  const getAvailableDataFields = () => generatedData.length > 0 ? Object.keys(generatedData[0]).filter(k => !k.startsWith('_')) : [];

  return (
    <div className="ddt-container">
      {/* Header */}
      <div className="ddt-header">
        <div className="ddt-title">
          <Database className="ddt-icon" />
          <div>
            <h1>Data-Driven Testing</h1>
            <p>Generate test data, bind to script placeholders, and execute data-driven runs</p>
          </div>
        </div>
        <div className="ddt-actions">
          <button onClick={clearAll} className="btn-secondary"><RefreshCw size={16} /> Clear All</button>
        </div>
      </div>

      {/* Step Indicators */}
      <div className="ddt-steps-indicator">
        {[{ num: 1, label: 'Select Script' }, { num: 2, label: 'Generate Data' }, { num: 3, label: 'Bind Fields' }, { num: 4, label: 'Configure' }, { num: 5, label: 'Results' }].map(step => (
          <div key={step.num} className={`ddt-step-indicator ${activeStep >= step.num ? 'active' : ''} ${activeStep === step.num ? 'current' : ''}`}
            onClick={() => { if (step.num <= activeStep) setActiveStep(step.num); }}>
            <span className="ddt-step-num">{step.num}</span>
            <span className="ddt-step-label">{step.label}</span>
          </div>
        ))}
      </div>

      <div className="ddt-grid">
        {/* Left Panel */}
        <div className="ddt-panel">
          <div className="ddt-panel-header">
            <h2><FileText size={18} /> 1. Select Script</h2>
            <p>Choose a script with {'{{placeholder}}'} variables</p>
          </div>
          <div className="ddt-section">
            <label className="ddt-label">Select from Database</label>
            <select className="ddt-select" value={selectedScript?.id || ''} disabled={loadingScripts}
              onChange={async (e) => { const s = scripts.find(s => s.id === e.target.value); if (s) { const code = await loadScriptCode(s.id); setSelectedScript({ ...s, code }); setUploadedScript(''); extractFieldsWithAI(code); setActiveStep(2); } }}>
              <option value="">-- Select a script --</option>
              {scripts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.language})</option>)}
            </select>
            <div className="ddt-divider"><span>OR</span></div>
            <button onClick={() => setShowUploadModal(true)} className="btn-secondary w-full"><Upload size={16} /> Upload Custom Script</button>
          </div>

          {extractedFields.length > 0 && (
            <div className="ddt-section">
              <div className="ddt-collapsible-header" onClick={() => setShowFields(!showFields)}>
                <div className="ddt-collapsible-title"><Sparkles size={16} /><span>AI-Extracted Fields ({extractedFields.length})</span></div>
                {showFields ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
              {showFields && (
                <div className="ddt-fields-list">
                  {extractedFields.map((f, i) => (
                    <div key={i} className="ddt-field-item">
                      <div className="ddt-field-info">
                        <span className="ddt-field-name">{f.name}</span>
                        <span className="ddt-field-type">{f.type}</span>
                        <span className="ddt-field-confidence">{Math.round(f.confidence * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(selectedScript || uploadedScript) && (
            <>
              <div className="ddt-panel-header" style={{ marginTop: '16px' }}>
                <h2><Sparkles size={18} /> 2. Generate Test Data</h2>
              </div>
              <div className="ddt-section">
                <div className="ddt-form-group">
                  <label className="ddt-label">Test Data Type</label>
                  <select className="ddt-select" value={testDataType} onChange={(e) => setTestDataType(e.target.value as any)}>
                    <option value="all">All Types (Comprehensive)</option>
                    <option value="boundary">Boundary Value Analysis</option>
                    <option value="positive">Positive Testing</option>
                    <option value="negative">Negative Testing</option>
                    <option value="security">Security Testing</option>
                    <option value="equivalence">Equivalence Partitioning</option>
                  </select>
                </div>
                <div className="ddt-form-group">
                  <label className="ddt-label">Records: {dataCount}</label>
                  <input type="range" className="ddt-slider" min="1" max="50" value={dataCount} onChange={(e) => setDataCount(parseInt(e.target.value))} />
                </div>
                <button onClick={generateTestData} disabled={generatingData} className="btn-primary w-full">
                  {generatingData ? <><RefreshCw size={16} className="spinning" /> Generating...</> : <><Wand2 size={16} /> Generate Test Data</>}
                </button>

                <div className="ddt-divider"><span>OR</span></div>

                <label className={`btn-secondary w-full ddt-csv-upload-btn ${csvUploading ? 'disabled' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: csvUploading ? 'not-allowed' : 'pointer' }}>
                  <Upload size={16} /> {csvUploading ? 'Uploading...' : 'Upload CSV File'}
                  <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: 'none' }} disabled={csvUploading} />
                </label>
                <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '4px', textAlign: 'center' }}>
                  CSV headers auto-bind to script {'{{placeholders}}'}
                </p>
              </div>

              {generatedData.length > 0 && (
                <div className="ddt-section">
                  <div className="ddt-collapsible-header" onClick={() => setShowPreview(!showPreview)}>
                    <div className="ddt-collapsible-title"><Eye size={16} /><span>Generated Data ({generatedData.length} records){dataSource && <span style={{ marginLeft: '8px', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px', background: dataSource.startsWith('chatgpt') ? '#e0f2fe' : '#f0fdf4', color: dataSource.startsWith('chatgpt') ? '#0369a1' : '#166534' }}>{dataSource.startsWith('chatgpt') ? 'AI: ' + dataSource : dataSource}</span>}</span></div>
                    {showPreview ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                  {showPreview && (
                    <div className="ddt-data-preview">
                      <div className="ddt-data-actions">
                        <button onClick={() => downloadTestData('json')} className="btn-secondary btn-sm"><Download size={14} /> JSON</button>
                        <button onClick={() => downloadTestData('csv')} className="btn-secondary btn-sm"><Download size={14} /> CSV</button>
                      </div>
                      {/* Table view for generated data */}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>#</th>
                              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Type</th>
                              {generatedData.length > 0 && Object.keys(generatedData[0]).filter(k => !k.startsWith('_')).map(k => (
                                <th key={k} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>{k}</th>
                              ))}
                              <th style={{ padding: '10px 8px', width: '40px' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {generatedData.slice(0, 10).map((rec, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '8px 12px', fontWeight: 600, color: '#374151' }}>{rec._index || idx + 1}</td>
                                <td style={{ padding: '8px 12px' }}>
                                  <span style={{ padding: '2px 8px', background: '#ddd6fe', color: '#6b21a8', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const }}>{rec._testDataType}</span>
                                </td>
                                {Object.entries(rec).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                                  <td key={k} style={{ padding: '8px 12px', fontFamily: "'Monaco','Courier New',monospace", fontSize: '12px', color: '#334155', maxWidth: '250px', wordBreak: 'break-word' as const }}>
                                    {typeof v === 'string' ? v : JSON.stringify(v)}
                                  </td>
                                ))}
                                <td style={{ padding: '8px' }}>
                                  <button onClick={() => navigator.clipboard.writeText(JSON.stringify(rec, null, 2))} className="ddt-icon-btn" title="Copy"><Copy size={14} /></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {generatedData.length > 10 && <div className="ddt-more-records">Showing 10 of {generatedData.length} records</div>}
                      {dataContext && (
                        <div style={{ marginTop: '12px', padding: '10px', background: '#f8fafc', borderRadius: '6px', fontSize: '0.8rem', color: '#64748b' }}>
                          <strong>AI Context:</strong> {dataContext.appType} app
                          {dataContext.url && <> at {dataContext.url}</>}
                          {dataContext.fields && <> | Fields: {dataContext.fields.map((f: any) => `${f.name}(${f.type})`).join(', ')}</>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {showUploadModal && (
            <div className="ddt-modal-overlay" onClick={() => setShowUploadModal(false)}>
              <div className="ddt-modal" onClick={e => e.stopPropagation()}>
                <div className="ddt-modal-header">
                  <h3>Upload Custom Script</h3>
                  <button onClick={() => setShowUploadModal(false)} className="ddt-close-btn">&times;</button>
                </div>
                <div className="ddt-modal-body">
                  <textarea className="ddt-textarea" placeholder="Paste your Playwright script code here..." value={uploadedScript} onChange={e => setUploadedScript(e.target.value)} rows={15} />
                  <div className="ddt-modal-actions">
                    <button onClick={() => { if (uploadedScript.trim()) { setSelectedScript(null); extractFieldsWithAI(uploadedScript); setShowUploadModal(false); setActiveStep(2); } }} className="btn-primary">
                      <Wand2 size={16} /> Extract Fields & Analyze
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="ddt-panel">

          {/* Step 3: Field Binding */}
          {generatedData.length > 0 && activeStep >= 3 && (
            <div className="ddt-section">
              <div className="ddt-panel-header">
                <h2><Link size={18} /> 3. Bind Fields</h2>
                <p>Map script {'{{placeholders}}'} to data fields</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button onClick={doExtractPlaceholders} disabled={loadingPlaceholders || !selectedScript} className="btn-secondary btn-sm">
                  {loadingPlaceholders ? <RefreshCw size={14} className="spinning" /> : <Wand2 size={14} />} Auto-Detect
                </button>
                <button onClick={() => setFieldBindings({})} className="btn-secondary btn-sm"><Trash2 size={14} /> Clear</button>
              </div>

              {placeholders.length > 0 ? (
                <div className="ddt-bindings-table">
                  {placeholders.map(ph => (
                    <div key={ph.name} className="ddt-binding-row">
                      <div className="ddt-binding-placeholder">
                        <Code size={14} />
                        <span className="ddt-binding-name">{`{{${ph.name}}}`}</span>
                        <span className="ddt-binding-line">L{ph.line}</span>
                      </div>
                      <span className="ddt-binding-arrow">&rarr;</span>
                      <select className="ddt-select ddt-binding-select" value={fieldBindings[ph.name] || ''} onChange={e => setFieldBindings(prev => ({ ...prev, [ph.name]: e.target.value }))}>
                        <option value="">-- Select field --</option>
                        {getAvailableDataFields().map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ddt-empty-state">
                  <p>Click "Auto-Detect" to find {'{{placeholder}}'} patterns in your script, or add manually below.</p>
                  <div className="ddt-manual-binding">
                    <input type="text" placeholder="Placeholder name" className="ddt-input" id="manual-ph-name" />
                    <select className="ddt-select" id="manual-ph-field">
                      <option value="">-- Field --</option>
                      {getAvailableDataFields().map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <button className="btn-secondary btn-sm" onClick={() => {
                      const nameEl = document.getElementById('manual-ph-name') as HTMLInputElement;
                      const fieldEl = document.getElementById('manual-ph-field') as HTMLSelectElement;
                      if (nameEl?.value && fieldEl?.value) {
                        setPlaceholders(prev => [...prev, { name: nameEl.value, line: 0, context: '' }]);
                        setFieldBindings(prev => ({ ...prev, [nameEl.value]: fieldEl.value }));
                        nameEl.value = '';
                      }
                    }}><Plus size={14} /> Add</button>
                  </div>
                </div>
              )}

              {Object.keys(fieldBindings).length > 0 && (
                <button className="btn-primary w-full" style={{ marginTop: '12px' }} onClick={() => setActiveStep(4)}>
                  Continue to Configuration
                </button>
              )}
            </div>
          )}

          {/* Step 4: Execution Config */}
          {activeStep >= 4 && (
            <div className="ddt-section">
              <div className="ddt-panel-header"><h2><Settings size={18} /> 4. Execution Config</h2></div>
              <div className="ddt-config-grid">
                <div className="ddt-form-group">
                  <label className="ddt-label">Execution Mode</label>
                  <select className="ddt-select" value={executionMode} onChange={e => setExecutionMode(e.target.value as any)}>
                    <option value="sequential">Sequential (one at a time)</option>
                    <option value="parallel">Parallel (batch of 3)</option>
                  </select>
                </div>
                <div className="ddt-form-group">
                  <label className="ddt-label">Browser</label>
                  <select className="ddt-select" value={executionBrowser} onChange={e => setExecutionBrowser(e.target.value)}>
                    <option value="chromium">Chromium</option>
                    <option value="firefox">Firefox</option>
                    <option value="webkit">WebKit</option>
                  </select>
                </div>
                <div className="ddt-form-group">
                  <label className="ddt-label"><input type="checkbox" checked={stopOnFirstFailure} onChange={e => setStopOnFirstFailure(e.target.checked)} /> Stop on first failure</label>
                </div>
                <div className="ddt-form-group">
                  <label className="ddt-label">Delay: {delayBetweenRows}ms</label>
                  <input type="range" className="ddt-slider" min="0" max="5000" step="100" value={delayBetweenRows} onChange={e => setDelayBetweenRows(parseInt(e.target.value))} />
                </div>
              </div>
              <div className="ddt-run-summary">
                <span>{generatedData.length} data rows</span>
                <span>{Object.keys(fieldBindings).length} bindings</span>
                <span>{executionMode}</span>
                <span>{executionBrowser}</span>
              </div>
              <button onClick={startDataDrivenRun} disabled={isExecuting || Object.keys(fieldBindings).length === 0} className="btn-primary w-full ddt-execute-btn">
                {isExecuting ? <><RefreshCw size={16} className="spinning" /> Running...</> : <><Play size={16} /> Start Data-Driven Run ({generatedData.length} rows)</>}
              </button>
            </div>
          )}

          {/* Step 5: Live Results */}
          {activeStep >= 5 && runResults && (
            <div className="ddt-section">
              <div className="ddt-panel-header">
                <h2><BarChart3 size={18} /> 5. Results</h2>
                <div className={`ddt-status-badge ${getStatusClass(runStatus)}`}>{runStatus}</div>
              </div>

              <div className="ddt-progress-container">
                <div className="ddt-progress-bar">
                  <div className="ddt-progress-fill ddt-progress-passed" style={{ width: `${runResults.summary.total > 0 ? (runResults.summary.passed / runResults.summary.total * 100) : 0}%` }} />
                  <div className="ddt-progress-fill ddt-progress-failed" style={{ width: `${runResults.summary.total > 0 ? (runResults.summary.failed / runResults.summary.total * 100) : 0}%` }} />
                </div>
                <div className="ddt-progress-stats">
                  <span className="ddt-stat-passed"><CheckCircle size={14} /> {runResults.summary.passed} passed</span>
                  <span className="ddt-stat-failed"><XCircle size={14} /> {runResults.summary.failed} failed</span>
                  <span className="ddt-stat-total">{runResults.summary.completed}/{runResults.summary.total} complete</span>
                  {runResults.summary.totalDuration > 0 && <span className="ddt-stat-duration"><Clock size={14} /> {(runResults.summary.totalDuration / 1000).toFixed(1)}s</span>}
                </div>
              </div>

              <div className="ddt-row-results">
                {runResults.rowResults.map(row => (
                  <div key={row.rowIndex} className={`ddt-row-result ${getStatusClass(row.status)}`}>
                    <div className="ddt-row-result-header" onClick={() => toggleRowExpand(row.rowIndex)}>
                      <div className="ddt-row-info">
                        {row.status === 'passed' ? <CheckCircle size={16} className="text-green" /> : row.status === 'failed' ? <XCircle size={16} className="text-red" /> : row.status === 'running' ? <RefreshCw size={16} className="spinning text-blue" /> : <Clock size={16} className="text-gray" />}
                        <span className="ddt-row-index">Row {row.rowIndex + 1}</span>
                        <span className="ddt-row-data-summary">
                          {row.dataValues ? Object.entries(row.dataValues).filter(([k]) => !k.startsWith('_')).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 15 ? v.substring(0, 15) + '...' : v}`).join(', ') : ''}
                        </span>
                      </div>
                      <div className="ddt-row-meta">
                        {row.duration && <span className="ddt-row-duration">{(row.duration / 1000).toFixed(1)}s</span>}
                        <span className={`ddt-status-badge ${getStatusClass(row.status)}`}>{row.status}</span>
                        {expandedRows.has(row.rowIndex) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    </div>
                    {expandedRows.has(row.rowIndex) && (
                      <div className="ddt-row-details">
                        {row.errorMsg && <div className="ddt-row-error"><AlertTriangle size={14} /> {row.errorMsg}</div>}
                        {row.steps && row.steps.length > 0 && (
                          <div className="ddt-steps-list">
                            {row.steps.map(step => (
                              <div key={step.stepNumber} className={`ddt-step ${step.status}`}>
                                <span className="ddt-step-num">{step.stepNumber}</span>
                                <span className="ddt-step-action">{step.action}</span>
                                <span className="ddt-step-selector">{step.selector || ''}</span>
                                {step.value && <span className="ddt-step-value">{step.value}</span>}
                                <span className={`ddt-step-status ${step.status}`}>
                                  {step.status === 'passed' ? <CheckCircle size={12} /> : step.status === 'failed' ? <XCircle size={12} /> : null}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {row.reportUrl && <a href={row.reportUrl} target="_blank" rel="noopener noreferrer" className="ddt-report-link">View Report</a>}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="ddt-result-actions">
                {isExecuting && <button onClick={stopDataDrivenRun} className="btn-danger"><Square size={16} /> Stop Run</button>}
                {runResults.dataDrivenRun.aggregateReportUrl && (
                  <a href={runResults.dataDrivenRun.aggregateReportUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary"><BarChart3 size={16} /> Aggregate Report</a>
                )}
                {!isExecuting && <button onClick={clearAll} className="btn-secondary"><RefreshCw size={16} /> New Run</button>}
              </div>
            </div>
          )}

          {activeStep < 3 && (
            <div className="ddt-empty-right-panel">
              <Database size={48} className="text-gray-300" />
              <h3>Complete Steps 1 & 2</h3>
              <p>Select a script and generate test data to continue with field binding and execution.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DataDrivenTesting;
