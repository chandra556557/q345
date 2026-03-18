import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ApiTesting from './ApiTesting.tsx';
import OrganizationManagement from './OrganizationManagement.tsx';
import ScriptExecutionModal from './ScriptExecutionModal.tsx';
import ScriptEnhancementModal from './ScriptEnhancementModal';
import ImportScriptModal from './ImportScriptModal';
import ScriptValidationModal from './ScriptValidationModal';
import ScriptCueCards from './ScriptCueCards';
import BDDFeatureManager from './BDDFeatureManager';
import './Dashboard.css';

const API_URL = 'http://localhost:3001/api';

interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
}

interface Script {
  id: string;
  name: string;
  language: string;
  description?: string;
  createdAt: string;
  user: { name: string; email: string };
}

interface TestRun {
  id: string;
  status: string;
  duration?: number;
  startedAt: string;
  allureReportUrl?: string;
  script: { name: string };
}

interface Stats {
  totalScripts: number;
  totalRuns: number;
  successRate: number;
}

type ActiveView = 
  | 'overview' 
  | 'scripts' 
  | 'runs' 
  | 'testdata' 
  | 'apitesting' 
  | 'allure'
  | 'analytics'
  | 'organizations'
  | 'settings'
  | 'bdd';

export const Dashboard: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveView>('overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [projectLoading, setProjectLoading] = useState(false);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [stats, setStats] = useState<Stats>({ totalScripts: 0, totalRuns: 0, successRate: 0 });
  const [loading, setLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLanguage, setImportLanguage] = useState('javascript');
  const [importing, setImporting] = useState(false);
  const [showEnhancementModal, setShowEnhancementModal] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [selectedScriptForAction, setSelectedScriptForAction] = useState<{ id: string; name: string } | null>(null);
  const [showImportScriptModal, setShowImportScriptModal] = useState(false);
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const [currentScriptForExecution, setCurrentScriptForExecution] = useState<{ id: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'user'>('user');

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    // Load user role from localStorage
    const storedRole = (localStorage.getItem('userRole') as 'admin' | 'editor' | 'user') || 'user';
    setUserRole(storedRole);
    loadProjects();
  }, []);

  useEffect(() => {
    // Reload data when project changes
    loadData();
  }, [selectedProjectId]);



  const loadProjects = async () => {
    setProjectLoading(true);
    try {
      const res = await axios.get(`${API_URL}/projects`, { headers });
      const list: Project[] = res.data?.data || res.data?.projects || [];
      setProjects(list);
      if (!selectedProjectId && list.length > 0) {
        setSelectedProjectId(list[0].id);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setProjectLoading(false);
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) {
      alert('Project name is required');
      return;
    }
    setProjectLoading(true);
    try {
      const res = await axios.post(
        `${API_URL}/projects`,
        { name: newProjectName.trim(), description: newProjectDescription.trim() || undefined },
        { headers }
      );
      const created: Project = res.data?.data || res.data?.project;
      await loadProjects();
      if (created?.id) setSelectedProjectId(created.id);
      setNewProjectName('');
      setNewProjectDescription('');
    } catch (error: any) {
      console.error('Error creating project:', error);
      alert('Failed to create project: ' + (error.response?.data?.error || error.message));
    } finally {
      setProjectLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [scriptsRes, runsRes] = await Promise.all([
        axios
          .get(`${API_URL}/scripts`, { headers, params: { projectId: selectedProjectId || undefined } })
          .catch(() => ({ data: { scripts: [], data: [] } })),
        axios
          .get(`${API_URL}/test-runs`, { headers, params: { projectId: selectedProjectId || undefined } })
          .catch(() => ({ data: { testRuns: [], data: [] } }))
      ]);

      const scriptData = (scriptsRes as any).data?.scripts || (scriptsRes as any).data?.data || [];
      const runData = (runsRes as any).data?.data || (runsRes as any).data?.testRuns || [];

      setScripts(scriptData);
      setTestRuns(runData);

      const successCount = runData.filter((r: TestRun) => r.status === 'passed').length;
      setStats({
        totalScripts: scriptData.length,
        totalRuns: runData.length,
        successRate: runData.length > 0 ? Math.round((successCount / runData.length) * 100) : 0
      });
    } catch (error: any) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateAllureReport = async (testRunId: string) => {
    setGeneratingReport(testRunId);
    try {
      const response = await axios.post(`${API_URL}/allure/generate/${testRunId}`, {}, { headers });
      await loadData();
      setSelectedReport(response.data.reportUrl);
      setActiveView('allure');
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setGeneratingReport(null);
    }
  };



  const handleGenerateReport = async (scriptId: string, projectId?: string) => {
    try {
      console.log('Generating report for script:', scriptId, 'project:', projectId);
      alert(`Generating report for script ${scriptId}...`);
    } catch (error) {
      console.error('Error generating report:', error);
      throw error;
    }
  };

  const handleImportScript = async () => {
    if (!importFile) {
      alert('Please select a file to import');
      return;
    }
    if (!selectedProjectId) {
      alert('Please select a project first');
      return;
    }

    setImporting(true);
    try {
      const fileContent = await importFile.text();
      const scriptName = importFile.name.replace(/\.[^/.]+$/, '');
      
      const response = await axios.post(
        `${API_URL}/scripts`,
        {
          name: scriptName,
          language: importLanguage,
          content: fileContent,
          projectId: selectedProjectId,
          description: `Imported from ${importFile.name}`
        },
        { headers }
      );

      alert('Script imported successfully!');
      setShowImportDialog(false);
      setImportFile(null);
      await loadData();
    } catch (error: any) {
      console.error('Error importing script:', error);
      alert('Failed to import script: ' + (error.response?.data?.error || error.message));
    } finally {
      setImporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      // Auto-detect language from file extension
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'js') setImportLanguage('javascript');
      else if (ext === 'ts') setImportLanguage('typescript');
      else if (ext === 'py') setImportLanguage('python');
      else if (ext === 'java') setImportLanguage('java');
      else if (ext === 'cs') setImportLanguage('csharp');
    }
  };

  const menuItems = [
    { id: 'overview', icon: '📊', label: 'Project Overview', category: 'Main' },
    { id: 'organizations', icon: '🏢', label: 'Organizations', category: 'Main' },
    { id: 'scripts', icon: '📝', label: 'Scripts', category: 'Test Management' },
    { id: 'runs', icon: '▶️', label: 'Test Runs', category: 'Test Management' },
    { id: 'bdd', icon: '🥒', label: 'BDD Features', category: 'Test Management' },
    { id: 'testdata', icon: '🗄️', label: 'Test Data', category: 'Data Management' },
    { id: 'apitesting', icon: '🔌', label: 'API Testing', category: 'Testing Tools' },
    { id: 'allure', icon: '📈', label: 'Test Execution Reports', category: 'Reports' },
    { id: 'analytics', icon: '📉', label: 'Analytics', category: 'Reports' },
    { id: 'settings', icon: '⚙️', label: 'Settings', category: 'System' }
  ];

  const groupedMenuItems = menuItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof menuItems>);

  const currentProjectName = selectedProjectId
    ? projects.find(p => p.id === selectedProjectId)?.name || 'Unknown Project'
    : 'No Project';

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <aside className={`dashboard-sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>🎭 Playwright CRX</h2>
          <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Project badge */}
        <div className="project-badge" style={{ padding: '8px 12px', color: '#888' }}>
          Project: <strong>{currentProjectName}</strong>
        </div>

        <nav className="sidebar-nav">
          {Object.entries(groupedMenuItems).map(([category, items]) => (
            <div key={category} className="nav-category">
              <div className="category-label">{category}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveView(item.id as ActiveView);
                    setMenuOpen(false);
                  }}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                  {/* Badge removed - no longer using badges */}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="dashboard-main">
        <div className="dashboard-content">
          {/* Overview */}
          {activeView === 'overview' && (
            <div className="view-container">
              <h1 className="view-title">Project Overview</h1>

              {/* Project Controls */}
              <div className="project-controls" style={{ marginBottom: 24 }}>
                <h2>Project</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="content-card">
                    <div className="form-group">
                      <label>Selected Project</label>
                      <select
                        value={selectedProjectId || ''}
                        onChange={(e) => setSelectedProjectId(e.target.value || null)}
                        disabled={projectLoading}
                        className="form-select"
                      >
                        <option value="">All Projects</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-secondary" onClick={loadProjects} disabled={projectLoading}>
                        {projectLoading ? '🔄 Refreshing...' : '🔄 Refresh'}
                      </button>
                      <button className="btn-secondary" onClick={loadData} disabled={loading}>
                        {loading ? '⏳ Loading...' : '↻ Reload Data'}
                      </button>
                    </div>
                  </div>

                  <div className="content-card">
                    <h3>Create Project</h3>
                    <div className="form-group">
                      <label>Project Name</label>
                      <input
                        type="text"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="e.g., Checkout Flow"
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label>Description (optional)</label>
                      <textarea
                        value={newProjectDescription}
                        onChange={(e) => setNewProjectDescription(e.target.value)}
                        placeholder="Short description"
                        className="form-textarea"
                        rows={3}
                      />
                    </div>
                    <button className="btn-primary" onClick={createProject} disabled={projectLoading}>
                      {projectLoading ? '⏳ Creating...' : '➕ Create Project'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="quick-actions">
                <h2>Quick Actions</h2>
                <div className="action-grid">
                  <button className="action-card" onClick={() => setActiveView('scripts')}>
                    <span className="action-icon">📝</span>
                    <span className="action-label">View Scripts</span>
                  </button>
                  <button className="action-card" onClick={() => setActiveView('runs')}>
                    <span className="action-icon">▶️</span>
                    <span className="action-label">Test Runs</span>
                  </button>
                  <button className="action-card" onClick={() => setActiveView('apitesting')}>
                    <span className="action-icon">🔌</span>
                    <span className="action-label">API Testing</span>
                  </button>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="recent-activity">
                <h2>Recent Test Runs</h2>
                <div className="activity-list">
                  {testRuns.slice(0, 5).map((run) => (
                    <div key={run.id} className="activity-item">
                      <div className="activity-icon">
                        {run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : '⏳'}
                      </div>
                      <div className="activity-content">
                        <div className="activity-title">{run.script.name}</div>
                        <div className="activity-meta">
                          {new Date(run.startedAt).toLocaleString()}
                          {run.duration && ` • ${run.duration}ms`}
                        </div>
                      </div>
                      <span className={`status-badge ${run.status}`}>{run.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Scripts View */}
          {activeView === 'scripts' && (
            <div className="view-container">
              <div>
                <h1 className="view-title" style={{ marginBottom: 8 }}>Test Scripts</h1>
                <div style={{ color: '#666', fontSize: 14 }}>
                  Filter: <strong>{selectedProjectId ? currentProjectName : 'All Projects'}</strong>
                </div>
              </div>
              
              {/* Standard 5-Step Workflow Template */}
              <ScriptCueCards
                script={{
                  id: 'template',
                  name: 'Standard Workflow',
                  language: 'Template'
                }}
                onGenerate={() => setShowImportDialog(true)}
                onEnhance={() => {
                  if (scripts.length === 0) {
                    alert('Please import a script first');
                    return;
                  }
                  setSelectedScriptForAction({ id: scripts[0].id, name: scripts[0].name });
                  setShowEnhancementModal(true);
                }}
                onValidate={() => {
                  if (scripts.length === 0) {
                    alert('Please import a script first');
                    return;
                  }
                  setSelectedScriptForAction({ id: scripts[0].id, name: scripts[0].name });
                  setShowValidationModal(true);
                }}
                onFinalize={() => {
                  if (scripts.length === 0) {
                    alert('Please import a script first');
                    return;
                  }
                  // Open script selection modal
                  setCurrentScriptForExecution({ id: scripts[0].id, name: scripts[0].name });
                  setShowExecuteModal(true);
                }}
                onInsights={() => {
                  if (scripts.length === 0) {
                    alert('Please import a script first');
                    return;
                  }
                  setActiveView('analytics');
                }}
                layout="standalone"
                showHeader={true}
              />
              
              {/* Database Scripts List */}
              <div style={{ marginTop: 40 }}>
                <h2 style={{ marginBottom: 16 }}>
                  📝 Your Scripts {selectedProjectId && `in ${currentProjectName}`}
                </h2>
                {loading ? (
                  <div className="loading-state">Loading scripts...</div>
                ) : scripts.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📝</div>
                    <h3>No Scripts Yet</h3>
                    <p>Use Step 1 above to import your first script!</p>
                  </div>
                ) : (
                  <div className="cards-grid">
                    {scripts
                      .filter((script) =>
                        searchQuery
                          ? script.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (script.description || '').toLowerCase().includes(searchQuery.toLowerCase())
                          : true
                      )
                      .map((script) => (
                        <div key={script.id} className="content-card">
                          <div className="card-header">
                            <h3>{script.name}</h3>
                            <span className="language-badge">{script.language}</span>
                          </div>
                          {script.description && <p className="card-description">{script.description}</p>}
                          <div className="card-meta">
                            <span>👤 {script.user.name}</span>
                            <span>📅 {new Date(script.createdAt).toLocaleDateString()}</span>
                          </div>
                          {userRole !== 'user' && (
                            <div className="card-actions" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                              <button 
                                className="btn-secondary"
                                onClick={() => {
                                  setSelectedScriptForAction({ id: script.id, name: script.name });
                                  setShowEnhancementModal(true);
                                }}
                                style={{ flex: 1, fontSize: 13 }}
                              >
                                🚀 Enhance
                              </button>
                              <button 
                                className="btn-secondary"
                                onClick={() => {
                                  setSelectedScriptForAction({ id: script.id, name: script.name });
                                  setShowValidationModal(true);
                                }}
                                style={{ flex: 1, fontSize: 13 }}
                              >
                                🔍 Validate
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Import Dialog */}
              {showImportDialog && (
                <div className="modal-overlay" onClick={() => setShowImportDialog(false)}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h2>📥 Import Script</h2>
                      <button className="modal-close" onClick={() => setShowImportDialog(false)}>
                        ✕
                      </button>
                    </div>
                    <div className="modal-body">
                      <div className="form-group">
                        <label>Select Project</label>
                        <select
                          value={selectedProjectId || ''}
                          onChange={(e) => setSelectedProjectId(e.target.value)}
                          className="form-select"
                        >
                          <option value="">-- Select a project --</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Script Language</label>
                        <select
                          value={importLanguage}
                          onChange={(e) => setImportLanguage(e.target.value)}
                          className="form-select"
                        >
                          <option value="javascript">JavaScript</option>
                          <option value="typescript">TypeScript</option>
                          <option value="python">Python</option>
                          <option value="java">Java</option>
                          <option value="csharp">C#</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Upload Script File</label>
                        <input
                          type="file"
                          onChange={handleFileChange}
                          accept=".js,.ts,.py,.java,.cs"
                          className="form-input"
                        />
                        {importFile && (
                          <p style={{ marginTop: 8, fontSize: 13, color: '#667eea' }}>
                            ✓ Selected: {importFile.name}
                          </p>
                        )}
                      </div>

                      <div className="modal-actions">
                        <button
                          className="btn-secondary"
                          onClick={() => setShowImportDialog(false)}
                          disabled={importing}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn-primary"
                          onClick={handleImportScript}
                          disabled={importing || !importFile || !selectedProjectId}
                        >
                          {importing ? '⏳ Importing...' : '📥 Import Script'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Script Enhancement Modal */}
              {showEnhancementModal && (
                <ScriptEnhancementModal
                  onClose={() => setShowEnhancementModal(false)}
                  onApply={() => {
                    loadData();
                  }}
                />
              )}

              {/* Import Script Modal (for Step 1 - Generate) */}
              {showImportScriptModal && (
                <ImportScriptModal
                  isOpen={showImportScriptModal}
                  onClose={() => setShowImportScriptModal(false)}
                  onGenerateReport={handleGenerateReport}
                  currentScriptId={selectedScriptForAction?.id}
                />
              )}

              {/* Script Validation Modal */}
              {showValidationModal && (
                <ScriptValidationModal
                  scriptId={selectedScriptForAction?.id}
                  scriptName={selectedScriptForAction?.name}
                  onClose={() => {
                    setShowValidationModal(false);
                    setSelectedScriptForAction(null);
                  }}
                />
              )}


            </div>
          )}

          {/* Test Runs View */}
          {activeView === 'runs' && (
            <div className="view-container">
              <h1 className="view-title">Test Runs</h1>
              <div style={{ marginBottom: 12, color: '#666' }}>
                Filter: <strong>{selectedProjectId ? currentProjectName : 'All Projects'}</strong>
              </div>
              {loading ? (
                <div className="loading-state">Loading test runs...</div>
              ) : testRuns.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">▶️</div>
                  <h3>No Test Runs Yet</h3>
                  <p>Execute tests using the extension to see results here!</p>
                </div>
              ) : (
                <div className="runs-list">
                  {testRuns.map((run) => (
                    <div key={run.id} className="run-card">
                      <div className="run-header">
                        <div className="run-info">
                          <h3>{run.script.name}</h3>
                          <div className="run-meta">
                            <span className={`status-badge ${run.status}`}>{run.status}</span>
                            <span>🕒 {new Date(run.startedAt).toLocaleString()}</span>
                            {run.duration && <span>⏱️ {run.duration}ms</span>}
                          </div>
                        </div>
                        <div className="run-actions">
                          {run.allureReportUrl ? (
                            <button
                              className="btn-secondary"
                              onClick={() => {
                                setSelectedReport(run.allureReportUrl!);
                                setActiveView('allure');
                              }}
                            >
                              📊 View Report
                            </button>
                          ) : (
                            <button
                              className="btn-primary"
                              onClick={() => generateAllureReport(run.id)}
                              disabled={generatingReport === run.id}
                            >
                              {generatingReport === run.id ? '⏳ Generating...' : '📊 Generate Report'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Test Data Management */}
          {activeView === 'testdata' && (
            <div className="view-container">
              <h1 className="view-title">Test Data Management</h1>
              <div className="empty-state">
                <div className="empty-icon">🗄️</div>
                <h3>Test Data Management</h3>
                <p>Test data management features are currently being developed.</p>
                <p>This section will allow you to manage test data repositories, snapshots, and synthetic data generation.</p>
              </div>
            </div>
          )}

          {/* BDD Features */}
          {activeView === 'bdd' && (
            <BDDFeatureManager
              selectedProjectId={selectedProjectId}
              currentProjectName={currentProjectName}
              token={token}
            />
          )}

          {/* API Testing */}
          {activeView === 'apitesting' && <ApiTesting />}
          
                    {/* Organizations */}
                    {activeView === 'organizations' && <OrganizationManagement />}

          {/* Allure Reports */}
          {activeView === 'allure' && (
            <div className="view-container full-height">
              <h1 className="view-title">Test Execution Reports</h1>
              {selectedReport ? (
                <div className="report-viewer">
                  <div className="report-header">
                    <button className="btn-secondary" onClick={() => setSelectedReport(null)}>
                      ← Back to Runs
                    </button>
                  </div>
                  <iframe
                    src={`http://localhost:3001${selectedReport}`}
                    className="report-iframe"
                    title="Test Execution Report"
                  />
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">📊</div>
                  <h3>No Report Selected</h3>
                  <p>Generate or view a test execution report from the Test Runs section.</p>
                  <button className="btn-primary" onClick={() => setActiveView('runs')}>
                    View Test Runs
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Script Execution Modal */}
          {showExecuteModal && currentScriptForExecution && (
            <ScriptExecutionModal
              script={{
                id: currentScriptForExecution.id,
                name: currentScriptForExecution.name,
                language: 'javascript' // default language
              }}
              onClose={() => {
                setShowExecuteModal(false);
                setCurrentScriptForExecution(null);
              }}
              onExecuteSuccess={() => {
                setShowExecuteModal(false);
                setCurrentScriptForExecution(null);
                // Optionally refresh runs after successful execution
                loadData();
              }}
            />
          )}

          {/* Analytics */}
          {activeView === 'analytics' && (
            <div className="view-container">
              <h1 className="view-title">Analytics</h1>
              <div className="empty-state">
                <div className="empty-icon">📉</div>
                <h3>Analytics Dashboard</h3>
                <p>Analytics and trend reports are under construction.</p>
              </div>
            </div>
          )}

          {/* Settings */}
          {activeView === 'settings' && (
            <div className="view-container">
              <h1 className="view-title">Settings</h1>
              <div className="empty-state">
                <div className="empty-icon">⚙️</div>
                <h3>System Settings</h3>
                <p>Configure system-wide settings, integrations, and defaults here.</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;

