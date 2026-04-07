import React, { useState, useEffect } from 'react';
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

type TabType = 'upload' | 'parse' | 'preview' | 'manage';

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

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  // Load scripts on mount
  useEffect(() => {
    loadScripts();
  }, []);

  // Update selected script code
  useEffect(() => {
    if (selectedScriptId) {
      const script = scripts.find(s => s.id === selectedScriptId);
      if (script) {
        setSelectedScriptCode(script.code);
      }
    }
  }, [selectedScriptId, scripts]);

  const loadScripts = async () => {
    try {
      const res = await axios.get(`${API_URL}/scripts`, { headers });
      setScripts(res.data.data || []);
    } catch (err: any) {
      setError('Failed to load scripts');
      console.error(err);
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
        {
          headers: {
            ...headers,
            'Content-Type': 'multipart/form-data'
          }
        }
      );

      if (res.data.success) {
        // Restructure response to match component expectations
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
        setSuccess(`✅ ${res.data.message} ${res.data.persistence ? `${res.data.persistence.message}` : ''}`);
        setCsvFile(null);
        setSuiteName('');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to upload CSV');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleParseCsv = async () => {
    if (!csvContent.trim()) {
      setError('Please enter CSV content');
      return;
    }

    // Validate scriptId if binding analysis is enabled
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

      setSuccess(`✅ ${res.data.message}`);

      // Normalize field bindings from analysis
      const fieldBindings = res.data.analysis?.fieldBindings?.mapped || [];
      const unmappedHeaders = res.data.analysis?.fieldBindings?.unmapped?.columns || [];
      const unmappedPlaceholders = res.data.analysis?.fieldBindings?.unmapped?.placeholders || [];

      setUploadResponse({
        success: true,
        csvHeaders: res.data.csv?.headers || [],
        rowCount: res.data.csv?.rowCount || 0,
        fieldBindings: fieldBindings,
        unmappedHeaders: unmappedHeaders,
        unmappedPlaceholders: unmappedPlaceholders,
        dataRows: res.data.csv?.rows || []
      });

      // Store analysis results for display
      setAnalysisResult({
        analysis: res.data.analysis,
        fieldTypes: res.data.fieldTypes,
        validation: res.data.validation
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to parse CSV');
      console.error(err);
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
      uploadResponse.fieldBindings.forEach(fb => {
        if (fb.confidence !== 'none') {
          fieldBindings[fb.placeholder] = fb.csvHeader;
        }
      });

      const csvRow = uploadResponse.dataRows[previewRowIndex]?.values || {};

      const res = await axios.post(
        `${API_URL}/testdata/csv/preview-binding`,
        {
          scriptCode: selectedScriptCode,
          fieldBindings,
          csvRow
        },
        { headers }
      );

      // Restructure preview response to match component expectations
      const normalizedPreview: PreviewData = {
        originalCode: res.data.preview?.code?.original || res.data.originalCode || '',
        substitutedCode: res.data.preview?.code?.substituted || res.data.substitutedCode || '',
        appliedValues: res.data.preview?.appliedValues || res.data.appliedValues || {},
        previewRowIndex: res.data.preview?.rowIndex || res.data.previewRowIndex || 0,
        totalRows: res.data.preview?.totalRows || res.data.totalRows || 0
      };
      setPreviewData(normalizedPreview);
      setSuccess(`✅ ${res.data.message}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to generate preview');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'exact':
        return '#4caf50'; // Green
      case 'fuzzy':
        return '#ff9800'; // Orange
      case 'none':
        return '#f44336'; // Red
      default:
        return '#999';
    }
  };

  return (
    <div className="test-data-management">
      <h1 className="page-title">📊 Test Data Management</h1>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          📤 Upload CSV
        </button>
        <button
          className={`tab ${activeTab === 'parse' ? 'active' : ''}`}
          onClick={() => setActiveTab('parse')}
        >
          📝 Parse CSV
        </button>
        <button
          className={`tab ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
          disabled={!uploadResponse}
        >
          👁️ Preview
        </button>
        <button
          className={`tab ${activeTab === 'manage' ? 'active' : ''}`}
          onClick={() => setActiveTab('manage')}
        >
          🗂️ Manage Data
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
            <select
              value={selectedScriptId}
              onChange={(e) => setSelectedScriptId(e.target.value)}
              className="form-control"
            >
              <option value="">-- Select a script --</option>
              {scripts.map(script => (
                <option key={script.id} value={script.id}>
                  {script.name}
                </option>
              ))}
            </select>
            <small>Script must contain {'{'}placeholders{'}'} for field binding</small>
          </div>

          {selectedScriptCode && (
            <div className="form-group">
              <label>Script Code Preview</label>
              <div className="code-preview">
                <pre>{selectedScriptCode}</pre>
              </div>
            </div>
          )}

          <div className="form-group">
            <label>CSV File *</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="form-control"
            />
            {csvFile && <small>✓ {csvFile.name}</small>}
          </div>

          <div className="form-group">
            <label>Test Suite Name (Optional)</label>
            <input
              type="text"
              value={suiteName}
              onChange={(e) => setSuiteName(e.target.value)}
              placeholder="e.g., Login Test Data"
              className="form-control"
            />
          </div>

          <div className="form-group">
            <label>Environment</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              className="form-control"
            >
              <option value="dev">Dev</option>
              <option value="staging">Staging</option>
              <option value="prod">Production</option>
            </select>
          </div>

          <div className="form-group checkbox">
            <input
              type="checkbox"
              id="saveToDb"
              checked={saveToDb}
              onChange={(e) => setSaveToDb(e.target.checked)}
            />
            <label htmlFor="saveToDb">Save data to database</label>
          </div>

          <button
            onClick={handleUploadCsv}
            disabled={loading || !csvFile || !selectedScriptId}
            className="btn btn-primary"
          >
            {loading ? '⏳ Uploading...' : '📤 Upload & Analyze'}
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
              placeholder="email,password&#10;alice@example.com,Pass@123&#10;bob@example.com,Secure456!"
              className="form-control"
              rows={10}
            />
            <small>Enter CSV with headers and rows</small>
          </div>

          {/* Optional Analysis Features */}
          <div style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '6px', marginTop: '20px', marginBottom: '20px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '15px', fontSize: '1rem' }}>Optional: Add Analysis</h3>

            <div className="form-group checkbox">
              <input
                type="checkbox"
                id="analyzeBindings"
                checked={analyzeBindings}
                onChange={(e) => setAnalyzeBindings(e.target.checked)}
              />
              <label htmlFor="analyzeBindings">Analyze field bindings to script</label>
            </div>

            {analyzeBindings && (
              <div className="form-group">
                <label>Select Script (for binding analysis) *</label>
                <select
                  value={parseScriptId}
                  onChange={(e) => setParseScriptId(e.target.value)}
                  className="form-control"
                >
                  <option value="">-- Select a script --</option>
                  {scripts.map(script => (
                    <option key={script.id} value={script.id}>
                      {script.name}
                    </option>
                  ))}
                </select>
                <small>Shows field binding confidence (exact/fuzzy/none)</small>
              </div>
            )}

            <div className="form-group checkbox">
              <input
                type="checkbox"
                id="detectFieldTypes"
                checked={detectFieldTypes}
                onChange={(e) => setDetectFieldTypes(e.target.checked)}
              />
              <label htmlFor="detectFieldTypes">Auto-detect field types (email, password, URL, etc.)</label>
            </div>

            <div className="form-group checkbox">
              <input
                type="checkbox"
                id="validateData"
                checked={validateData}
                onChange={(e) => setValidateData(e.target.checked)}
              />
              <label htmlFor="validateData">Validate data formats (email, phone, URL, etc.)</label>
            </div>
          </div>

          <button
            onClick={handleParseCsv}
            disabled={loading || !csvContent.trim() || (analyzeBindings && !parseScriptId)}
            className="btn btn-primary"
          >
            {loading ? '⏳ Parsing...' : '📝 Parse CSV'}
          </button>
        </div>
      )}

      {/* Preview Tab */}
      {activeTab === 'preview' && (
        <div className="tab-content">
          <h2>Preview Field Binding Substitution</h2>

          {uploadResponse && (
            <div>
              <div className="form-group">
                <label>Select Row to Preview</label>
                <select
                  value={previewRowIndex}
                  onChange={(e) => setPreviewRowIndex(parseInt(e.target.value))}
                  className="form-control"
                >
                  {uploadResponse.dataRows.map((_row, idx) => (
                    <option key={idx} value={idx}>
                      Row {idx + 1}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handlePreviewBinding}
                disabled={loading}
                className="btn btn-primary"
              >
                {loading ? '⏳ Generating...' : '👁️ Generate Preview'}
              </button>

              {previewData && (
                <div className="preview-result">
                  <h3>Original Code</h3>
                  <div className="code-preview original">
                    <pre>{previewData.originalCode}</pre>
                  </div>

                  <h3>Substituted Code</h3>
                  <div className="code-preview substituted">
                    <pre>{previewData.substitutedCode}</pre>
                  </div>

                  <h3>Applied Values</h3>
                  <div className="values-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Placeholder</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(previewData.appliedValues).map(([key, value]) => (
                          <tr key={key}>
                            <td><code>{key}</code></td>
                            <td><code>{value}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Upload Response / Data Table */}
      {uploadResponse && (
        <div className="upload-response">
          <h2>📋 Field Binding Analysis</h2>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{uploadResponse.rowCount}</div>
              <div className="stat-label">CSV Rows</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{uploadResponse.csvHeaders.length}</div>
              <div className="stat-label">Columns</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {uploadResponse.fieldBindings.filter(fb => fb.confidence !== 'none').length}
              </div>
              <div className="stat-label">Bound Fields</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{uploadResponse.unmappedPlaceholders.length}</div>
              <div className="stat-label">Unmapped</div>
            </div>
          </div>

          <h3>Field Bindings</h3>
          <div className="bindings-table">
            <table>
              <thead>
                <tr>
                  <th>CSV Column</th>
                  <th>Placeholder</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {uploadResponse.fieldBindings.map((fb, idx) => (
                  <tr key={idx}>
                    <td><code>{fb.csvHeader}</code></td>
                    <td><code>{fb.placeholder}</code></td>
                    <td>
                      <span
                        className={`badge badge-${fb.confidence}`}
                        style={{ backgroundColor: getConfidenceColor(fb.confidence) }}
                      >
                        {fb.confidence.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {uploadResponse.unmappedHeaders.length > 0 && (
            <div className="warning-box">
              <strong>⚠️ Unmapped Columns:</strong> {uploadResponse.unmappedHeaders.join(', ')}
            </div>
          )}

          {uploadResponse.unmappedPlaceholders.length > 0 && (
            <div className="warning-box">
              <strong>⚠️ Unmapped Placeholders:</strong> {uploadResponse.unmappedPlaceholders.join(', ')}
            </div>
          )}

          <h3>Data Preview</h3>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  {uploadResponse.csvHeaders.map(header => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uploadResponse.dataRows.slice(0, 5).map((row) => (
                  <tr key={row.index}>
                    <td className="row-number">{row.index + 1}</td>
                    {uploadResponse.csvHeaders.map(header => (
                      <td key={`${row.index}-${header}`}>
                        {row.values[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {uploadResponse.dataRows.length > 5 && (
            <p className="text-muted">
              Showing 5 of {uploadResponse.dataRows.length} rows
            </p>
          )}

          {uploadResponse.savedSuiteId && (
            <div className="success-box">
              ✅ Saved to Suite: <code>{uploadResponse.savedSuiteId}</code>
              <br />
              Rows: {uploadResponse.savedCount}
            </div>
          )}
        </div>
      )}

      {/* Analysis Results (Field Types & Validation) */}
      {analysisResult && (
        <div className="upload-response" style={{ marginTop: '30px' }}>
          <h2>📊 Analysis Results</h2>

          {/* Field Types Detection */}
          {analysisResult.fieldTypes && (
            <div style={{ marginBottom: '30px' }}>
              <h3>🔍 Detected Field Types</h3>
              <table>
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Detected Type</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(analysisResult.fieldTypes).map(([column, type]) => (
                    <tr key={column}>
                      <td><code>{column}</code></td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          backgroundColor: '#e3f2fd',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                          color: '#1976d2'
                        }}>
                          {String(type).replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Data Validation */}
          {analysisResult.validation && (
            <div>
              <h3>✅ Data Validation</h3>
              <div style={{ marginBottom: '20px' }}>
                <p>
                  <strong>Status:</strong> {analysisResult.validation.valid ? '✅ Valid' : '❌ Has Errors'}
                </p>
                <p>
                  <strong>Errors:</strong> {analysisResult.validation.errorCount} |
                  <strong style={{ marginLeft: '20px' }}>Warnings:</strong> {analysisResult.validation.warningCount}
                </p>
              </div>

              {analysisResult.validation.issues.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h4>🔴 Errors</h4>
                  <div style={{
                    backgroundColor: '#ffebee',
                    border: '1px solid #ef5350',
                    borderRadius: '4px',
                    padding: '12px'
                  }}>
                    {analysisResult.validation.issues.map((issue: any, idx: number) => (
                      <div key={idx} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: idx < analysisResult.validation.issues.length - 1 ? '1px solid #ef5350' : 'none' }}>
                        <strong>Row {issue.row}, Column "{issue.column}":</strong> {issue.issue}
                        {issue.value && <div><code>{issue.value}</code></div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysisResult.validation.warnings.length > 0 && (
                <div>
                  <h4>🟠 Warnings</h4>
                  <div style={{
                    backgroundColor: '#fff3e0',
                    border: '1px solid #ff9800',
                    borderRadius: '4px',
                    padding: '12px'
                  }}>
                    {analysisResult.validation.warnings.map((warning: any, idx: number) => (
                      <div key={idx} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: idx < analysisResult.validation.warnings.length - 1 ? '1px solid #ff9800' : 'none' }}>
                        <strong>Row {warning.row}, Column "{warning.column}":</strong> {warning.issue}
                      </div>
                    ))}
                  </div>
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
