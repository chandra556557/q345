import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import './BDDTesting.css';

const API_URL = 'http://localhost:3001/api';

interface BDDFeature {
  id: string;
  name: string;
  description?: string;
  featureContent: string;
  tags: string[];
  status: string;
  scenarioCount?: number;
  runCount?: number;
  createdAt: string;
  scenarios?: BDDScenario[];
}

interface BDDScenario {
  id: string;
  name: string;
  scenarioType: string;
  tags: string[];
  steps: BDDStep[];
}

interface BDDStep {
  id: string;
  keyword: string;
  text: string;
}

interface BDDRun {
  id: string;
  featureId: string;
  featureName: string;
  status: string;
  duration?: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  errorMsg?: string;
  stepResults?: StepResult[];
  reportUrl?: string;
  screenshotUrls?: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface StepResult {
  keyword: string;
  name: string;
  status: string;
  duration?: number;
  errorMessage?: string;
}

interface StepLibEntry {
  id: string;
  pattern: string;
  code: string;
  keyword: string;
  description?: string;
  tags: string[];
  usageCount: number;
  createdAt: string;
}

interface BDDSchedule {
  id: string;
  featureId: string;
  featureName: string;
  cronExpression: string;
  tags?: string;
  browser: string;
  executionMode: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

interface ScreenplayAction {
  id: string;
  name: string;
  description?: string;
  actionType: string;
  target?: string;
  value?: string;
  code: string;
  tags: string[];
  usageCount: number;
}

interface ScreenplayQuestion {
  id: string;
  name: string;
  description?: string;
  questionType: string;
  target?: string;
  expected?: string;
  code: string;
  tags: string[];
  usageCount: number;
}

interface ScreenplayTask {
  id: string;
  name: string;
  description?: string;
  actorType: string;
  actions: string[];
  questions: string[];
  tags: string[];
  generatedCode?: string;
  usageCount: number;
}

interface PresetItem {
  name: string;
  description: string;
  actionType?: string;
  questionType?: string;
  code: string;
}

const SAMPLE_FEATURE = `Feature: Login functionality
  As a user
  I want to be able to login
  So that I can access my account

  @smoke
  Scenario: Successful login with valid credentials
    Given I navigate to "https://example.com/login"
    When I fill "Username" with "testuser"
    And I fill "Password" with "password123"
    And I click "Login"
    Then I should see "Welcome"

  @negative
  Scenario: Failed login with invalid password
    Given I navigate to "https://example.com/login"
    When I fill "Username" with "testuser"
    And I fill "Password" with "wrongpassword"
    And I click "Login"
    Then I should see "Invalid credentials"

  Scenario Outline: Login with multiple users
    Given I navigate to "https://example.com/login"
    When I fill "Username" with "<username>"
    And I fill "Password" with "<password>"
    And I click "Login"
    Then I should see "<result>"

    Examples:
      | username | password    | result  |
      | admin    | admin123    | Dashboard |
      | user1    | pass1       | Welcome   |
`;

const BDDTesting: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'editor' | 'features' | 'runs' | 'steplib' | 'schedules' | 'screenplay' | 'convert'>('editor');
  const [features, setFeatures] = useState<BDDFeature[]>([]);
  const [runs, setRuns] = useState<BDDRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Editor state
  const [featureName, setFeatureName] = useState('');
  const [featureContent, setFeatureContent] = useState(SAMPLE_FEATURE);
  const [generatedCode, setGeneratedCode] = useState('');
  const [parsedPreview, setParsedPreview] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [customStepDefs, setCustomStepDefs] = useState('');
  const [showStepEditor, setShowStepEditor] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<'typescript' | 'java'>('typescript');

  // Convert tab state
  const [convertInput, setConvertInput] = useState('');
  const [convertFile, setConvertFile] = useState<File | null>(null);
  const [convertResult, setConvertResult] = useState('');
  const [convertWarnings, setConvertWarnings] = useState<string[]>([]);
  const [converting, setConverting] = useState(false);

  // Run options
  const [runTags, setRunTags] = useState('');
  const [parallelWorkers, setParallelWorkers] = useState(1);

  // Detail state
  const [selectedFeature, setSelectedFeature] = useState<BDDFeature | null>(null);
  const [selectedRun, setSelectedRun] = useState<BDDRun | null>(null);
  const [runningFeatureId, setRunningFeatureId] = useState<string | null>(null);

  // Live streaming
  const [liveOutput, setLiveOutput] = useState<string[]>([]);
  const [liveSteps, setLiveSteps] = useState<StepResult[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Step Library state
  const [stepLibEntries, setStepLibEntries] = useState<StepLibEntry[]>([]);
  const [newStepPattern, setNewStepPattern] = useState('');
  const [newStepCode, setNewStepCode] = useState('');
  const [newStepKeyword, setNewStepKeyword] = useState('Given');
  const [newStepDesc, setNewStepDesc] = useState('');

  // Schedules state
  const [schedules, setSchedules] = useState<BDDSchedule[]>([]);
  const [schedFeatureId, setSchedFeatureId] = useState('');
  const [schedCron, setSchedCron] = useState('every 1h');
  const [schedTags, setSchedTags] = useState('');

  // Screenplay state
  const [screenplaySubTab, setScreenplaySubTab] = useState<'tasks' | 'actions' | 'questions'>('tasks');
  const [spActions, setSpActions] = useState<ScreenplayAction[]>([]);
  const [spQuestions, setSpQuestions] = useState<ScreenplayQuestion[]>([]);
  const [spTasks, setSpTasks] = useState<ScreenplayTask[]>([]);
  const [presetActions, setPresetActions] = useState<PresetItem[]>([]);
  const [presetQuestions, setPresetQuestions] = useState<PresetItem[]>([]);
  // New action form
  const [newActionName, setNewActionName] = useState('');
  const [newActionType, setNewActionType] = useState('custom');
  const [newActionCode, setNewActionCode] = useState('');
  const [newActionDesc, setNewActionDesc] = useState('');
  // New question form
  const [newQuestionName, setNewQuestionName] = useState('');
  const [newQuestionType, setNewQuestionType] = useState('custom');
  const [newQuestionCode, setNewQuestionCode] = useState('');
  const [newQuestionDesc, setNewQuestionDesc] = useState('');
  // New task form
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskActor, setNewTaskActor] = useState('User');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [generatedTaskCode, setGeneratedTaskCode] = useState('');

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  const loadFeatures = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/bdd/features`, { headers });
      setFeatures(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load features');
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/bdd/runs`, { headers });
      setRuns(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load runs');
    }
  }, []);

  const loadStepLibrary = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/bdd/step-library`, { headers });
      setStepLibEntries(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load step library');
    }
  }, []);

  const loadSchedules = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/bdd/schedules`, { headers });
      setSchedules(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load schedules');
    }
  }, []);

  useEffect(() => {
    loadFeatures();
    loadRuns();
  }, []);

  // Parse feature content for preview
  const handleParse = async () => {
    if (!featureContent.trim()) return;
    try {
      setLoading(true);
      const res = await axios.post(`${API_URL}/bdd/parse`, { featureContent, language: codeLanguage }, { headers });
      setParsedPreview(res.data.data.parsed);
      setGeneratedCode(res.data.data.playwrightCode);
      if (!featureName && res.data.data.parsed.name) {
        setFeatureName(res.data.data.parsed.name);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to parse feature');
    } finally {
      setLoading(false);
    }
  };

  const handleConvert = async () => {
    setConverting(true);
    setConvertResult('');
    setConvertWarnings([]);
    try {
      let res;
      if (convertFile) {
        const form = new FormData();
        form.append('file', convertFile);
        res = await axios.post(`${API_URL}/bdd/convert`, form, {
          headers: { ...headers, 'Content-Type': 'multipart/form-data' },
        });
      } else if (convertInput.trim()) {
        res = await axios.post(`${API_URL}/bdd/convert`, { content: convertInput }, { headers });
      } else {
        setError('Paste test cases or upload a file first');
        return;
      }
      setConvertResult(res.data.data.gherkin);
      setConvertWarnings(res.data.data.warnings || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  const handleSaveFeature = async () => {
    if (!featureName.trim() || !featureContent.trim()) {
      setError('Feature name and content are required');
      return;
    }
    try {
      setSaving(true);
      setError('');
      if (editingFeatureId) {
        // Update existing feature
        await axios.put(`${API_URL}/bdd/features/${editingFeatureId}`, { name: featureName, featureContent }, { headers });
      } else {
        // Create new feature
        await axios.post(`${API_URL}/bdd/features`, { name: featureName, featureContent }, { headers });
      }
      setFeatureName('');
      setFeatureContent(SAMPLE_FEATURE);
      setGeneratedCode('');
      setParsedPreview(null);
      setEditingFeatureId(null);
      await loadFeatures();
      setActiveTab('features');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save feature');
    } finally {
      setSaving(false);
    }
  };

  // Run a feature with tags and parallel options
  const handleRunFeature = async (featureId: string) => {
    try {
      setRunningFeatureId(featureId);
      setError('');
      setLiveOutput([]);
      setLiveSteps([]);
      const stepDefinitions = customStepDefs.trim() ? { custom: customStepDefs } : {};
      const res = await axios.post(`${API_URL}/bdd/features/${featureId}/run`, {
        stepDefinitions,
        tags: runTags || undefined,
        parallelWorkers: parallelWorkers > 1 ? parallelWorkers : undefined,
      }, { headers });

      const runId = res.data.data?.id;

      // Start SSE live streaming
      if (runId) {
        startLiveStream(runId);
      }

      // Poll for results
      const pollInterval = setInterval(async () => {
        await loadRuns();
        const latestRuns = await axios.get(`${API_URL}/bdd/runs?featureId=${featureId}`, { headers });
        const latest = latestRuns.data.data?.[0];
        if (latest && latest.status !== 'running' && latest.status !== 'pending' && latest.status !== 'queued') {
          clearInterval(pollInterval);
          setRunningFeatureId(null);
          setActiveTab('runs');
        }
      }, 3000);
      setTimeout(() => { clearInterval(pollInterval); setRunningFeatureId(null); }, 300000);
    } catch (err: any) {
      setRunningFeatureId(null);
      setError(err.response?.data?.error || 'Failed to start run');
    }
  };

  // SSE live streaming
  const startLiveStream = (runId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const token = localStorage.getItem('accessToken') || '';
    const es = new EventSource(`${API_URL}/bdd/runs/${runId}/stream?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'output') {
          setLiveOutput(prev => [...prev, data.data.text]);
        } else if (data.event === 'step') {
          setLiveSteps(prev => [...prev, data.data]);
        } else if (data.event === 'completed' || data.event === 'error') {
          es.close();
          eventSourceRef.current = null;
          // Refresh runs to get reportUrl and final status
          loadRuns();
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
    };
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const handleDeleteFeature = async (id: string) => {
    if (!confirm('Delete this feature and all its scenarios?')) return;
    try {
      await axios.delete(`${API_URL}/bdd/features/${id}`, { headers });
      await loadFeatures();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleViewFeature = async (id: string) => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/bdd/features/${id}`, { headers });
      setSelectedFeature(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load feature');
    } finally {
      setLoading(false);
    }
  };

  const handleEditFeature = (feature: BDDFeature) => {
    setEditingFeatureId(feature.id);
    setFeatureName(feature.name);
    setFeatureContent(feature.featureContent);
    setGeneratedCode('');
    setParsedPreview(null);
    setActiveTab('editor');
  };

  const handleViewRun = async (id: string) => {
    try {
      const res = await axios.get(`${API_URL}/bdd/runs/${id}`, { headers });
      setSelectedRun(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load run');
    }
  };

  const handleCancelRun = async (id: string) => {
    try {
      await axios.post(`${API_URL}/bdd/runs/${id}/cancel`, {}, { headers });
      await loadRuns();
      if (selectedRun?.id === id) {
        const res = await axios.get(`${API_URL}/bdd/runs/${id}`, { headers });
        setSelectedRun(res.data.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to cancel run');
    }
  };

  // Auto-refresh for running runs
  useEffect(() => {
    if (!selectedRun || (selectedRun.status !== 'running' && selectedRun.status !== 'pending')) return;
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_URL}/bdd/runs/${selectedRun.id}`, { headers });
        setSelectedRun(res.data.data);
        if (res.data.data.status !== 'running' && res.data.data.status !== 'pending') {
          clearInterval(interval);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedRun?.id, selectedRun?.status]);

  // Step Library CRUD
  const handleAddStepLib = async () => {
    if (!newStepPattern.trim() || !newStepCode.trim()) {
      setError('Pattern and code are required');
      return;
    }
    try {
      await axios.post(`${API_URL}/bdd/step-library`, {
        pattern: newStepPattern,
        code: newStepCode,
        keyword: newStepKeyword,
        description: newStepDesc || undefined,
      }, { headers });
      setNewStepPattern('');
      setNewStepCode('');
      setNewStepDesc('');
      await loadStepLibrary();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add step');
    }
  };

  const handleDeleteStepLib = async (id: string) => {
    try {
      await axios.delete(`${API_URL}/bdd/step-library/${id}`, { headers });
      await loadStepLibrary();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete step');
    }
  };

  // Schedule CRUD
  const handleAddSchedule = async () => {
    if (!schedFeatureId || !schedCron) {
      setError('Feature and cron expression are required');
      return;
    }
    try {
      await axios.post(`${API_URL}/bdd/schedules`, {
        featureId: schedFeatureId,
        cronExpression: schedCron,
        tags: schedTags || undefined,
      }, { headers });
      setSchedFeatureId('');
      setSchedCron('every 1h');
      setSchedTags('');
      await loadSchedules();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create schedule');
    }
  };

  const handleToggleSchedule = async (id: string, enabled: boolean) => {
    try {
      await axios.put(`${API_URL}/bdd/schedules/${id}`, { enabled: !enabled }, { headers });
      await loadSchedules();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update schedule');
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      await axios.delete(`${API_URL}/bdd/schedules/${id}`, { headers });
      await loadSchedules();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete schedule');
    }
  };

  // ===========================
  // SCREENPLAY HANDLERS
  // ===========================

  const loadScreenplayActions = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/screenplay/actions`, { headers });
      setSpActions(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  const loadScreenplayQuestions = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/screenplay/questions`, { headers });
      setSpQuestions(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  const loadScreenplayTasks = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/screenplay/tasks`, { headers });
      setSpTasks(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      const [actRes, qRes] = await Promise.all([
        axios.get(`${API_URL}/screenplay/presets/actions`, { headers }),
        axios.get(`${API_URL}/screenplay/presets/questions`, { headers }),
      ]);
      setPresetActions(actRes.data.data || []);
      setPresetQuestions(qRes.data.data || []);
    } catch { /* ignore */ }
  }, []);

  const handleCreateAction = async () => {
    if (!newActionName.trim() || !newActionCode.trim()) {
      setError('Action name and code are required');
      return;
    }
    try {
      await axios.post(`${API_URL}/screenplay/actions`, {
        name: newActionName, description: newActionDesc || undefined,
        actionType: newActionType, code: newActionCode,
      }, { headers });
      setNewActionName(''); setNewActionCode(''); setNewActionDesc('');
      await loadScreenplayActions();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create action');
    }
  };

  const handleDeleteAction = async (id: string) => {
    try {
      await axios.delete(`${API_URL}/screenplay/actions/${id}`, { headers });
      await loadScreenplayActions();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete action');
    }
  };

  const handleCreateQuestion = async () => {
    if (!newQuestionName.trim() || !newQuestionCode.trim()) {
      setError('Question name and code are required');
      return;
    }
    try {
      await axios.post(`${API_URL}/screenplay/questions`, {
        name: newQuestionName, description: newQuestionDesc || undefined,
        questionType: newQuestionType, code: newQuestionCode,
      }, { headers });
      setNewQuestionName(''); setNewQuestionCode(''); setNewQuestionDesc('');
      await loadScreenplayQuestions();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create question');
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    try {
      await axios.delete(`${API_URL}/screenplay/questions/${id}`, { headers });
      await loadScreenplayQuestions();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete question');
    }
  };

  const handleCreateTask = async () => {
    if (!newTaskName.trim()) {
      setError('Task name is required');
      return;
    }
    try {
      await axios.post(`${API_URL}/screenplay/tasks`, {
        name: newTaskName, description: newTaskDesc || undefined,
        actorType: newTaskActor, actions: selectedActionIds, questions: selectedQuestionIds,
      }, { headers });
      setNewTaskName(''); setNewTaskDesc(''); setNewTaskActor('User');
      setSelectedActionIds([]); setSelectedQuestionIds([]);
      setGeneratedTaskCode('');
      await loadScreenplayTasks();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create task');
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await axios.delete(`${API_URL}/screenplay/tasks/${id}`, { headers });
      await loadScreenplayTasks();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete task');
    }
  };

  const handleGenerateTaskCode = async (id: string) => {
    try {
      const res = await axios.post(`${API_URL}/screenplay/tasks/${id}/generate`, {}, { headers });
      setGeneratedTaskCode(res.data.data?.code || '');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to generate code');
    }
  };

  const handleUsePresetAction = (preset: PresetItem) => {
    setNewActionName(preset.name);
    setNewActionCode(preset.code);
    setNewActionDesc(preset.description);
    setNewActionType(preset.actionType || 'custom');
  };

  const handleUsePresetQuestion = (preset: PresetItem) => {
    setNewQuestionName(preset.name);
    setNewQuestionCode(preset.code);
    setNewQuestionDesc(preset.description);
    setNewQuestionType(preset.questionType || 'custom');
  };

  const toggleActionSelection = (id: string) => {
    setSelectedActionIds(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const toggleQuestionSelection = (id: string) => {
    setSelectedQuestionIds(prev =>
      prev.includes(id) ? prev.filter(q => q !== id) : [...prev, id]
    );
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatDate = (d: string) => new Date(d).toLocaleString();

  return (
    <div className="bdd-container">
      <div className="bdd-header">
        <h1>BDD Testing (Serenity / Screenplay)</h1>
      </div>

      {error && (
        <div style={{ background: '#ffebee', color: '#c62828', padding: '10px 14px', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>x</button>
        </div>
      )}

      <div className="bdd-tabs">
        <button className={`bdd-tab ${activeTab === 'editor' ? 'active' : ''}`} onClick={() => setActiveTab('editor')}>Feature Editor</button>
        <button className={`bdd-tab ${activeTab === 'features' ? 'active' : ''}`} onClick={() => { setActiveTab('features'); loadFeatures(); }}>Features ({features.length})</button>
        <button className={`bdd-tab ${activeTab === 'runs' ? 'active' : ''}`} onClick={() => { setActiveTab('runs'); loadRuns(); }}>Runs ({runs.length})</button>
        <button className={`bdd-tab ${activeTab === 'steplib' ? 'active' : ''}`} onClick={() => { setActiveTab('steplib'); loadStepLibrary(); }}>Step Library</button>
        <button className={`bdd-tab ${activeTab === 'schedules' ? 'active' : ''}`} onClick={() => { setActiveTab('schedules'); loadSchedules(); loadFeatures(); }}>Schedules</button>
        <button className={`bdd-tab ${activeTab === 'screenplay' ? 'active' : ''}`} onClick={() => { setActiveTab('screenplay'); loadScreenplayActions(); loadScreenplayQuestions(); loadScreenplayTasks(); loadPresets(); }}>Screenplay</button>
        <button className={`bdd-tab ${activeTab === 'convert' ? 'active' : ''}`} onClick={() => setActiveTab('convert')}>Convert to Gherkin</button>
      </div>

      {/* ===== Feature Editor Tab ===== */}
      {activeTab === 'editor' && (
        <div>
          <div className="bdd-form-row">
            <input type="text" placeholder="Feature name" value={featureName} onChange={e => setFeatureName(e.target.value)} />
            <select
              value={codeLanguage}
              onChange={e => setCodeLanguage(e.target.value as 'typescript' | 'java')}
              style={{ padding: '6px 10px', border: '1px solid #d0d0d0', borderRadius: '4px', fontSize: '13px' }}
            >
              <option value="typescript">TypeScript</option>
              <option value="java">Java</option>
            </select>
            <button className="bdd-btn bdd-btn-primary" onClick={handleParse} disabled={loading || !featureContent.trim()}>
              {loading ? 'Parsing...' : 'Parse & Preview'}
            </button>
            <button className="bdd-btn bdd-btn-success" onClick={handleSaveFeature} disabled={saving || !featureName.trim() || !featureContent.trim()}>
              {saving ? 'Saving...' : editingFeatureId ? 'Update Feature' : 'Save Feature'}
            </button>
            {editingFeatureId && (
              <button className="bdd-btn" onClick={() => { setEditingFeatureId(null); setFeatureName(''); setFeatureContent(SAMPLE_FEATURE); setGeneratedCode(''); setParsedPreview(null); }}>
                Cancel Edit
              </button>
            )}
          </div>

          {/* Run Options: Tags & Parallel */}
          <div className="bdd-form-row" style={{ background: '#f5f7fa', padding: '10px 14px', borderRadius: '8px' }}>
            <div style={{ flex: 2 }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Tag Filter (e.g. @smoke, @smoke and not @wip)</label>
              <input type="text" placeholder="@smoke" value={runTags} onChange={e => setRunTags(e.target.value)} style={{ width: '100%', padding: '6px 10px', border: '1px solid #d0d0d0', borderRadius: '4px', fontSize: '13px' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '4px' }}>Parallel Workers</label>
              <select value={parallelWorkers} onChange={e => setParallelWorkers(parseInt(e.target.value))} style={{ width: '100%', padding: '6px 10px', border: '1px solid #d0d0d0', borderRadius: '4px', fontSize: '13px' }}>
                <option value={1}>1 (Sequential)</option>
                <option value={2}>2 Workers</option>
                <option value={3}>3 Workers</option>
                <option value={4}>4 Workers</option>
              </select>
            </div>
          </div>

          <div className="bdd-editor-section">
            <div className="bdd-editor-panel">
              <h3>
                Gherkin Feature File
                <span style={{ fontSize: '11px', color: '#999' }}>.feature</span>
              </h3>
              <textarea className="bdd-textarea" value={featureContent} onChange={e => setFeatureContent(e.target.value)} placeholder="Write your Gherkin feature here..." spellCheck={false} />
            </div>
            <div className="bdd-editor-panel">
              <h3>
                Generated Playwright Code
                <span style={{ fontSize: '11px', color: '#999' }}>{codeLanguage === 'java' ? '.java' : '.spec.ts'}</span>
              </h3>
              <pre className="bdd-code-preview">
                {generatedCode || (codeLanguage === 'java' ? '// Click "Parse & Preview" to generate Java Playwright code' : '// Click "Parse & Preview" to generate Playwright code from your Gherkin feature')}
              </pre>
            </div>
          </div>

          {/* Custom Step Definitions */}
          <div style={{ marginBottom: '20px' }}>
            <button className="bdd-btn bdd-btn-secondary" onClick={() => setShowStepEditor(!showStepEditor)} style={{ marginBottom: showStepEditor ? '12px' : 0 }}>
              {showStepEditor ? 'Hide' : 'Show'} Custom Step Definitions
            </button>
            {showStepEditor && (
              <div className="bdd-editor-panel">
                <h3>
                  Custom Step Definitions
                  <span style={{ fontSize: '11px', color: '#999' }}>JavaScript — leave empty to use auto-generated + library steps</span>
                </h3>
                <textarea
                  className="bdd-textarea"
                  value={customStepDefs}
                  onChange={e => setCustomStepDefs(e.target.value)}
                  placeholder={`// Write custom Cucumber step definitions here.\n// Example:\nGiven('I am logged in as {string}', async function (username) {\n  await page.goto('https://example.com/login');\n  await page.getByLabel('Username').fill(username);\n  await page.getByLabel('Password').fill('password');\n  await page.getByRole('button', { name: 'Login' }).click();\n});`}
                  spellCheck={false}
                  style={{ minHeight: '200px' }}
                />
              </div>
            )}
          </div>

          {/* Live Execution Output */}
          {(liveSteps.length > 0 || liveOutput.length > 0) && (
            <div className="bdd-editor-panel" style={{ marginBottom: '20px' }}>
              <h3>Live Execution</h3>
              <div style={{ padding: '12px 16px', maxHeight: '300px', overflow: 'auto', background: '#1e1e2e' }}>
                {liveSteps.map((step, idx) => (
                  <div key={idx} style={{ color: step.status === 'passed' ? '#a6e3a1' : step.status === 'failed' ? '#f38ba8' : '#cdd6f4', fontSize: '13px', padding: '2px 0', fontFamily: 'monospace' }}>
                    {step.status === 'passed' ? 'PASS' : step.status === 'failed' ? 'FAIL' : 'SKIP'} {step.keyword} {step.name}
                  </div>
                ))}
                {liveOutput.length > 0 && (
                  <pre style={{ color: '#cdd6f4', fontSize: '12px', margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>
                    {liveOutput.slice(-20).join('')}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Parsed Preview */}
          {parsedPreview && (
            <div className="bdd-scenario-tree">
              <h3>Parsed Structure</h3>
              {parsedPreview.scenarios?.map((scenario: any, idx: number) => (
                <div key={idx} className="bdd-scenario-item">
                  <h4>
                    {scenario.type === 'Scenario Outline' ? 'Scenario Outline' : 'Scenario'}: {scenario.name}
                    {scenario.tags?.map((tag: string, i: number) => (
                      <span key={i} className="bdd-tag">{tag}</span>
                    ))}
                  </h4>
                  {scenario.steps?.map((step: any, sIdx: number) => (
                    <div key={sIdx} className="bdd-step">
                      <span className="keyword">{step.keyword}</span> {step.text}
                    </div>
                  ))}
                  {scenario.examples && scenario.examples.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <strong style={{ fontSize: '12px' }}>Examples ({scenario.examples.length} rows)</strong>
                      <table style={{ fontSize: '12px', borderCollapse: 'collapse', marginTop: '4px', width: '100%' }}>
                        <thead>
                          <tr>
                            {Object.keys(scenario.examples[0]).map((key: string) => (
                              <th key={key} style={{ padding: '4px 8px', borderBottom: '1px solid #ddd', textAlign: 'left' }}>{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {scenario.examples.map((row: any, rIdx: number) => (
                            <tr key={rIdx}>
                              {Object.values(row).map((val: any, cIdx: number) => (
                                <td key={cIdx} style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{val}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== Features List Tab ===== */}
      {activeTab === 'features' && !selectedFeature && (
        <div>
          {features.length === 0 ? (
            <div className="bdd-empty">
              <h3>No BDD Features Yet</h3>
              <p>Create your first feature in the Feature Editor tab</p>
              <button className="bdd-btn bdd-btn-primary" onClick={() => setActiveTab('editor')}>Create Feature</button>
            </div>
          ) : (
            <div className="bdd-feature-list">
              {features.map(feature => (
                <div key={feature.id} className="bdd-feature-card">
                  <div className="bdd-feature-card-header">
                    <div>
                      <h3>{feature.name}</h3>
                      {feature.description && <p style={{ margin: '4px 0 0', color: '#666', fontSize: '13px' }}>{feature.description}</p>}
                    </div>
                    <span className={`bdd-status ${feature.status}`}>{feature.status}</span>
                  </div>
                  <div className="bdd-feature-meta">
                    <span>Scenarios: {feature.scenarioCount || 0}</span>
                    <span>Runs: {feature.runCount || 0}</span>
                    <span>Created: {formatDate(feature.createdAt)}</span>
                  </div>
                  {feature.tags && Array.isArray(feature.tags) && feature.tags.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      {feature.tags.map((tag: string, i: number) => (
                        <span key={i} className="bdd-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="bdd-feature-actions">
                    <button className="bdd-btn bdd-btn-sm bdd-btn-primary" onClick={() => handleViewFeature(feature.id)}>View</button>
                    <button className="bdd-btn bdd-btn-sm bdd-btn-secondary" onClick={() => handleEditFeature(feature)}>Edit</button>
                    <button className="bdd-btn bdd-btn-sm bdd-btn-success" onClick={() => handleRunFeature(feature.id)} disabled={runningFeatureId === feature.id}>
                      {runningFeatureId === feature.id ? 'Running...' : 'Run'}
                    </button>
                    <button className="bdd-btn bdd-btn-sm bdd-btn-danger" onClick={() => handleDeleteFeature(feature.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Feature Detail View */}
      {activeTab === 'features' && selectedFeature && (
        <div>
          <button className="bdd-btn bdd-btn-secondary" onClick={() => setSelectedFeature(null)} style={{ marginBottom: '16px' }}>
            Back to Features
          </button>
          <div className="bdd-feature-card">
            <div className="bdd-feature-card-header">
              <h3>{selectedFeature.name}</h3>
              <span className={`bdd-status ${selectedFeature.status}`}>{selectedFeature.status}</span>
            </div>
            {selectedFeature.description && <p style={{ color: '#666', marginBottom: '12px' }}>{selectedFeature.description}</p>}
            <div className="bdd-scenario-tree">
              <h3>Scenarios ({selectedFeature.scenarios?.length || 0})</h3>
              {selectedFeature.scenarios?.map((scenario, idx) => (
                <div key={idx} className="bdd-scenario-item">
                  <h4>
                    {scenario.scenarioType}: {scenario.name}
                    {scenario.tags?.map((tag: string, i: number) => (
                      <span key={i} className="bdd-tag">{tag}</span>
                    ))}
                  </h4>
                  {scenario.steps?.map((step, sIdx) => (
                    <div key={sIdx} className="bdd-step">
                      <span className="keyword">{step.keyword}</span> {step.text}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="bdd-feature-actions" style={{ marginTop: '16px' }}>
              <button className="bdd-btn bdd-btn-success" onClick={() => handleRunFeature(selectedFeature.id)} disabled={runningFeatureId === selectedFeature.id}>
                {runningFeatureId === selectedFeature.id ? 'Running...' : 'Run Feature'}
              </button>
              <button className="bdd-btn bdd-btn-secondary" onClick={() => handleEditFeature(selectedFeature)}>Edit in Editor</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Runs Tab ===== */}
      {activeTab === 'runs' && !selectedRun && (
        <div>
          {runs.length === 0 ? (
            <div className="bdd-empty">
              <h3>No BDD Runs Yet</h3>
              <p>Run a feature from the Features tab to see results here</p>
            </div>
          ) : (
            <div className="bdd-run-list">
              {runs.map(run => (
                <div key={run.id} className="bdd-run-card" onClick={() => handleViewRun(run.id)} style={{ cursor: 'pointer' }}>
                  <div className="bdd-run-card-header">
                    <div>
                      <strong>{run.featureName}</strong>
                      <span style={{ marginLeft: '8px', fontSize: '12px', color: '#999' }}>{formatDate(run.createdAt)}</span>
                    </div>
                    <span className={`bdd-run-status ${run.status}`}>{run.status}</span>
                  </div>
                  <div className="bdd-feature-meta">
                    <span>Steps: {run.passedSteps}/{run.totalSteps} passed</span>
                    {run.failedSteps > 0 && <span style={{ color: '#c62828' }}>{run.failedSteps} failed</span>}
                    <span>Duration: {formatDuration(run.duration)}</span>
                    {run.screenshotUrls && run.screenshotUrls.length > 0 && (
                      <span style={{ color: '#e65100' }}>{run.screenshotUrls.length} screenshot(s)</span>
                    )}
                  </div>
                  {run.totalSteps > 0 && (
                    <div className="bdd-progress-bar">
                      <div className={`bdd-progress-fill ${run.failedSteps > 0 ? 'fail' : 'pass'}`}
                        style={{ width: `${(run.passedSteps / run.totalSteps) * 100}%` }} />
                    </div>
                  )}
                  {run.reportUrl && (
                    <div style={{ marginTop: '8px' }}>
                      <a href={`http://localhost:3001${run.reportUrl}`} target="_blank" rel="noopener noreferrer"
                        className="bdd-btn bdd-btn-sm bdd-btn-primary" onClick={e => e.stopPropagation()}
                        style={{ textDecoration: 'none', display: 'inline-block' }}>
                        View Report
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Run Detail View */}
      {activeTab === 'runs' && selectedRun && (
        <div>
          <button className="bdd-btn bdd-btn-secondary" onClick={() => setSelectedRun(null)} style={{ marginBottom: '16px' }}>
            Back to Runs
          </button>
          <div className="bdd-run-card">
            <div className="bdd-run-card-header">
              <div><strong style={{ fontSize: '18px' }}>{selectedRun.featureName}</strong></div>
              <span className={`bdd-run-status ${selectedRun.status}`}>{selectedRun.status}</span>
            </div>
            <div className="bdd-feature-meta" style={{ marginBottom: '12px' }}>
              <span>Duration: {formatDuration(selectedRun.duration)}</span>
              <span>Total: {selectedRun.totalSteps} steps</span>
              <span style={{ color: '#2e7d32' }}>Passed: {selectedRun.passedSteps}</span>
              <span style={{ color: '#c62828' }}>Failed: {selectedRun.failedSteps}</span>
              <span style={{ color: '#999' }}>Skipped: {selectedRun.skippedSteps}</span>
            </div>

            {(selectedRun.status === 'running' || selectedRun.status === 'pending') && (
              <button className="bdd-btn bdd-btn-danger" onClick={() => handleCancelRun(selectedRun.id)} style={{ marginBottom: '12px' }}>
                Cancel Run
              </button>
            )}

            {selectedRun.reportUrl && (
              <a href={`http://localhost:3001${selectedRun.reportUrl}`} target="_blank" rel="noopener noreferrer"
                className="bdd-btn bdd-btn-primary" style={{ textDecoration: 'none', display: 'inline-block', marginBottom: '12px' }}>
                View Full Report
              </a>
            )}

            {selectedRun.errorMsg && (
              <div style={{ background: '#ffebee', color: '#c62828', padding: '10px', borderRadius: '6px', marginBottom: '12px', fontSize: '13px' }}>
                {selectedRun.errorMsg}
              </div>
            )}

            {selectedRun.totalSteps > 0 && (
              <div className="bdd-progress-bar" style={{ height: '10px', marginBottom: '16px' }}>
                <div className={`bdd-progress-fill ${selectedRun.failedSteps > 0 ? 'fail' : 'pass'}`}
                  style={{ width: `${(selectedRun.passedSteps / selectedRun.totalSteps) * 100}%` }} />
              </div>
            )}

            {/* Failure Screenshots */}
            {selectedRun.screenshotUrls && selectedRun.screenshotUrls.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ marginBottom: '8px', fontSize: '14px' }}>Failure Screenshots ({selectedRun.screenshotUrls.length})</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {selectedRun.screenshotUrls.map((url, i) => (
                    <a key={i} href={`http://localhost:3001${url}`} target="_blank" rel="noopener noreferrer"
                      style={{ border: '1px solid #eee', borderRadius: '6px', overflow: 'hidden', display: 'block' }}>
                      <img src={`http://localhost:3001${url}`} alt={`Screenshot ${i + 1}`} style={{ maxWidth: '250px', maxHeight: '180px', display: 'block' }} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Step Results */}
            {selectedRun.stepResults && selectedRun.stepResults.length > 0 && (
              <div className="bdd-step-results">
                <h3 style={{ marginBottom: '12px' }}>Step Results</h3>
                {selectedRun.stepResults.map((step, idx) => (
                  <div key={idx} className="bdd-step-result">
                    <span className="bdd-step-icon">
                      {step.status === 'passed' ? '\u2705' : step.status === 'failed' ? '\u274C' : '\u23ED\uFE0F'}
                    </span>
                    <span className="bdd-step-keyword">{step.keyword}</span>
                    <span>{step.name}</span>
                    {step.duration && <span className="bdd-step-duration">{formatDuration(step.duration)}</span>}
                    {step.errorMessage && (
                      <div style={{ width: '100%', marginTop: '4px', padding: '6px 8px', background: '#fff5f5', color: '#c62828', fontSize: '12px', borderRadius: '4px' }}>
                        {step.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Step Library Tab ===== */}
      {activeTab === 'steplib' && (
        <div>
          <div style={{ background: '#f5f7fa', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
            <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Add Reusable Step Definition</h3>
            <div className="bdd-form-row">
              <select value={newStepKeyword} onChange={e => setNewStepKeyword(e.target.value)} style={{ flex: '0 0 100px' }}>
                <option value="Given">Given</option>
                <option value="When">When</option>
                <option value="Then">Then</option>
              </select>
              <input type="text" placeholder="Pattern (e.g. I login as {string})" value={newStepPattern} onChange={e => setNewStepPattern(e.target.value)} />
            </div>
            <input type="text" placeholder="Description (optional)" value={newStepDesc} onChange={e => setNewStepDesc(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '6px', fontSize: '13px', marginBottom: '8px' }} />
            <textarea
              value={newStepCode}
              onChange={e => setNewStepCode(e.target.value)}
              placeholder={`Given('I login as {string}', async function (username) {\n  await page.goto('/login');\n  await page.getByLabel('Username').fill(username);\n  await page.getByRole('button', { name: 'Login' }).click();\n});`}
              style={{ width: '100%', minHeight: '120px', padding: '12px', border: '1px solid #d0d0d0', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px', background: '#1e1e2e', color: '#cdd6f4', marginBottom: '8px' }}
            />
            <button className="bdd-btn bdd-btn-success" onClick={handleAddStepLib}>Add to Library</button>
          </div>

          {stepLibEntries.length === 0 ? (
            <div className="bdd-empty">
              <h3>No Step Definitions in Library</h3>
              <p>Add reusable step definitions above. They will be automatically included in all BDD runs.</p>
            </div>
          ) : (
            <div className="bdd-feature-list">
              {stepLibEntries.map(entry => (
                <div key={entry.id} className="bdd-feature-card">
                  <div className="bdd-feature-card-header">
                    <div>
                      <span className="bdd-tag" style={{ background: '#f3e8ff', color: '#7c3aed' }}>{entry.keyword}</span>
                      <strong style={{ marginLeft: '8px' }}>{entry.pattern}</strong>
                    </div>
                    <span style={{ fontSize: '11px', color: '#999' }}>Used {entry.usageCount}x</span>
                  </div>
                  {entry.description && <p style={{ color: '#666', fontSize: '13px', margin: '4px 0' }}>{entry.description}</p>}
                  <pre style={{ background: '#f5f5f5', padding: '8px 12px', borderRadius: '4px', fontSize: '12px', overflow: 'auto', margin: '8px 0' }}>
                    {entry.code}
                  </pre>
                  <div className="bdd-feature-actions">
                    <button className="bdd-btn bdd-btn-sm bdd-btn-danger" onClick={() => handleDeleteStepLib(entry.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== Schedules Tab ===== */}
      {activeTab === 'schedules' && (
        <div>
          <div style={{ background: '#f5f7fa', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
            <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Schedule a BDD Run</h3>
            <div className="bdd-form-row">
              <select value={schedFeatureId} onChange={e => setSchedFeatureId(e.target.value)} style={{ flex: 2 }}>
                <option value="">Select Feature...</option>
                {features.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <input type="text" placeholder="Interval (e.g. every 1h, every 30m)" value={schedCron} onChange={e => setSchedCron(e.target.value)} style={{ flex: 1 }} />
              <input type="text" placeholder="Tags (optional, e.g. @smoke)" value={schedTags} onChange={e => setSchedTags(e.target.value)} style={{ flex: 1 }} />
              <button className="bdd-btn bdd-btn-success" onClick={handleAddSchedule}>Create Schedule</button>
            </div>
          </div>

          {schedules.length === 0 ? (
            <div className="bdd-empty">
              <h3>No Scheduled Runs</h3>
              <p>Create a schedule above to automatically run features on a recurring basis.</p>
            </div>
          ) : (
            <div className="bdd-feature-list">
              {schedules.map(sched => (
                <div key={sched.id} className="bdd-feature-card">
                  <div className="bdd-feature-card-header">
                    <div>
                      <strong>{sched.featureName}</strong>
                      <span style={{ marginLeft: '8px', fontSize: '12px', color: '#666' }}>{sched.cronExpression}</span>
                    </div>
                    <span className={`bdd-status ${sched.enabled ? 'active' : 'draft'}`}>
                      {sched.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="bdd-feature-meta">
                    {sched.tags && <span>Tags: {sched.tags}</span>}
                    <span>Browser: {sched.browser}</span>
                    {sched.lastRunAt && <span>Last run: {formatDate(sched.lastRunAt)}</span>}
                    {sched.nextRunAt && <span>Next run: {formatDate(sched.nextRunAt)}</span>}
                  </div>
                  <div className="bdd-feature-actions">
                    <button className="bdd-btn bdd-btn-sm bdd-btn-secondary" onClick={() => handleToggleSchedule(sched.id, sched.enabled)}>
                      {sched.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button className="bdd-btn bdd-btn-sm bdd-btn-danger" onClick={() => handleDeleteSchedule(sched.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== Screenplay Tab ===== */}
      {activeTab === 'screenplay' && (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <button className={`bdd-btn ${screenplaySubTab === 'tasks' ? 'bdd-btn-primary' : 'bdd-btn-secondary'}`}
              onClick={() => setScreenplaySubTab('tasks')}>Tasks ({spTasks.length})</button>
            <button className={`bdd-btn ${screenplaySubTab === 'actions' ? 'bdd-btn-primary' : 'bdd-btn-secondary'}`}
              onClick={() => setScreenplaySubTab('actions')}>Actions ({spActions.length})</button>
            <button className={`bdd-btn ${screenplaySubTab === 'questions' ? 'bdd-btn-primary' : 'bdd-btn-secondary'}`}
              onClick={() => setScreenplaySubTab('questions')}>Questions ({spQuestions.length})</button>
          </div>

          {/* Info Banner */}
          <div style={{ background: '#e8f0fe', padding: '14px 18px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px', color: '#1a237e', borderLeft: '4px solid #1a73e8' }}>
            <strong>Screenplay Pattern:</strong> Compose reusable <strong>Actions</strong> (clicks, fills, navigation) and <strong>Questions</strong> (assertions) into high-level <strong>Tasks</strong> (e.g., "Login as admin"). Tasks auto-generate Cucumber step definitions for your BDD features.
          </div>

          {/* ===== Actions Sub-Tab ===== */}
          {screenplaySubTab === 'actions' && (
            <div>
              {/* Presets */}
              {presetActions.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '14px', marginBottom: '10px', color: '#5f6368' }}>Preset Actions (click to use as template)</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {presetActions.map((preset, i) => (
                      <button key={i} className="bdd-btn bdd-btn-sm bdd-btn-secondary" onClick={() => handleUsePresetAction(preset)}
                        title={preset.description}>
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Create Action Form */}
              <div style={{ background: '#f5f7fa', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Create Action</h3>
                <div className="bdd-form-row">
                  <input type="text" placeholder="Action name (e.g. Navigate to login page)" value={newActionName}
                    onChange={e => setNewActionName(e.target.value)} style={{ flex: 2 }} />
                  <select value={newActionType} onChange={e => setNewActionType(e.target.value)} style={{ flex: '0 0 130px' }}>
                    <option value="navigation">Navigation</option>
                    <option value="interaction">Interaction</option>
                    <option value="input">Input</option>
                    <option value="wait">Wait</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <input type="text" placeholder="Description (optional)" value={newActionDesc}
                  onChange={e => setNewActionDesc(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '6px', fontSize: '13px', marginBottom: '8px' }} />
                <textarea value={newActionCode} onChange={e => setNewActionCode(e.target.value)}
                  placeholder={`await page.goto('https://example.com');\nawait page.getByLabel('Username').fill('admin');`}
                  style={{ width: '100%', minHeight: '100px', padding: '12px', border: '1px solid #d0d0d0', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px', background: '#1e1e2e', color: '#cdd6f4', marginBottom: '8px' }} />
                <button className="bdd-btn bdd-btn-success" onClick={handleCreateAction}>Create Action</button>
              </div>

              {/* Actions List */}
              {spActions.length === 0 ? (
                <div className="bdd-empty">
                  <h3>No Actions Yet</h3>
                  <p>Create reusable Playwright actions above, or use a preset template.</p>
                </div>
              ) : (
                <div className="bdd-feature-list">
                  {spActions.map(action => (
                    <div key={action.id} className="bdd-feature-card">
                      <div className="bdd-feature-card-header">
                        <div>
                          <span className="bdd-tag" style={{ background: '#e8f0fe', color: '#1a73e8' }}>{action.actionType}</span>
                          <strong style={{ marginLeft: '8px' }}>{action.name}</strong>
                        </div>
                        <span style={{ fontSize: '11px', color: '#999' }}>Used {action.usageCount}x</span>
                      </div>
                      {action.description && <p style={{ color: '#666', fontSize: '13px', margin: '4px 0' }}>{action.description}</p>}
                      <pre style={{ background: '#1e1e2e', color: '#cdd6f4', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', overflow: 'auto', margin: '8px 0' }}>
                        {action.code}
                      </pre>
                      <div className="bdd-feature-actions">
                        <button className="bdd-btn bdd-btn-sm bdd-btn-danger" onClick={() => handleDeleteAction(action.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ===== Questions Sub-Tab ===== */}
          {screenplaySubTab === 'questions' && (
            <div>
              {/* Presets */}
              {presetQuestions.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '14px', marginBottom: '10px', color: '#5f6368' }}>Preset Questions (click to use as template)</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {presetQuestions.map((preset, i) => (
                      <button key={i} className="bdd-btn bdd-btn-sm bdd-btn-secondary" onClick={() => handleUsePresetQuestion(preset)}
                        title={preset.description}>
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Create Question Form */}
              <div style={{ background: '#f5f7fa', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Create Question (Assertion)</h3>
                <div className="bdd-form-row">
                  <input type="text" placeholder="Question name (e.g. Dashboard is visible)" value={newQuestionName}
                    onChange={e => setNewQuestionName(e.target.value)} style={{ flex: 2 }} />
                  <select value={newQuestionType} onChange={e => setNewQuestionType(e.target.value)} style={{ flex: '0 0 130px' }}>
                    <option value="visibility">Visibility</option>
                    <option value="text">Text</option>
                    <option value="url">URL</option>
                    <option value="title">Title</option>
                    <option value="attribute">Attribute</option>
                    <option value="count">Count</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <input type="text" placeholder="Description (optional)" value={newQuestionDesc}
                  onChange={e => setNewQuestionDesc(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '6px', fontSize: '13px', marginBottom: '8px' }} />
                <textarea value={newQuestionCode} onChange={e => setNewQuestionCode(e.target.value)}
                  placeholder={`const { expect } = require('@playwright/test');\nawait expect(page.getByText('Welcome')).toBeVisible();`}
                  style={{ width: '100%', minHeight: '100px', padding: '12px', border: '1px solid #d0d0d0', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px', background: '#1e1e2e', color: '#cdd6f4', marginBottom: '8px' }} />
                <button className="bdd-btn bdd-btn-success" onClick={handleCreateQuestion}>Create Question</button>
              </div>

              {/* Questions List */}
              {spQuestions.length === 0 ? (
                <div className="bdd-empty">
                  <h3>No Questions Yet</h3>
                  <p>Create reusable assertions/verifications above, or use a preset template.</p>
                </div>
              ) : (
                <div className="bdd-feature-list">
                  {spQuestions.map(q => (
                    <div key={q.id} className="bdd-feature-card">
                      <div className="bdd-feature-card-header">
                        <div>
                          <span className="bdd-tag" style={{ background: '#ecfdf5', color: '#059669' }}>{q.questionType}</span>
                          <strong style={{ marginLeft: '8px' }}>{q.name}</strong>
                        </div>
                        <span style={{ fontSize: '11px', color: '#999' }}>Used {q.usageCount}x</span>
                      </div>
                      {q.description && <p style={{ color: '#666', fontSize: '13px', margin: '4px 0' }}>{q.description}</p>}
                      <pre style={{ background: '#1e1e2e', color: '#cdd6f4', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', overflow: 'auto', margin: '8px 0' }}>
                        {q.code}
                      </pre>
                      <div className="bdd-feature-actions">
                        <button className="bdd-btn bdd-btn-sm bdd-btn-danger" onClick={() => handleDeleteQuestion(q.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ===== Tasks Sub-Tab ===== */}
          {screenplaySubTab === 'tasks' && (
            <div>
              {/* Create Task Form */}
              <div style={{ background: '#f5f7fa', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Compose a Task</h3>
                <div className="bdd-form-row">
                  <input type="text" placeholder="Task name (e.g. Login as admin)" value={newTaskName}
                    onChange={e => setNewTaskName(e.target.value)} style={{ flex: 2 }} />
                  <select value={newTaskActor} onChange={e => setNewTaskActor(e.target.value)} style={{ flex: '0 0 130px' }}>
                    <option value="User">User</option>
                    <option value="Admin">Admin</option>
                    <option value="API Client">API Client</option>
                    <option value="Guest">Guest</option>
                  </select>
                </div>
                <input type="text" placeholder="Description (optional)" value={newTaskDesc}
                  onChange={e => setNewTaskDesc(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '6px', fontSize: '13px', marginBottom: '12px' }} />

                {/* Select Actions */}
                <div style={{ marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '13px', color: '#5f6368', marginBottom: '8px' }}>Select Actions (in order):</h4>
                  {spActions.length === 0 ? (
                    <p style={{ color: '#999', fontSize: '13px' }}>No actions available. Create some in the Actions tab first.</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {spActions.map(action => (
                        <button key={action.id}
                          className={`bdd-btn bdd-btn-sm ${selectedActionIds.includes(action.id) ? 'bdd-btn-primary' : 'bdd-btn-secondary'}`}
                          onClick={() => toggleActionSelection(action.id)}
                          title={action.description || action.code}>
                          {selectedActionIds.includes(action.id) && `${selectedActionIds.indexOf(action.id) + 1}. `}
                          {action.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Select Questions */}
                <div style={{ marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '13px', color: '#5f6368', marginBottom: '8px' }}>Select Questions (verifications):</h4>
                  {spQuestions.length === 0 ? (
                    <p style={{ color: '#999', fontSize: '13px' }}>No questions available. Create some in the Questions tab first.</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {spQuestions.map(q => (
                        <button key={q.id}
                          className={`bdd-btn bdd-btn-sm ${selectedQuestionIds.includes(q.id) ? 'bdd-btn-success' : 'bdd-btn-secondary'}`}
                          onClick={() => toggleQuestionSelection(q.id)}
                          title={q.description || q.code}>
                          {q.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button className="bdd-btn bdd-btn-success" onClick={handleCreateTask}
                  disabled={!newTaskName.trim()}>
                  Create Task
                </button>
              </div>

              {/* Tasks List */}
              {spTasks.length === 0 ? (
                <div className="bdd-empty">
                  <h3>No Tasks Yet</h3>
                  <p>Compose tasks from your actions and questions. Tasks auto-generate Cucumber step definitions that run in your BDD features.</p>
                </div>
              ) : (
                <div className="bdd-feature-list">
                  {spTasks.map(task => {
                    const taskActions = typeof task.actions === 'string' ? JSON.parse(task.actions) : (task.actions || []);
                    const taskQuestions = typeof task.questions === 'string' ? JSON.parse(task.questions) : (task.questions || []);
                    return (
                      <div key={task.id} className="bdd-feature-card">
                        <div className="bdd-feature-card-header">
                          <div>
                            <span className="bdd-tag" style={{ background: '#f3e8ff', color: '#7c3aed' }}>{task.actorType}</span>
                            <strong style={{ marginLeft: '8px' }}>{task.name}</strong>
                          </div>
                          <span style={{ fontSize: '11px', color: '#999' }}>Used {task.usageCount}x</span>
                        </div>
                        {task.description && <p style={{ color: '#666', fontSize: '13px', margin: '4px 0' }}>{task.description}</p>}

                        <div style={{ display: 'flex', gap: '16px', margin: '8px 0', fontSize: '12px', color: '#5f6368' }}>
                          <span>{taskActions.length} action(s)</span>
                          <span>{taskQuestions.length} question(s)</span>
                        </div>

                        {task.generatedCode && (
                          <pre style={{ background: '#1e1e2e', color: '#cdd6f4', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', overflow: 'auto', margin: '8px 0', maxHeight: '200px' }}>
                            {task.generatedCode}
                          </pre>
                        )}

                        {generatedTaskCode && (
                          <div style={{ margin: '8px 0' }}>
                            <h4 style={{ fontSize: '12px', color: '#5f6368', marginBottom: '4px' }}>Generated Step Definition:</h4>
                            <pre style={{ background: '#1e1e2e', color: '#a6e3a1', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', overflow: 'auto', maxHeight: '200px' }}>
                              {generatedTaskCode}
                            </pre>
                          </div>
                        )}

                        <div className="bdd-feature-actions">
                          <button className="bdd-btn bdd-btn-sm bdd-btn-primary" onClick={() => handleGenerateTaskCode(task.id)}>Generate Step Def</button>
                          <button className="bdd-btn bdd-btn-sm bdd-btn-danger" onClick={() => handleDeleteTask(task.id)}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* ===== Convert to Gherkin Tab ===== */}
      {activeTab === 'convert' && (
        <div>
          <h3 style={{ marginBottom: '6px' }}>Convert Test Cases to Gherkin</h3>
          <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
            Paste plain test cases, numbered steps, or structured test documentation — or upload a <strong>.txt</strong>, <strong>.csv</strong>, or <strong>.tsv</strong> file.
            The converter detects the format automatically and produces a Gherkin feature file.
          </p>

          <div className="bdd-editor-section">
            {/* Input panel */}
            <div className="bdd-editor-panel">
              <h3>Input <span style={{ fontSize: '11px', color: '#999' }}>paste or upload</span></h3>

              <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label
                  htmlFor="tc-file-upload"
                  style={{ cursor: 'pointer', padding: '6px 14px', border: '1px solid #1a73e8', color: '#1a73e8', borderRadius: '4px', fontSize: '13px', userSelect: 'none' }}
                >
                  {convertFile ? `📄 ${convertFile.name}` : 'Upload file (.txt / .csv / .tsv)'}
                </label>
                <input
                  id="tc-file-upload"
                  type="file"
                  accept=".txt,.csv,.tsv"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setConvertFile(f);
                    if (f) setConvertInput('');
                  }}
                />
                {convertFile && (
                  <button className="bdd-btn" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => setConvertFile(null)}>
                    Clear file
                  </button>
                )}
              </div>

              <textarea
                className="bdd-textarea"
                value={convertInput}
                onChange={e => { setConvertInput(e.target.value); setConvertFile(null); }}
                placeholder={`Paste your test cases here. Supported formats:\n\n• Plain numbered steps:\n  1. Navigate to login page\n  2. Enter username "admin"\n  3. Click Login button\n  4. Verify dashboard is shown\n\n• Structured:\n  Test Case: Login\n  Preconditions: User has an account\n  Steps: Open browser, Enter credentials\n  Expected Result: Dashboard is displayed\n\n• CSV (with header row):\n  Test Case,Steps,Expected Result`}
                spellCheck={false}
                disabled={!!convertFile}
              />

              <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
                <button
                  className="bdd-btn bdd-btn-primary"
                  onClick={handleConvert}
                  disabled={converting || (!convertInput.trim() && !convertFile)}
                >
                  {converting ? 'Converting...' : 'Convert to Gherkin'}
                </button>
                <button
                  className="bdd-btn"
                  onClick={() => { setConvertInput(''); setConvertFile(null); setConvertResult(''); setConvertWarnings([]); }}
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Output panel */}
            <div className="bdd-editor-panel">
              <h3>Generated Gherkin <span style={{ fontSize: '11px', color: '#999' }}>.feature</span></h3>

              {convertWarnings.length > 0 && (
                <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '6px', padding: '8px 12px', marginBottom: '10px', fontSize: '12px', color: '#795548' }}>
                  <strong>Warnings:</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {convertWarnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              <pre className="bdd-code-preview" style={{ minHeight: '300px' }}>
                {convertResult || '# Converted Gherkin will appear here\n# Feature: ...\n#   Scenario: ...\n#     Given ...\n#     When ...\n#     Then ...'}
              </pre>

              {convertResult && (
                <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="bdd-btn bdd-btn-success"
                    onClick={() => {
                      setFeatureContent(convertResult);
                      setActiveTab('editor');
                    }}
                  >
                    Use in Editor
                  </button>
                  <button
                    className="bdd-btn"
                    onClick={() => navigator.clipboard.writeText(convertResult).catch(() => {})}
                  >
                    Copy to clipboard
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BDDTesting;
