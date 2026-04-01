import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Edit2, Trash2, Copy, Play, Download, Upload, Search, Filter, Eye, EyeOff, Link2, Zap, FileCode } from 'lucide-react';
import './Dashboard.css';
import './ImportScriptModal.css';

interface TestSuite {
  id: string;
  name: string;
  description?: string;
}

interface TestDataItem {
  id: string;
  suiteId: string;
  name: string;
  environment: string;
  type: string;
  data: Record<string, any>;
}

const API_URL = 'http://localhost:3001/api';

const TestDataManager = () => {
  const [testSuites, setTestSuites] = useState<TestSuite[]>([]);
  const [selectedSuite, setSelectedSuite] = useState<TestSuite | null>(null);
  const [testData, setTestData] = useState<TestDataItem[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEnv, setFilterEnv] = useState('all');
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [showGenModal, setShowGenModal] = useState(false);
  const [genForm, setGenForm] = useState({
    useExistingSuite: true,
    suiteId: '',
    suiteName: '',
    dataType: 'user',
    count: 2,
    environment: 'dev',
    sample_data: { username: 'testuser@example.com', password: 'Test@123', role: 'admin' } as Record<string, any>,
  });
  // Field Binding state
  const [activeTab, setActiveTab] = useState<'data' | 'fieldBindings'>('data');
  const [fbScriptId, setFbScriptId] = useState('');
  const [fbScripts, setFbScripts] = useState<Array<{ id: string; name: string }>>([]);
  const [fbAnalysis, setFbAnalysis] = useState<any>(null);
  const [fbAnalyzing, setFbAnalyzing] = useState(false);
  const [fbBindings, setFbBindings] = useState<Record<string, string>>({});
  const [fbStrategies, setFbStrategies] = useState<string[]>(['positive']);
  const [fbCountPerStrategy, setFbCountPerStrategy] = useState(5);
  const [fbGeneratedData, setFbGeneratedData] = useState<any>(null);
  const [fbGenerating, setFbGenerating] = useState(false);

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  const [formData, setFormData] = useState<TestDataItem>({
    id: '',
    suiteId: '',
    name: '',
    environment: 'dev',
    type: 'user',
    data: {}
  });

  useEffect(() => {
    loadData();
    loadScripts();
  }, []);

  const loadData = async () => {
    try {
      const suitesRes = await axios.get(`${API_URL}/testdata/suites`, { headers });
      const suites = (suitesRes.data?.data || []).map((s: any) => ({ id: s.id, name: s.name, description: s.description || '' }));
      setTestSuites(suites);
      if (!selectedSuite && suites.length > 0) setSelectedSuite(suites[0]);

      const dataRes = await axios.get(`${API_URL}/testdata/data`, { headers });
      const list = (dataRes.data?.data || []).map((d: any) => ({
        id: d.id,
        suiteId: d.suiteId,
        name: d.name,
        environment: d.environment,
        type: d.type,
        data: typeof d.data === 'string' ? JSON.parse(d.data) : d.data,
      }));
      setTestData(list);
    } catch (error: any) {
      console.error('Failed to load test data:', error?.message || error);
    }
  };

  const saveData = async (suites: TestSuite[], data: TestDataItem[]) => {
    try {
      // Sync suites: create any that don't already exist on the backend
      for (const suite of suites) {
        const exists = testSuites.find(s => s.id === suite.id);
        if (!exists) {
          await axios.post(`${API_URL}/testdata/suites`, {
            name: suite.name,
            description: suite.description || ''
          }, { headers });
        }
      }

      // Sync data items: create any that don't already exist on the backend
      for (const item of data) {
        const exists = testData.find(d => d.id === item.id);
        if (!exists) {
          // Resolve suiteId — match by name if the imported ID doesn't exist
          let suiteId = item.suiteId;
          const suiteMatch = suites.find(s => s.id === item.suiteId);
          if (suiteMatch) {
            const backendSuite = testSuites.find(s => s.name === suiteMatch.name) || suites.find(s => s.name === suiteMatch.name);
            if (backendSuite) suiteId = backendSuite.id;
          }

          await axios.post(`${API_URL}/testdata/data`, {
            suiteId,
            name: item.name,
            environment: item.environment || 'dev',
            type: item.type || 'custom',
            data: item.data
          }, { headers });
        }
      }

      // Reload from backend to get canonical IDs
      await loadData();
    } catch (error: any) {
      console.error('Failed to save imported data:', error?.message || error);
      throw error;
    }
  };

  const openModal = (mode: string, item: TestDataItem | null = null) => {
    setModalMode(mode);
    if (item) {
      setFormData(item);
    } else {
      setFormData({
        id: '',
        suiteId: selectedSuite?.id || '',
        name: '',
        environment: 'dev',
        type: 'user',
        data: {}
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (modalMode === 'create') {
      if (!(selectedSuite?.id || formData.suiteId)) {
        alert('Please select a suite first');
        return;
      }
      const payload = {
        suiteId: selectedSuite?.id || formData.suiteId,
        name: formData.name,
        environment: formData.environment,
        type: formData.type,
        data: formData.data,
      };
      try {
        const res = await axios.post(`${API_URL}/testdata/data`, payload, { headers });
        const created = res.data?.data;
        const newItem: TestDataItem = {
          id: created.id,
          suiteId: created.suiteId,
          name: created.name,
          environment: created.environment,
          type: created.type,
          data: typeof created.data === 'string' ? JSON.parse(created.data) : created.data,
        };
        setTestData([...testData, newItem]);
      } catch (e: any) {
        alert(e?.response?.data?.error || 'Failed to create test data');
      }
    } else {
      try {
        const payload = {
          name: formData.name,
          environment: formData.environment,
          type: formData.type,
          data: formData.data,
        };
        const res = await axios.put(`${API_URL}/testdata/data/${formData.id}`, payload, { headers });
        const updatedItem = res.data?.data;
        const updated = testData.map(item => 
          item.id === formData.id ? {
            id: updatedItem.id,
            suiteId: updatedItem.suiteId,
            name: updatedItem.name,
            environment: updatedItem.environment,
            type: updatedItem.type,
            data: typeof updatedItem.data === 'string' ? JSON.parse(updatedItem.data) : updatedItem.data,
          } : item
        );
        setTestData(updated);
      } catch (e: any) {
        alert(e?.response?.data?.error || 'Failed to update test data');
      }
    }
    setShowModal(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this test data?')) {
      try {
        await axios.delete(`${API_URL}/testdata/data/${id}`, { headers });
        const updated = testData.filter(item => item.id !== id);
        setTestData(updated);
      } catch (e: any) {
        alert(e?.response?.data?.error || 'Failed to delete test data');
      }
    }
  };

  const handleDuplicate = async (item: TestDataItem) => {
    try {
      const payload = {
        suiteId: item.suiteId,
        name: `${item.name} (Copy)`,
        environment: item.environment,
        type: item.type,
        data: item.data,
      };
      const res = await axios.post(`${API_URL}/testdata/data`, payload, { headers });
      const created = res.data?.data;
      const newItem: TestDataItem = {
        id: created.id,
        suiteId: created.suiteId,
        name: created.name,
        environment: created.environment,
        type: created.type,
        data: typeof created.data === 'string' ? JSON.parse(created.data) : created.data,
      };
      const updated = [...testData, newItem];
      setTestData(updated);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to duplicate test data');
    }
  };

  const exportData = () => {
    const exportObj = {
      suites: testSuites,
      data: filteredData
    };
    const dataStr = JSON.stringify(exportObj, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', `testdata-${Date.now()}.json`);
    link.click();
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event: ProgressEvent<FileReader>) => {
        try {
          const result = event.target?.result as string;
          const imported = JSON.parse(result);
          if (imported.suites) setTestSuites(imported.suites);
          if (imported.data) setTestData(imported.data);
          await saveData(imported.suites || testSuites, imported.data || testData);
          alert('Data imported successfully!');
        } catch (error) {
          alert('Error importing data. Please check the file format.');
        }
      };
      reader.readAsText(file);
    }
  };

  const generatePlaywrightCode = (item: TestDataItem) => {
    const code = `// Playwright Test Data - ${item.name}
const testData = ${JSON.stringify(item.data, null, 2)};

// Usage in your test:
test('${item.name}', async ({ page }) => {
  await page.goto('your-url');
  ${item.type === 'user' ? `await page.fill('#username', testData.username);
  await page.fill('#password', testData.password);` : '// Use testData properties as needed'}
});`;
    
    navigator.clipboard.writeText(code);
    alert('Playwright code copied to clipboard!');
  };

  const filteredData = testData.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesEnv = filterEnv === 'all' || item.environment === filterEnv;
    const matchesSuite = !selectedSuite || item.suiteId === selectedSuite.id;
    return matchesSearch && matchesEnv && matchesSuite;
  });

  const togglePasswordVisibility = (id: string) => {
    setShowPasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Field Binding functions
  const loadScripts = async () => {
    try {
      const res = await axios.get(`${API_URL}/scripts`, { headers });
      const scripts = (res.data?.data || res.data || []).map((s: any) => ({ id: s.id, name: s.name }));
      setFbScripts(scripts);
    } catch {
      // Scripts may not be accessible yet
    }
  };

  const analyzeFieldBindings = async () => {
    if (!fbScriptId) { alert('Please select a script'); return; }
    setFbAnalyzing(true);
    setFbAnalysis(null);
    setFbGeneratedData(null);
    try {
      const res = await axios.post(`${API_URL}/testdata/field-bindings/analyze`, { scriptId: fbScriptId }, { headers });
      setFbAnalysis(res.data);
      setFbBindings(res.data.fieldBindings || {});
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to analyze field bindings');
    } finally {
      setFbAnalyzing(false);
    }
  };

  const generateWithBindings = async () => {
    if (!fbScriptId) { alert('Please select a script'); return; }
    setFbGenerating(true);
    try {
      const res = await axios.post(`${API_URL}/testdata/field-bindings/generate`, {
        scriptId: fbScriptId,
        strategies: fbStrategies,
        countPerStrategy: fbCountPerStrategy,
        suiteId: selectedSuite?.id,
        save: !!selectedSuite
      }, { headers });
      setFbGeneratedData(res.data);
      if (selectedSuite) {
        await loadData();
        alert(`Generated ${res.data.totalRows} data rows and saved to suite`);
      }
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Failed to generate data');
    } finally {
      setFbGenerating(false);
    }
  };

  const strategyOptions = ['positive', 'negative', 'boundary', 'equivalence', 'security'];

  const toggleStrategy = (s: string) => {
    setFbStrategies(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  return (
    <div className="view-container">
      <h1 className="view-title">Test Data Management</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #e2e8f0' }}>
        <button
          onClick={() => setActiveTab('data')}
          style={{
            padding: '10px 24px', border: 'none', cursor: 'pointer',
            borderBottom: activeTab === 'data' ? '2px solid #4f46e5' : '2px solid transparent',
            color: activeTab === 'data' ? '#4f46e5' : '#64748b',
            fontWeight: activeTab === 'data' ? 600 : 400,
            background: 'none', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6
          }}
        >
          <Search size={16} /> Test Data
        </button>
        <button
          onClick={() => setActiveTab('fieldBindings')}
          style={{
            padding: '10px 24px', border: 'none', cursor: 'pointer',
            borderBottom: activeTab === 'fieldBindings' ? '2px solid #4f46e5' : '2px solid transparent',
            color: activeTab === 'fieldBindings' ? '#4f46e5' : '#64748b',
            fontWeight: activeTab === 'fieldBindings' ? 600 : 400,
            background: 'none', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6
          }}
        >
          <Link2 size={16} /> Field Bindings
        </button>
      </div>

      {/* ========== FIELD BINDINGS TAB ========== */}
      {activeTab === 'fieldBindings' && (
        <div>
          <div className="content-card" style={{ marginBottom: 24 }}>
            <h2 style={{ margin: '0 0 8px' }}>Field Binding Analysis</h2>
            <p style={{ color: '#64748b', margin: '0 0 16px', fontSize: 14 }}>
              Analyze your Playwright script to detect {'{{placeholder}}'} patterns, auto-map them to form fields,
              and generate strategy-based test data.
            </p>

            {/* Script Selection */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 250 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Select Script</label>
                <select
                  value={fbScriptId}
                  onChange={e => { setFbScriptId(e.target.value); setFbAnalysis(null); setFbGeneratedData(null); }}
                  className="modal-input"
                  style={{ width: '100%' }}
                >
                  <option value="">-- Choose a script --</option>
                  {fbScripts.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={analyzeFieldBindings}
                disabled={!fbScriptId || fbAnalyzing}
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38 }}
              >
                <Zap size={16} />
                {fbAnalyzing ? 'Analyzing...' : 'Analyze Script'}
              </button>
            </div>
          </div>

          {/* Analysis Results */}
          {fbAnalysis && (
            <div className="content-card" style={{ marginBottom: 24 }}>
              <h3 style={{ margin: '0 0 12px' }}>
                <FileCode size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Analysis: {fbAnalysis.scriptName}
              </h3>

              {/* Placeholders */}
              {fbAnalysis.placeholders?.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Detected Placeholders ({fbAnalysis.placeholders.length})</h4>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {fbAnalysis.placeholders.map((ph: any, idx: number) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', background: '#f1f5f9', borderRadius: 6, fontSize: 13 }}>
                        <code style={{ fontWeight: 600, color: '#4f46e5' }}>{`{{${ph.name}}}`}</code>
                        <span style={{ color: '#94a3b8' }}>Line {ph.line}</span>
                        <span style={{ color: '#64748b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ph.context}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p style={{ color: '#f59e0b', fontSize: 14 }}>No {'{{placeholder}}'} patterns found. Add {'{{fieldName}}'} patterns to your script first.</p>
              )}

              {/* Field Binding Mapping */}
              {fbAnalysis.suggestions?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Field Binding Mapping</h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ textAlign: 'left', padding: '6px 12px' }}>Placeholder</th>
                        <th style={{ textAlign: 'left', padding: '6px 12px' }}>Mapped Field</th>
                        <th style={{ textAlign: 'left', padding: '6px 12px' }}>Confidence</th>
                        <th style={{ textAlign: 'left', padding: '6px 12px' }}>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fbAnalysis.suggestions.map((s: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 12px' }}>
                            <code style={{ color: '#4f46e5' }}>{`{{${s.placeholder}}}`}</code>
                          </td>
                          <td style={{ padding: '6px 12px' }}>
                            <input
                              value={fbBindings[s.placeholder] || ''}
                              onChange={e => setFbBindings(prev => ({ ...prev, [s.placeholder]: e.target.value }))}
                              className="modal-input"
                              style={{ width: '100%', padding: '4px 8px', fontSize: 13 }}
                            />
                          </td>
                          <td style={{ padding: '6px 12px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                              background: s.confidence === 'exact' ? '#dcfce7' : s.confidence === 'fuzzy' ? '#fef9c3' : '#fee2e2',
                              color: s.confidence === 'exact' ? '#166534' : s.confidence === 'fuzzy' ? '#854d0e' : '#991b1b'
                            }}>
                              {s.confidence}
                            </span>
                          </td>
                          <td style={{ padding: '6px 12px', color: '#64748b' }}>{s.fieldType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Generation Controls */}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 8 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Generate Test Data with Bindings</h4>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {strategyOptions.map(s => (
                    <button
                      key={s}
                      onClick={() => toggleStrategy(s)}
                      className={fbStrategies.includes(s) ? 'btn-primary' : 'btn-secondary'}
                      style={{ fontSize: 12, padding: '4px 12px', textTransform: 'capitalize' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Count per strategy</label>
                    <input
                      type="number" min={1} max={50} value={fbCountPerStrategy}
                      onChange={e => setFbCountPerStrategy(Number(e.target.value))}
                      className="modal-input" style={{ width: 80, padding: '4px 8px' }}
                    />
                  </div>
                  <button
                    onClick={generateWithBindings}
                    disabled={fbGenerating || fbStrategies.length === 0}
                    className="btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34 }}
                  >
                    <Play size={14} />
                    {fbGenerating ? 'Generating...' : `Generate (${fbStrategies.length * fbCountPerStrategy} rows)`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Generated Data Preview */}
          {fbGeneratedData && (
            <div className="content-card">
              <h3 style={{ margin: '0 0 12px' }}>
                Generated Data ({fbGeneratedData.totalRows} rows)
                {selectedSuite && <span style={{ fontSize: 12, color: '#22c55e', marginLeft: 8 }}>Saved to {selectedSuite.name}</span>}
              </h3>
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0', position: 'sticky', top: 0, background: '#fff' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>#</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Strategy</th>
                      {fbGeneratedData.placeholders?.map((ph: any) => (
                        <th key={ph.name} style={{ textAlign: 'left', padding: '6px 8px' }}>{ph.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fbGeneratedData.dataRows?.map((dr: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '4px 8px', color: '#94a3b8' }}>{idx + 1}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <span style={{
                            padding: '1px 6px', borderRadius: 3, fontSize: 11,
                            background: dr.strategy === 'positive' ? '#dcfce7' :
                              dr.strategy === 'negative' ? '#fee2e2' :
                              dr.strategy === 'boundary' ? '#fef9c3' :
                              dr.strategy === 'security' ? '#fce7f3' : '#e0e7ff',
                            color: dr.strategy === 'positive' ? '#166534' :
                              dr.strategy === 'negative' ? '#991b1b' :
                              dr.strategy === 'boundary' ? '#854d0e' :
                              dr.strategy === 'security' ? '#9d174d' : '#3730a3'
                          }}>
                            {dr.strategy}
                          </span>
                        </td>
                        {fbGeneratedData.placeholders?.map((ph: any) => {
                          const bindingKey = fbGeneratedData.fieldBindings?.[ph.name] || ph.name;
                          const val = dr.row[bindingKey];
                          return (
                            <td key={ph.name} style={{ padding: '4px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {val === null || val === undefined ? <span style={{ color: '#cbd5e1' }}>null</span> : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== TEST DATA TAB ========== */}
      {activeTab === 'data' && <>
      {/* Header and Import/Export */}
      <div className="content-card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Manage test data for Playwright automation</h2>
          </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <label className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <Upload className="w-4 h-4" />
            Import
            <input type="file" accept=".json" onChange={importData} style={{ display: 'none' }} />
          </label>
          <button onClick={exportData} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Download className="w-4 h-4" />
            Export
          </button>
          <button onClick={() => setShowGenModal(true)} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Generate Data
          </button>
        </div>
      </div>

        {/* Test Suites */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button
            onClick={() => setSelectedSuite(null)}
            className={!selectedSuite ? 'btn-primary' : 'btn-secondary'}
          >
            All Suites
          </button>
          {testSuites.map((suite: any) => (
            <button
              key={suite.id}
              onClick={() => setSelectedSuite(suite)}
              className={selectedSuite?.id === suite.id ? 'btn-primary' : 'btn-secondary'}
            >
              {suite.name}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="content-card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ position: 'relative' }}>
              <Search className="w-5 h-5" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
              <input
                type="text"
                placeholder="Search test data..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input"
                style={{ paddingLeft: 36 }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter className="w-5 h-5" style={{ color: '#6b7280' }} />
            <select
              value={filterEnv}
              onChange={(e) => setFilterEnv(e.target.value)}
              className="input"
            >
              <option value="all">All Environments</option>
              <option value="dev">Development</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>

          <button onClick={() => openModal('create')} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus className="w-5 h-5" />
            Add Test Data
          </button>
        </div>
      </div>

      {/* Test Data Grid */}
      <div className="stats-grid">
        {filteredData.map(item => (
          <div key={item.id} className="content-card">
            <div className="card-header">
              <div>
                <h3>{item.name}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span className="language-badge" style={{ background: '#9333ea' }}>{item.environment}</span>
                  <span className="language-badge" style={{ background: '#3b82f6' }}>{item.type}</span>
                </div>
              </div>
            </div>

            <div style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginBottom: 12, maxHeight: 160, overflowY: 'auto' }}>
              <pre style={{ fontSize: 13, color: '#1f2937' }}>
                {Object.entries(item.data).map(([key, value]) => (
                  <div key={key} style={{ marginBottom: 4 }}>
                    <span style={{ color: '#6b21a8', fontWeight: 600 }}>{key}:</span>{' '}
                    {key.toLowerCase().includes('password') ? (
                      <span>
                        {showPasswords[item.id] ? String(value) : '••••••••'}
                        <button onClick={() => togglePasswordVisibility(item.id)} className="btn-secondary" style={{ marginLeft: 8, padding: '2px 6px' }}>
                          {showPasswords[item.id] ? <EyeOff className="w-3 h-3 inline" /> : <Eye className="w-3 h-3 inline" />}
                        </button>
                      </span>
                    ) : (
                      String(value)
                    )}
                  </div>
                ))}
              </pre>
            </div>

            <div className="run-actions">
              <button onClick={() => generatePlaywrightCode(item)} className="btn-approve" title="Generate Playwright code">
                <Play className="w-4 h-4" />
              </button>
              <button onClick={() => handleDuplicate(item)} className="btn-secondary" title="Duplicate">
                <Copy className="w-4 h-4" />
              </button>
              <button onClick={() => openModal('edit', item)} className="btn-primary" title="Edit">
                <Edit2 className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(item.id)} className="btn-reject" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredData.length === 0 && (
        <div className="empty-state">
          <p className="benefit-text">No test data found. Create your first test data entry!</p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>{modalMode === 'create' ? 'Create Test Data' : 'Edit Test Data'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="settings-grid" style={{ marginBottom: 16 }}>
                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="form-input"
                    placeholder="e.g., Valid Admin User"
                  />
                </div>
                <div className="form-group">
                  <label>Environment</label>
                  <select
                    value={formData.environment}
                    onChange={(e) => setFormData({ ...formData, environment: e.target.value })}
                    className="form-select"
                  >
                    <option value="dev">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="form-select"
                  >
                    <option value="user">User</option>
                    <option value="product">Product</option>
                    <option value="api">API</option>
                    <option value="config">Config</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Test Data (JSON)</label>
                <textarea
                  value={JSON.stringify(formData.data, null, 2)}
                  onChange={(e) => {
                    try {
                      setFormData({ ...formData, data: JSON.parse(e.target.value) });
                    } catch (err) {
                      // Invalid JSON, keep existing
                    }
                  }}
                  className="form-textarea"
                  rows={8}
                  placeholder='{"username":"test@example.com","password":"Test@123"}'
                />
                {genForm.dataType === 'customJson' && (
                  <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', marginBottom: 8 }}>💡 Available Faker Functions:</div>
                    <div style={{ fontSize: 12, color: '#15803d', lineHeight: 1.6 }}>
                      • <code>{'{{'}faker.name{'}}'}</code> - Random full name<br/>
                      • <code>{'{{'}faker.email{'}}'}</code> - Random email<br/>
                      • <code>{'{{'}faker.phone{'}}'}</code> - Random phone number<br/>
                      • <code>{'{{'}faker.number(min-max){'}}'}</code> - Random number in range<br/>
                      • <code>{'{{'}faker.choice([A,B,C]){'}}'}</code> - Random choice from array<br/>
                      • <code>{'{{'}faker.date(2020-2024){'}}'}</code> - Random date in range<br/>
                      • <code>{'{{'}faker.uuid{'}}'}</code> - Random UUID<br/>
                      • <code>{'{{'}faker.boolean{'}}'}</code> - Random true/false
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={() => setShowModal(false)} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
                <button onClick={handleSave} className="btn-primary" style={{ flex: 1 }}>
                  {modalMode === 'create' ? 'Create' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGenModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Generate Test Data</h2>
              <button className="modal-close" onClick={() => setShowGenModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="settings-grid" style={{ marginBottom: 16 }}>
                <div className="form-group">
                  <label>Suite Mode</label>
                  <select
                    value={genForm.useExistingSuite ? 'existing' : 'new'}
                    onChange={(e) => setGenForm({ ...genForm, useExistingSuite: e.target.value === 'existing' })}
                    className="form-select"
                  >
                    <option value="existing">Use existing suite</option>
                    <option value="new">Create new suite</option>
                  </select>
                </div>
                {genForm.useExistingSuite ? (
                  <div className="form-group">
                    <label>Suite</label>
                    <select
                      value={genForm.suiteId}
                      onChange={(e) => setGenForm({ ...genForm, suiteId: e.target.value })}
                      className="form-select"
                    >
                      <option value="">Select a suite</option>
                      {testSuites.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="form-group">
                    <label>New Suite Name</label>
                    <input
                      type="text"
                      value={genForm.suiteName}
                      onChange={(e) => setGenForm({ ...genForm, suiteName: e.target.value })}
                      className="form-input"
                      placeholder="e.g., Generated Users"
                    />
                  </div>
                )}
                <div className="form-group">
                  <label>Data Type</label>
                  <select
                    value={genForm.dataType}
                    onChange={(e) => setGenForm({ ...genForm, dataType: e.target.value })}
                    className="form-select"
                  >
                    <option value="user">User</option>
                    <option value="product">Product</option>
                    <option value="order">Order</option>
                    <option value="boundaryValue">Boundary Value Analysis</option>
                    <option value="equivalencePartition">Equivalence Partitioning</option>
                    <option value="securityTest">Security Testing</option>
                    <option value="customJson">Custom JSON (Dynamic)</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Count</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={genForm.count}
                    onChange={(e) => setGenForm({ ...genForm, count: parseInt(e.target.value || '1', 10) })}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>Environment</label>
                  <select
                    value={genForm.environment}
                    onChange={(e) => setGenForm({ ...genForm, environment: e.target.value })}
                    className="form-select"
                  >
                    <option value="dev">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>
                  {genForm.dataType === 'customJson' ? 'JSON Template (Dynamic Generation)' : 'Sample Data (JSON)'}
                  {genForm.dataType === 'customJson' && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                      Use <code>{'{{'}faker.field{'}}'}</code> for dynamic values. Examples: <code>{'{{'}faker.name{'}}'}</code>, <code>{'{{'}faker.email{'}}'}</code>, <code>{'{{'}faker.number(1-100){'}}'}</code>
                    </div>
                  )}
                </label>
                <textarea
                  value={JSON.stringify(genForm.sample_data, null, 2)}
                  onChange={(e) => {
                    try {
                      setGenForm({ ...genForm, sample_data: JSON.parse(e.target.value) });
                    } catch {}
                  }}
                  className="form-textarea"
                  rows={genForm.dataType === 'customJson' ? 12 : 6}
                  placeholder={genForm.dataType === 'customJson' 
                    ? '{\n  "name": "{{faker.name}}",\n  "email": "{{faker.email}}",\n  "age": "{{faker.number(18-65)}}",\n  "salary": "{{faker.number(30000-150000)}}",\n  "department": "{{faker.choice([Finance,IT,HR,Sales])}}",\n  "joinDate": "{{faker.date(2020-2024)}}"\n}'
                    : '{"username":"test@example.com","password":"Test@123"}'}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={() => setShowGenModal(false)} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
                <button
                  onClick={async () => {
                    try {
                      let suiteId = genForm.suiteId;
                      if (!genForm.useExistingSuite) {
                        const suiteRes = await axios.post(`${API_URL}/testdata/suites`, { name: genForm.suiteName || `Generated ${new Date().toISOString().slice(0,10)}`, description: 'Generated via Python API' }, { headers });
                        suiteId = suiteRes.data?.data?.id;
                        const suiteObj = suiteRes.data?.data;
                        setTestSuites(prev => {
                          const exists = prev.find(s => s.id === suiteObj.id);
                          return exists ? prev : [suiteObj, ...prev];
                        });
                      }
                      if (!suiteId) {
                        alert('Please select or create a suite');
                        return;
                      }
                      const payload: any = {
                        suiteId,
                        dataType: genForm.dataType,
                        count: genForm.count,
                        environment: genForm.environment,
                        sample_data: genForm.sample_data,
                      };
                      const res = await axios.post(`${API_URL}/testdata/generate-save`, payload, { headers });
                      const created = res.data?.data || [];
                      const items: TestDataItem[] = (created as any[]).map((created) => ({
                        id: created.id,
                        suiteId: created.suiteId,
                        name: created.name,
                        environment: created.environment,
                        type: created.type,
                        data: typeof created.data === 'string' ? JSON.parse(created.data) : created.data,
                      }));
                      setSelectedSuite(testSuites.find(s => s.id === suiteId) || selectedSuite);
                      setTestData(prev => [...items, ...prev]);
                      await loadData();
                      setShowGenModal(false);
                      alert('Generated test data added');
                    } catch (e: any) {
                      if (e?.response?.status === 422) {
                        try {
                          const genOnly = await axios.post(`${API_URL}/testdata/generate`, {
                            dataType: genForm.dataType,
                            count: genForm.count,
                            sample_data: genForm.sample_data,
                          }, { headers });
                          const payloadList = (genOnly.data?.data || genOnly.data?.records || genOnly.data?.users || genOnly.data?.result || []) as any[];
                          const items: TestDataItem[] = [];
                          for (const r of (Array.isArray(payloadList) ? payloadList.slice(0, genForm.count) : [])) {
                            const record = typeof r === 'object' ? r : {};
                            const name = record.username || record.email || record.name || 'Generated User';
                            const createdRes = await axios.post(`${API_URL}/testdata/data`, {
                              suiteId: selectedSuite?.id,
                              name,
                              environment: genForm.environment,
                              type: genForm.dataType,
                              data: record,
                            }, { headers });
                            const created = createdRes.data?.data;
                            items.push({
                              id: created.id,
                              suiteId: created.suiteId,
                              name: created.name,
                              environment: created.environment,
                              type: created.type,
                              data: typeof created.data === 'string' ? JSON.parse(created.data) : created.data,
                            });
                          }
                          setSelectedSuite(testSuites.find(s => s.id === selectedSuite?.id) || selectedSuite);
                          setTestData(prev => [...items, ...prev]);
                          await loadData();
                          setShowGenModal(false);
                          alert('Generated test data added');
                        } catch (inner: any) {
                          alert(inner?.response?.data?.error || 'Failed to generate test data');
                        }
                      } else {
                        alert(e?.response?.data?.error || 'Failed to generate test data');
                      }
                    }
                  }}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  Generate & Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  );
};

export default TestDataManager;
