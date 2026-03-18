import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './BDDFeatureManager.css';

const API_URL = 'http://localhost:3001/api';

interface Project {
  id: string;
  name: string;
  description?: string;
}

interface Props {
  selectedProjectId: string | null;
  currentProjectName: string;
  token: string | null;
}

interface BDDFeature {
  id: string;
  name: string;
  description: string | null;
  featureContent: string;
  tags: any;
  status: string;
  scenarioCount: number;
  runCount: number;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BDDRun {
  id: string;
  featureId: string;
  featureName: string;
  status: string;
  duration: number | null;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  errorMsg: string | null;
  browser: string;
  executionMode: string;
  reportUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ParsedScenario {
  name: string;
  type: string;
  tags: string[];
  steps: Array<{ keyword: string; text: string }>;
}

type ActiveTab = 'list' | 'editor' | 'runs';

const BDDFeatureManager: React.FC<Props> = ({ selectedProjectId: initialProjectId, currentProjectName: initialProjectName, token }) => {
  const headers = { Authorization: `Bearer ${token}` };

  // Project selection (local to BDD view)
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId);
  const [projectLoading, setProjectLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('list');
  const [features, setFeatures] = useState<BDDFeature[]>([]);
  const [runs, setRuns] = useState<BDDRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editor state
  const [editingFeature, setEditingFeature] = useState<BDDFeature | null>(null);
  const [isNewFeature, setIsNewFeature] = useState(false);
  const [editorName, setEditorName] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorTags, setEditorTags] = useState('');
  const [editorStatus, setEditorStatus] = useState('draft');

  // Parse preview
  const [parseResult, setParseResult] = useState<{ scenarios: ParsedScenario[]; generatedCode?: string } | null>(null);
  const [parsing, setParsing] = useState(false);

  // Run config
  const [runBrowser, setRunBrowser] = useState('chromium');
  const [runMode, setRunMode] = useState('headless');
  const [runningFeatureId, setRunningFeatureId] = useState<string | null>(null);

  // Run history filter
  const [runFilterFeatureId, setRunFilterFeatureId] = useState<string | null>(null);

  // --- API calls ---

  const loadProjects = useCallback(async () => {
    setProjectLoading(true);
    try {
      const res = await axios.get(`${API_URL}/projects`, { headers });
      const list: Project[] = res.data?.data || res.data?.projects || [];
      setProjects(list);
    } catch (err) {
      console.error('Error loading projects:', err);
    } finally {
      setProjectLoading(false);
    }
  }, []);

  const loadFeatures = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (selectedProjectId) params.projectId = selectedProjectId;
      const res = await axios.get(`${API_URL}/bdd/features`, { headers, params });
      setFeatures(res.data.data || []);
    } catch (err) {
      console.error('Error loading BDD features:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  const loadRuns = useCallback(async (featureId?: string | null) => {
    try {
      const params: any = {};
      if (featureId) {
        params.featureId = featureId;
      } else if (selectedProjectId) {
        params.projectId = selectedProjectId;
      }
      const res = await axios.get(`${API_URL}/bdd/runs`, { headers, params });
      setRuns(res.data.data || []);
    } catch (err) {
      console.error('Error loading BDD runs:', err);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    loadFeatures();
  }, [loadFeatures]);

  // Derive current project name
  const currentProjectName = selectedProjectId
    ? projects.find(p => p.id === selectedProjectId)?.name || 'Unknown Project'
    : 'All Projects';

  // --- Editor helpers ---

  const resetEditor = () => {
    setEditingFeature(null);
    setIsNewFeature(true);
    setEditorName('');
    setEditorDescription('');
    setEditorContent(`Feature: My Feature\n  As a user\n  I want to perform an action\n  So that I get the expected result\n\n  Scenario: Example scenario\n    Given I am on the homepage\n    When I click the login button\n    Then I should see the login form\n`);
    setEditorTags('');
    setEditorStatus('draft');
    setParseResult(null);
  };

  const openEditorForFeature = (feature: BDDFeature) => {
    setEditingFeature(feature);
    setIsNewFeature(false);
    setEditorName(feature.name);
    setEditorDescription(feature.description || '');
    setEditorContent(feature.featureContent);
    const tags = Array.isArray(feature.tags) ? feature.tags : [];
    setEditorTags(tags.join(', '));
    setEditorStatus(feature.status);
    setParseResult(null);
    setActiveTab('editor');
  };

  const handleSave = async () => {
    if (!editorName.trim() || !editorContent.trim()) {
      alert('Name and feature content are required.');
      return;
    }
    if (isNewFeature && !selectedProjectId) {
      alert('Please select a project first before creating a feature.');
      return;
    }
    setSaving(true);
    try {
      const tags = editorTags.split(',').map(t => t.trim()).filter(Boolean);
      if (isNewFeature) {
        await axios.post(`${API_URL}/bdd/features`, {
          name: editorName,
          description: editorDescription || null,
          featureContent: editorContent,
          tags,
          projectId: selectedProjectId,
        }, { headers });
      } else if (editingFeature) {
        await axios.put(`${API_URL}/bdd/features/${editingFeature.id}`, {
          name: editorName,
          description: editorDescription || null,
          featureContent: editorContent,
          tags,
          status: editorStatus,
        }, { headers });
      }
      await loadFeatures();
      setActiveTab('list');
    } catch (err: any) {
      alert(`Failed to save feature: ${err.response?.data?.error || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (featureId: string) => {
    if (!confirm('Delete this feature and all associated runs?')) return;
    try {
      await axios.delete(`${API_URL}/bdd/features/${featureId}`, { headers });
      await loadFeatures();
    } catch (err: any) {
      alert(`Failed to delete: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleParsePreview = async () => {
    if (!editorContent.trim()) return;
    setParsing(true);
    try {
      const res = await axios.post(`${API_URL}/bdd/parse`, { featureContent: editorContent }, { headers });
      setParseResult(res.data.data || null);
    } catch (err) {
      console.error('Parse error:', err);
    } finally {
      setParsing(false);
    }
  };

  const handleRunFeature = async (featureId: string) => {
    setRunningFeatureId(featureId);
    try {
      const res = await axios.post(`${API_URL}/bdd/features/${featureId}/run`, {
        browser: runBrowser,
        executionMode: runMode,
      }, { headers });
      alert(`Run started! Run ID: ${res.data.data?.id || 'unknown'}`);
      if (activeTab === 'runs') {
        await loadRuns(runFilterFeatureId);
      }
    } catch (err: any) {
      alert(`Failed to start run: ${err.response?.data?.error || err.message}`);
    } finally {
      setRunningFeatureId(null);
    }
  };

  const viewRunsForFeature = (feature: BDDFeature) => {
    setRunFilterFeatureId(feature.id);
    setActiveTab('runs');
    loadRuns(feature.id);
  };

  const viewAllRuns = () => {
    setRunFilterFeatureId(null);
    loadRuns(null);
  };

  // --- Status helpers ---

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'passed': return 'bdd-badge bdd-badge-passed';
      case 'failed': return 'bdd-badge bdd-badge-failed';
      case 'running': return 'bdd-badge bdd-badge-running';
      case 'pending': return 'bdd-badge bdd-badge-pending';
      case 'cancelled': return 'bdd-badge bdd-badge-cancelled';
      case 'active': return 'bdd-badge bdd-badge-active';
      case 'draft': return 'bdd-badge bdd-badge-draft';
      case 'archived': return 'bdd-badge bdd-badge-archived';
      default: return 'bdd-badge';
    }
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  // --- Render ---

  return (
    <div className="bdd-manager">
      <div className="bdd-header">
        <h1>BDD Feature Management</h1>
      </div>

      {/* Project Selector */}
      <div className="bdd-project-selector">
        <div className="bdd-project-selector-row">
          <label className="bdd-project-selector-label">Project:</label>
          <select
            className="bdd-input bdd-project-dropdown"
            value={selectedProjectId || ''}
            onChange={e => setSelectedProjectId(e.target.value || null)}
            disabled={projectLoading}
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="bdd-btn bdd-btn-secondary" onClick={loadProjects} disabled={projectLoading}>
            {projectLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        {selectedProjectId && (
          <p className="bdd-project-label">
            Managing features for: <strong>{currentProjectName}</strong>
          </p>
        )}
      </div>

      {/* Tab Bar */}
      <div className="bdd-tabs">
        <button
          className={`bdd-tab ${activeTab === 'list' ? 'bdd-tab-active' : ''}`}
          onClick={() => setActiveTab('list')}
        >
          Feature List
        </button>
        <button
          className={`bdd-tab ${activeTab === 'editor' ? 'bdd-tab-active' : ''}`}
          onClick={() => { resetEditor(); setActiveTab('editor'); }}
        >
          + New Feature
        </button>
        <button
          className={`bdd-tab ${activeTab === 'runs' ? 'bdd-tab-active' : ''}`}
          onClick={() => { setActiveTab('runs'); viewAllRuns(); }}
        >
          Run History
        </button>

        {/* Run config */}
        <div className="bdd-run-config">
          <select value={runBrowser} onChange={e => setRunBrowser(e.target.value)} className="bdd-select-sm">
            <option value="chromium">Chrome</option>
            <option value="firefox">Firefox</option>
            <option value="webkit">WebKit</option>
          </select>
          <select value={runMode} onChange={e => setRunMode(e.target.value)} className="bdd-select-sm">
            <option value="headless">Headless</option>
            <option value="headed">Headed</option>
          </select>
        </div>
      </div>

      {/* === Feature List Tab === */}
      {activeTab === 'list' && (
        <div className="bdd-feature-list">
          {loading ? (
            <div className="bdd-empty">Loading features...</div>
          ) : features.length === 0 ? (
            <div className="bdd-empty">
              <p>No BDD features found{selectedProjectId ? ' for this project' : ''}.</p>
              <button className="bdd-btn bdd-btn-primary" onClick={() => { resetEditor(); setActiveTab('editor'); }}>
                Create First Feature
              </button>
            </div>
          ) : (
            <div className="bdd-cards">
              {features.map(feature => (
                <div key={feature.id} className="bdd-card">
                  <div className="bdd-card-header">
                    <h3 className="bdd-card-title">{feature.name}</h3>
                    <span className={getStatusBadgeClass(feature.status)}>{feature.status}</span>
                  </div>
                  {feature.description && (
                    <p className="bdd-card-desc">{feature.description}</p>
                  )}
                  <div className="bdd-card-meta">
                    <span>Scenarios: {feature.scenarioCount || 0}</span>
                    <span>Runs: {feature.runCount || 0}</span>
                    <span>{formatDate(feature.createdAt)}</span>
                  </div>
                  {feature.tags && Array.isArray(feature.tags) && feature.tags.length > 0 && (
                    <div className="bdd-tags">
                      {feature.tags.map((tag: string, i: number) => (
                        <span key={i} className="bdd-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="bdd-card-actions">
                    <button className="bdd-btn bdd-btn-primary" onClick={() => openEditorForFeature(feature)}>
                      Edit
                    </button>
                    <button
                      className="bdd-btn bdd-btn-success"
                      onClick={() => handleRunFeature(feature.id)}
                      disabled={runningFeatureId === feature.id}
                    >
                      {runningFeatureId === feature.id ? 'Starting...' : 'Run'}
                    </button>
                    <button className="bdd-btn bdd-btn-secondary" onClick={() => viewRunsForFeature(feature)}>
                      Runs
                    </button>
                    <button className="bdd-btn bdd-btn-danger" onClick={() => handleDelete(feature.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* === Feature Editor Tab === */}
      {activeTab === 'editor' && (
        <div className="bdd-editor">
          {isNewFeature && !selectedProjectId && (
            <div className="bdd-warning">
              Please select a project from the sidebar before creating a feature.
            </div>
          )}
          <div className="bdd-form-row">
            <div className="bdd-form-group" style={{ flex: 2 }}>
              <label>Feature Name *</label>
              <input
                type="text"
                className="bdd-input"
                value={editorName}
                onChange={e => setEditorName(e.target.value)}
                placeholder="e.g., User Login"
              />
            </div>
            <div className="bdd-form-group" style={{ flex: 1 }}>
              <label>Status</label>
              <select className="bdd-input" value={editorStatus} onChange={e => setEditorStatus(e.target.value)}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          <div className="bdd-form-group">
            <label>Description</label>
            <input
              type="text"
              className="bdd-input"
              value={editorDescription}
              onChange={e => setEditorDescription(e.target.value)}
              placeholder="Brief description of this feature"
            />
          </div>

          <div className="bdd-form-group">
            <label>Tags (comma-separated)</label>
            <input
              type="text"
              className="bdd-input"
              value={editorTags}
              onChange={e => setEditorTags(e.target.value)}
              placeholder="@smoke, @regression, @login"
            />
          </div>

          <div className="bdd-form-group">
            <label>Feature Content (Gherkin) *</label>
            <textarea
              className="bdd-gherkin-editor"
              value={editorContent}
              onChange={e => setEditorContent(e.target.value)}
              rows={18}
              spellCheck={false}
            />
          </div>

          <div className="bdd-editor-actions">
            <button className="bdd-btn bdd-btn-secondary" onClick={handleParsePreview} disabled={parsing}>
              {parsing ? 'Parsing...' : 'Preview / Parse'}
            </button>
            <button className="bdd-btn bdd-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : (isNewFeature ? 'Create Feature' : 'Update Feature')}
            </button>
            <button className="bdd-btn" onClick={() => setActiveTab('list')}>
              Cancel
            </button>
          </div>

          {/* Parse Preview */}
          {parseResult && parseResult.scenarios && (
            <div className="bdd-parse-preview">
              <h3>Parsed Scenarios ({parseResult.scenarios.length})</h3>
              {parseResult.scenarios.map((scenario, idx) => (
                <div key={idx} className="bdd-scenario-card">
                  <div className="bdd-scenario-header">
                    <strong>{scenario.type}:</strong> {scenario.name}
                    {scenario.tags && scenario.tags.length > 0 && (
                      <span className="bdd-tags-inline">
                        {scenario.tags.map((t, i) => <span key={i} className="bdd-tag">{t}</span>)}
                      </span>
                    )}
                  </div>
                  <div className="bdd-scenario-steps">
                    {scenario.steps.map((step, sIdx) => (
                      <div key={sIdx} className="bdd-step">
                        <span className="bdd-step-keyword">{step.keyword}</span>
                        <span>{step.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* === Run History Tab === */}
      {activeTab === 'runs' && (
        <div className="bdd-runs">
          <div className="bdd-runs-header">
            <h2>
              {runFilterFeatureId
                ? `Runs for: ${features.find(f => f.id === runFilterFeatureId)?.name || 'Feature'}`
                : 'All Runs'}
            </h2>
            {runFilterFeatureId && (
              <button className="bdd-btn bdd-btn-secondary" onClick={viewAllRuns}>
                Show All Runs
              </button>
            )}
            <button className="bdd-btn bdd-btn-secondary" onClick={() => loadRuns(runFilterFeatureId)}>
              Refresh
            </button>
          </div>

          {runs.length === 0 ? (
            <div className="bdd-empty">No runs found.</div>
          ) : (
            <table className="bdd-runs-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Status</th>
                  <th>Steps</th>
                  <th>Duration</th>
                  <th>Browser</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id}>
                    <td>{run.featureName}</td>
                    <td><span className={getStatusBadgeClass(run.status)}>{run.status}</span></td>
                    <td>
                      <span className="bdd-steps-summary">
                        <span className="bdd-step-passed">{run.passedSteps}</span>/
                        <span className="bdd-step-failed">{run.failedSteps}</span>/
                        <span className="bdd-step-skipped">{run.skippedSteps}</span>
                        <span className="bdd-step-total"> ({run.totalSteps})</span>
                      </span>
                    </td>
                    <td>{formatDuration(run.duration)}</td>
                    <td>{run.browser}</td>
                    <td>{formatDate(run.createdAt)}</td>
                    <td>
                      {run.reportUrl && (
                        <a href={run.reportUrl} target="_blank" rel="noopener noreferrer" className="bdd-btn bdd-btn-sm">
                          Report
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default BDDFeatureManager;
