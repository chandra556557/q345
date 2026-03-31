import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import './EpicPipeline.css';

const API_URL = 'http://localhost:3001/api';

// ── Types ─────────────────────────────────────────────────────────────

interface JiraConfigState {
  baseUrl: string;
  email: string;
  apiToken: string;
  apiVersion: 'v2' | 'v3';
}

interface JiraProject {
  id: string;
  key: string;
  name: string;
}

interface JiraEpic {
  key: string;
  summary: string;
  description: string;
  status: string;
  stories: JiraStory[];
}

interface JiraStory {
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  acceptanceCriteria: string[];
}

interface TestCaseResult {
  storyKey: string;
  storySummary: string;
  totalCases: number;
  categories: Record<string, TestCase[]>;
  gherkinFeature: string;
  generationMethod: string;
}

interface TestCase {
  id: string;
  category: string;
  title: string;
  description: string;
  preconditions: string[];
  steps: { stepNumber: number; action: string; testData?: string }[];
  expectedResult: string;
  priority: string;
  tags: string[];
}

interface PipelineRun {
  id: string;
  status: string;
  totalStories: number;
  totalTestCases: number;
  categoryCounts: Record<string, number>;
  progress: number;
  currentStep: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

type TabName = 'configure' | 'generate' | 'results' | 'history';
type TestCategory = 'positive' | 'negative' | 'edge' | 'boundary' | 'security';

const CATEGORIES: TestCategory[] = ['positive', 'negative', 'edge', 'boundary', 'security'];

const PIPELINE_STEPS = [
  { num: 1, label: 'Pick Epic' },
  { num: 2, label: 'Analyze Stories' },
  { num: 3, label: 'Generate Cases' },
  { num: 4, label: 'Gherkin' },
  { num: 5, label: 'Playwright' },
];

// ── Component ─────────────────────────────────────────────────────────

const EpicPipeline: React.FC = () => {
  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  // State
  const [activeTab, setActiveTab] = useState<TabName>('configure');
  const [pipelineStep, setPipelineStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Jira Config
  const [jiraConfig, setJiraConfig] = useState<JiraConfigState>({
    baseUrl: '', email: '', apiToken: '', apiVersion: 'v3',
  });
  const [jiraConnected, setJiraConnected] = useState(false);
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [epics, setEpics] = useState<JiraEpic[]>([]);
  const [selectedEpic, setSelectedEpic] = useState<JiraEpic | null>(null);

  // Generation config
  const [selectedCategories, setSelectedCategories] = useState<TestCategory[]>([...CATEGORIES]);
  const [maxCasesPerCategory, setMaxCasesPerCategory] = useState(5);
  const [securityDepth, setSecurityDepth] = useState<'basic' | 'thorough'>('basic');
  const [aiProvider, setAiProvider] = useState<'none' | 'openai' | 'anthropic'>('none');
  const [aiApiKey, setAiApiKey] = useState('');
  const [applicationContext, setApplicationContext] = useState('web application');

  // Manual input (alternative to Jira)
  const [manualMode, setManualMode] = useState(false);
  const [manualSummary, setManualSummary] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualAC, setManualAC] = useState('');

  // Results
  const [testCaseResults, setTestCaseResults] = useState<TestCaseResult[]>([]);
  const [activeResultCategory, setActiveResultCategory] = useState<TestCategory>('positive');
  const [selectedResultStory, setSelectedResultStory] = useState(0);

  // Pipeline run
  const [activePipelineRun, setActivePipelineRun] = useState<PipelineRun | null>(null);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Load saved config on mount ────────────────────────────────────
  useEffect(() => {
    loadJiraConfig();
    loadPipelineRuns();
  }, []);

  const loadJiraConfig = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/epic-pipeline/jira/config`, { headers });
      if (data.configured) {
        setJiraConfig(prev => ({ ...prev, baseUrl: data.baseUrl, email: data.email, apiVersion: data.apiVersion }));
        setJiraConnected(true);
      }
    } catch { /* not configured yet */ }
  };

  const loadPipelineRuns = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/epic-pipeline/runs`, { headers });
      setPipelineRuns(data.data || []);
    } catch { /* ignore */ }
  };

  // ── Jira Actions ──────────────────────────────────────────────────
  const testConnection = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/epic-pipeline/jira/test-connection`, jiraConfig, { headers });
      if (data.connected) {
        setSuccess('Connected to Jira successfully!');
        setJiraConnected(true);
        await axios.post(`${API_URL}/epic-pipeline/jira/save-config`, jiraConfig, { headers });
        fetchProjects();
      } else {
        setError(`Connection failed: ${data.error}`);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Connection failed');
    }
    setLoading(false);
  };

  const fetchProjects = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/epic-pipeline/jira/projects`, { headers });
      setJiraProjects(data.data || []);
    } catch (err: any) {
      setError('Failed to load projects');
    }
  };

  const fetchEpics = async (projectKey: string) => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/epic-pipeline/jira/epics/${projectKey}`, { headers });
      setEpics(data.data || []);
    } catch (err: any) {
      setError('Failed to load epics');
    }
    setLoading(false);
  };

  const selectEpic = async (epicKey: string) => {
    setLoading(true); setError('');
    try {
      const { data } = await axios.get(`${API_URL}/epic-pipeline/jira/epic/${epicKey}`, { headers });
      setSelectedEpic(data.data);
      setPipelineStep(1);
    } catch (err: any) {
      setError('Failed to load epic details');
    }
    setLoading(false);
  };

  // ── Generation Actions ────────────────────────────────────────────
  const generateTestCases = async () => {
    setLoading(true); setError(''); setPipelineStep(3);
    try {
      if (manualMode) {
        // Manual generation
        const acList = manualAC.split('\n').filter(a => a.trim());
        const { data } = await axios.post(`${API_URL}/epic-pipeline/generate`, {
          summary: manualSummary,
          description: manualDescription,
          acceptanceCriteria: acList,
          options: {
            categories: selectedCategories,
            maxCasesPerCategory,
            securityDepth,
            aiProvider,
            aiApiKey: aiProvider !== 'none' ? aiApiKey : undefined,
            applicationContext,
          },
        }, { headers });
        setTestCaseResults([data.data]);
      } else {
        // Jira pipeline — start full workflow
        const { data } = await axios.post(`${API_URL}/epic-pipeline/run`, {
          epicKey: selectedEpic?.key,
          categories: selectedCategories,
          maxCasesPerCategory,
          securityDepth,
          aiProvider,
          aiApiKey: aiProvider !== 'none' ? aiApiKey : undefined,
          applicationContext,
          autoCreateFeatures: true,
          autoExecute: false,
        }, { headers });

        const runId = data.data.id;
        setActivePipelineRun({ id: runId, status: 'pending', totalStories: 0, totalTestCases: 0, categoryCounts: {}, progress: 0, currentStep: 'Starting...' });
        subscribeToPipelineRun(runId);
        setActiveTab('results');
      }
      setPipelineStep(4);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Generation failed');
    }
    setLoading(false);
  };

  const subscribeToPipelineRun = (runId: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    const es = new EventSource(`${API_URL}/epic-pipeline/runs/${runId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setActivePipelineRun(prev => ({ ...prev, ...data }));
      if (data.status === 'completed' || data.status === 'failed') {
        es.close();
        loadPipelineRuns();
        if (data.status === 'completed') setPipelineStep(5);
      }
    };

    es.onerror = () => { es.close(); };
  };

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  // ── Category Toggle ───────────────────────────────────────────────
  const toggleCategory = (cat: TestCategory) => {
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  // ── Render Helpers ────────────────────────────────────────────────

  const renderPipelineSteps = () => (
    <div className="pipeline-steps">
      {PIPELINE_STEPS.map((step, idx) => (
        <React.Fragment key={step.num}>
          {idx > 0 && <div className={`step-connector ${pipelineStep > idx ? 'completed' : ''}`} />}
          <div className={`pipeline-step ${pipelineStep === idx + 1 ? 'active' : ''} ${pipelineStep > idx + 1 ? 'completed' : ''}`}>
            <div className="step-circle">
              {pipelineStep > idx + 1 ? '\u2713' : step.num}
            </div>
            <span className="step-label">{step.label}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  const renderConfigTab = () => (
    <div>
      {/* Mode Toggle */}
      <div className="btn-row" style={{ marginBottom: 20 }}>
        <button className={`btn ${!manualMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setManualMode(false)}>
          Jira Integration
        </button>
        <button className={`btn ${manualMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setManualMode(true)}>
          Manual Input
        </button>
      </div>

      {manualMode ? renderManualInput() : renderJiraConfig()}

      {/* Generation Options */}
      <div className="config-panel">
        <h3>Test Case Generation Options</h3>
        <div className="category-badges" style={{ marginBottom: 16 }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`category-badge ${cat} ${selectedCategories.includes(cat) ? '' : 'btn-secondary'}`}
              style={{ cursor: 'pointer', border: selectedCategories.includes(cat) ? '2px solid' : '2px solid transparent', opacity: selectedCategories.includes(cat) ? 1 : 0.4 }}
              onClick={() => toggleCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="config-grid">
          <div className="form-group">
            <label>Max Cases Per Category</label>
            <input type="number" min={1} max={20} value={maxCasesPerCategory} onChange={e => setMaxCasesPerCategory(+e.target.value)} />
          </div>
          <div className="form-group">
            <label>Security Depth</label>
            <select value={securityDepth} onChange={e => setSecurityDepth(e.target.value as 'basic' | 'thorough')}>
              <option value="basic">Basic</option>
              <option value="thorough">Thorough (OWASP Top 10)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Application Context</label>
            <input value={applicationContext} onChange={e => setApplicationContext(e.target.value)} placeholder="e.g., web application, REST API" />
          </div>
          <div className="form-group">
            <label>AI Provider (optional)</label>
            <select value={aiProvider} onChange={e => setAiProvider(e.target.value as 'none' | 'openai' | 'anthropic')}>
              <option value="none">Rule-based (no AI)</option>
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </div>
          {aiProvider !== 'none' && (
            <div className="form-group">
              <label>AI API Key</label>
              <input type="password" value={aiApiKey} onChange={e => setAiApiKey(e.target.value)} placeholder="sk-..." />
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="btn-row">
        <button
          className="btn btn-success"
          disabled={loading || (!manualMode && !selectedEpic) || (manualMode && !manualSummary)}
          onClick={generateTestCases}
        >
          {loading ? 'Generating...' : 'Generate Test Cases'}
        </button>
      </div>
    </div>
  );

  const renderJiraConfig = () => (
    <div className="config-panel">
      <h3>Jira Configuration</h3>
      {!jiraConnected ? (
        <>
          <div className="config-grid">
            <div className="form-group">
              <label>Jira Base URL</label>
              <input value={jiraConfig.baseUrl} onChange={e => setJiraConfig(p => ({ ...p, baseUrl: e.target.value }))} placeholder="https://yourcompany.atlassian.net" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input value={jiraConfig.email} onChange={e => setJiraConfig(p => ({ ...p, email: e.target.value }))} placeholder="user@company.com" />
            </div>
            <div className="form-group">
              <label>API Token</label>
              <input type="password" value={jiraConfig.apiToken} onChange={e => setJiraConfig(p => ({ ...p, apiToken: e.target.value }))} placeholder="API token" />
            </div>
            <div className="form-group">
              <label>API Version</label>
              <select value={jiraConfig.apiVersion} onChange={e => setJiraConfig(p => ({ ...p, apiVersion: e.target.value as 'v2' | 'v3' }))}>
                <option value="v3">v3 (Cloud)</option>
                <option value="v2">v2 (Server)</option>
              </select>
            </div>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={testConnection} disabled={loading || !jiraConfig.baseUrl}>
              {loading ? 'Testing...' : 'Test & Save Connection'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ color: '#06d6a0', fontWeight: 600 }}>Connected to {jiraConfig.baseUrl}</p>

          {/* Project Selection */}
          <div className="config-grid" style={{ marginTop: 16 }}>
            <div className="form-group">
              <label>Select Project</label>
              <select value={selectedProject} onChange={e => { setSelectedProject(e.target.value); fetchEpics(e.target.value); }}>
                <option value="">-- Select Project --</option>
                {jiraProjects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
              </select>
            </div>
          </div>

          {/* Epic Selection */}
          {epics.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4>Epics</h4>
              {epics.map(epic => (
                <div key={epic.key} className="story-card" onClick={() => selectEpic(epic.key)} style={{ cursor: 'pointer' }}>
                  <div className="story-header">
                    <span className="story-key">{epic.key}</span>
                    <span className="story-status">{epic.status}</span>
                  </div>
                  <div className="story-summary">{epic.summary}</div>
                </div>
              ))}
            </div>
          )}

          {/* Selected Epic Stories */}
          {selectedEpic && (
            <div style={{ marginTop: 16 }}>
              <h4>Epic: {selectedEpic.key} - {selectedEpic.summary}</h4>
              <p style={{ color: '#666', fontSize: 14 }}>{selectedEpic.stories.length} stories found</p>
              {selectedEpic.stories.map(story => (
                <div key={story.key} className="story-card">
                  <div className="story-header">
                    <span className="story-key">{story.key}</span>
                    <span className="story-status">{story.status}</span>
                  </div>
                  <div className="story-summary">{story.summary}</div>
                  {story.acceptanceCriteria.length > 0 && (
                    <ul className="ac-list">
                      {story.acceptanceCriteria.slice(0, 3).map((ac, i) => <li key={i}>{ac}</li>)}
                      {story.acceptanceCriteria.length > 3 && <li>...and {story.acceptanceCriteria.length - 3} more</li>}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => { setJiraConnected(false); setSelectedEpic(null); }}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );

  const renderManualInput = () => (
    <div className="config-panel">
      <h3>Manual Story Input</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="form-group">
          <label>Story Summary *</label>
          <input value={manualSummary} onChange={e => setManualSummary(e.target.value)} placeholder="e.g., User can login with email and password" />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea value={manualDescription} onChange={e => setManualDescription(e.target.value)} placeholder="Detailed description of the feature..." />
        </div>
        <div className="form-group">
          <label>Acceptance Criteria (one per line)</label>
          <textarea
            value={manualAC}
            onChange={e => setManualAC(e.target.value)}
            placeholder={"Given user is on login page\nWhen user enters valid credentials\nThen user is redirected to dashboard\n\nGiven user enters wrong password\nThen error message is shown"}
            style={{ minHeight: 120 }}
          />
        </div>
      </div>
    </div>
  );

  const renderResultsTab = () => {
    if (activePipelineRun && activePipelineRun.status !== 'completed') {
      return renderPipelineProgress();
    }

    if (testCaseResults.length === 0) {
      return <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>No results yet. Configure and generate test cases first.</p>;
    }

    const result = testCaseResults[selectedResultStory];
    if (!result) return null;

    const currentCases = result.categories[activeResultCategory] || [];

    return (
      <div>
        {/* Story selector */}
        {testCaseResults.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <select value={selectedResultStory} onChange={e => setSelectedResultStory(+e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd' }}>
              {testCaseResults.map((r, i) => <option key={i} value={i}>[{r.storyKey}] {r.storySummary}</option>)}
            </select>
          </div>
        )}

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-card"><div className="stat-value">{result.totalCases}</div><div className="stat-label">Total Cases</div></div>
          {CATEGORIES.map(cat => (
            <div className="stat-card" key={cat}>
              <div className="stat-value">{(result.categories[cat] || []).length}</div>
              <div className="stat-label" style={{ textTransform: 'capitalize' }}>{cat}</div>
            </div>
          ))}
        </div>

        {/* Category tabs */}
        <div className="category-badges">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`category-badge ${cat}`}
              style={{ cursor: 'pointer', border: activeResultCategory === cat ? '2px solid' : '2px solid transparent', fontWeight: activeResultCategory === cat ? 700 : 500 }}
              onClick={() => setActiveResultCategory(cat)}
            >
              {cat} ({(result.categories[cat] || []).length})
            </button>
          ))}
        </div>

        {/* Test cases table */}
        <table className="testcase-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Title</th>
              <th style={{ width: 80 }}>Priority</th>
              <th style={{ width: 60 }}>Steps</th>
              <th>Expected Result</th>
            </tr>
          </thead>
          <tbody>
            {currentCases.map((tc, idx) => (
              <tr key={tc.id}>
                <td>{idx + 1}</td>
                <td>
                  <strong>{tc.title}</strong>
                  <br /><span style={{ fontSize: 12, color: '#888' }}>{tc.description}</span>
                </td>
                <td><span className={`priority-badge ${tc.priority}`}>{tc.priority}</span></td>
                <td>{tc.steps.length}</td>
                <td style={{ fontSize: 13 }}>{tc.expectedResult}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Gherkin Preview */}
        <h3 style={{ marginTop: 24 }}>Gherkin Feature</h3>
        <div className="gherkin-preview">
          {highlightGherkin(result.gherkinFeature)}
        </div>
      </div>
    );
  };

  const renderPipelineProgress = () => {
    if (!activePipelineRun) return null;
    const run = activePipelineRun;

    return (
      <div>
        <div className="progress-container">
          <div className="progress-bar-wrapper">
            <div className="progress-bar-fill" style={{ width: `${run.progress}%` }} />
          </div>
          <div className="progress-label">
            <span>{run.currentStep}</span>
            <span>{run.progress}%</span>
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-card"><div className="stat-value">{run.totalStories}</div><div className="stat-label">Stories</div></div>
          <div className="stat-card"><div className="stat-value">{run.totalTestCases}</div><div className="stat-label">Test Cases</div></div>
          <div className="stat-card">
            <div className="stat-value" style={{ fontSize: 16 }}>
              <span className={`run-status ${run.status}`}>{run.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="stat-label">Status</div>
          </div>
        </div>

        {run.error && <p style={{ color: '#ef476f', marginTop: 16 }}>{run.error}</p>}
      </div>
    );
  };

  const renderHistoryTab = () => (
    <div>
      <h3>Pipeline Run History</h3>
      {pipelineRuns.length === 0 ? (
        <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>No pipeline runs yet.</p>
      ) : (
        pipelineRuns.map(run => (
          <div key={run.id} className="run-card">
            <div className="run-info">
              <strong>{run.id.substring(0, 8)}...</strong>
              <span style={{ marginLeft: 12, color: '#888', fontSize: 13 }}>
                {run.totalStories} stories, {run.totalTestCases} test cases
              </span>
              {run.startedAt && <span style={{ marginLeft: 12, color: '#aaa', fontSize: 12 }}>{new Date(run.startedAt).toLocaleString()}</span>}
            </div>
            <span className={`run-status ${run.status}`}>{run.status}</span>
          </div>
        ))
      )}
    </div>
  );

  // ── Gherkin syntax highlighting ───────────────────────────────────
  const highlightGherkin = (text: string): React.ReactNode => {
    return text.split('\n').map((line, i) => {
      let className = '';
      if (/^\s*@/.test(line)) className = 'tag';
      else if (/^\s*#/.test(line)) className = 'comment';
      else if (/^\s*(Feature|Scenario|Background|Given|When|Then|And|But|Examples|Scenario Outline)/i.test(line)) className = 'keyword';

      return <div key={i} className={className}>{line || '\u00A0'}</div>;
    });
  };

  // ── Main Render ───────────────────────────────────────────────────
  return (
    <div className="epic-pipeline">
      <h2>Epic-to-Playwright Pipeline</h2>
      <p className="subtitle">Pick Jira Epic &rarr; Generate Test Cases (Positive, Negative, Edge, Boundary, Security) &rarr; Gherkin &rarr; Playwright</p>

      {renderPipelineSteps()}

      {error && <div style={{ background: '#f8d7da', color: '#721c24', padding: '10px 16px', borderRadius: 8, marginBottom: 16 }}>{error} <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}>x</button></div>}
      {success && <div style={{ background: '#d4edda', color: '#155724', padding: '10px 16px', borderRadius: 8, marginBottom: 16 }}>{success} <button onClick={() => setSuccess('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}>x</button></div>}

      <div className="pipeline-tabs">
        {(['configure', 'generate', 'results', 'history'] as TabName[]).map(tab => (
          <button
            key={tab}
            className={`pipeline-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'configure' ? 'Configure' : tab === 'generate' ? 'Generate' : tab === 'results' ? 'Results' : 'History'}
            {tab === 'results' && testCaseResults.length > 0 && (
              <span className="tab-badge">{testCaseResults.reduce((s, r) => s + r.totalCases, 0)}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'configure' && renderConfigTab()}
      {activeTab === 'generate' && renderConfigTab()}
      {activeTab === 'results' && renderResultsTab()}
      {activeTab === 'history' && renderHistoryTab()}
    </div>
  );
};

export default EpicPipeline;
