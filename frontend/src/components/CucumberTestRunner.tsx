import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './CucumberTestRunner.css';

const API_URL = 'http://localhost:3001/api';

interface TestScenario {
  name: string;
  tags: string[];
  status: 'passed' | 'failed' | 'pending' | 'running';
  duration?: number;
  errorMessage?: string;
}

interface FeatureResult {
  name: string;
  filePath: string;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  scenarios: TestScenario[];
}

interface TestRunResult {
  id: string;
  status: 'running' | 'completed' | 'failed';
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  skippedScenarios: number;
  totalDuration: number;
  features: FeatureResult[];
  startedAt: string;
  completedAt?: string;
}

interface Props {
  token: string | null;
}

type TestFilter = 'all' | 'smoke' | 'api' | 'forms' | 'database' | 'saucedemo';

const CucumberTestRunner: React.FC<Props> = ({ token }) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const [testRuns, setTestRuns] = useState<TestRunResult[]>([]);
  const [selectedRun, setSelectedRun] = useState<TestRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testFilter, setTestFilter] = useState<TestFilter>('all');
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());

  // Load test results from backend
  const loadTestRuns = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/bdd/runs`, { headers });
      setTestRuns(res.data.data || []);
    } catch (err) {
      console.error('Error loading test runs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Run tests using Cucumber CLI via backend
  const runTests = async (filter: TestFilter) => {
    setIsRunning(true);
    try {
      // Call backend endpoint to run Cucumber tests with filter
      const res = await axios.post(`${API_URL}/bdd/run-cucumber`, {
        filter,
        tags: getTagsForFilter(filter)
      }, { headers });

      const newRun = res.data.data;
      setTestRuns([newRun, ...testRuns]);
      setSelectedRun(newRun);

      // Poll for updates if running
      if (newRun.status === 'running') {
        pollTestProgress(newRun.id);
      }
    } catch (err) {
      console.error('Error running tests:', err);
      // If custom endpoint doesn't exist, try standard feature run
      tryAlternativeTestRun(filter);
    } finally {
      setIsRunning(false);
    }
  };

  // Get tags for filter
  const getTagsForFilter = (filter: TestFilter): string => {
    switch(filter) {
      case 'smoke': return '@smoke';
      case 'api': return '@api';
      case 'forms': return '@forms';
      case 'database': return '@database';
      case 'saucedemo': return '@saucedemo';
      default: return '';
    }
  };

  // Alternative: Run all features in sequence if custom endpoint doesn't exist
  const tryAlternativeTestRun = async (filter: TestFilter) => {
    // This would call the existing runFeature endpoint for each feature file
    console.log('Using alternative test run method for filter:', filter);
  };

  // Poll for test progress
  const pollTestProgress = async (runId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_URL}/bdd/runs/${runId}`, { headers });
        const updatedRun = res.data.data;

        setTestRuns(prev =>
          prev.map(run => run.id === runId ? updatedRun : run)
        );
        setSelectedRun(updatedRun);

        if (updatedRun.status !== 'running' && updatedRun.status !== 'pending') {
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Error polling test progress:', err);
      }
    }, 2000); // Poll every 2 seconds
  };

  useEffect(() => {
    loadTestRuns();
  }, []);

  const toggleFeature = (featureName: string) => {
    const newExpanded = new Set(expandedFeatures);
    if (newExpanded.has(featureName)) {
      newExpanded.delete(featureName);
    } else {
      newExpanded.add(featureName);
    }
    setExpandedFeatures(newExpanded);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'passed': return '#28a745';
      case 'failed': return '#dc3545';
      case 'running': return '#ffc107';
      case 'pending': return '#6c757d';
      default: return '#999';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'running': return '⏳';
      case 'pending': return '⏭️';
      default: return '❓';
    }
  };

  return (
    <div className="cucumber-test-runner">
      <div className="test-runner-header">
        <h2>🧪 Cucumber BDD Test Runner</h2>
        <p>Run and monitor your 136 BDD test scenarios</p>
      </div>

      {/* Test Controls */}
      <div className="test-controls">
        <div className="filter-buttons">
          <h3>Run Tests:</h3>
          <button
            onClick={() => runTests('all')}
            disabled={isRunning}
            className="btn btn-primary"
          >
            {isRunning ? '⏳ Running...' : '▶️ Run All Tests'}
          </button>
          <button
            onClick={() => runTests('smoke')}
            disabled={isRunning}
            className="btn btn-info"
          >
            {isRunning ? '⏳ Running...' : '🔥 Smoke Tests'}
          </button>
          <button
            onClick={() => runTests('api')}
            disabled={isRunning}
            className="btn btn-info"
          >
            {isRunning ? '⏳ Running...' : '🔌 API Tests'}
          </button>
          <button
            onClick={() => runTests('forms')}
            disabled={isRunning}
            className="btn btn-info"
          >
            {isRunning ? '⏳ Running...' : '📝 Form Tests'}
          </button>
          <button
            onClick={() => runTests('database')}
            disabled={isRunning}
            className="btn btn-info"
          >
            {isRunning ? '⏳ Running...' : '🗄️ Database Tests'}
          </button>
          <button
            onClick={() => runTests('saucedemo')}
            disabled={isRunning}
            className="btn btn-danger"
          >
            {isRunning ? '⏳ Running...' : '🌐 SauceDemo (Real Browser)'}
          </button>
          <button
            onClick={loadTestRuns}
            disabled={isRunning || loading}
            className="btn btn-secondary"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Test Results Summary */}
      {selectedRun && (
        <div className="test-summary">
          <div className="summary-header">
            <h3>Test Run - {selectedRun.startedAt}</h3>
            <span className={`status-badge ${selectedRun.status}`}>
              {selectedRun.status === 'running' ? '⏳ Running' :
               selectedRun.status === 'completed' ? '✅ Completed' :
               '❌ Failed'}
            </span>
          </div>

          <div className="summary-stats">
            <div className="stat-card">
              <h4>Total Scenarios</h4>
              <p className="stat-value">{selectedRun.totalScenarios}</p>
            </div>
            <div className="stat-card passed">
              <h4>Passed</h4>
              <p className="stat-value">{selectedRun.passedScenarios}</p>
            </div>
            <div className="stat-card failed">
              <h4>Failed</h4>
              <p className="stat-value">{selectedRun.failedScenarios}</p>
            </div>
            <div className="stat-card skipped">
              <h4>Skipped</h4>
              <p className="stat-value">{selectedRun.skippedScenarios}</p>
            </div>
            <div className="stat-card">
              <h4>Duration</h4>
              <p className="stat-value">{(selectedRun.totalDuration / 1000).toFixed(2)}s</p>
            </div>
          </div>

          {/* Success Rate Bar */}
          {selectedRun.totalScenarios > 0 && (
            <div className="success-bar">
              <div className="bar-label">Success Rate: {Math.round((selectedRun.passedScenarios / selectedRun.totalScenarios) * 100)}%</div>
              <div className="bar-container">
                <div
                  className="bar-passed"
                  style={{ width: `${(selectedRun.passedScenarios / selectedRun.totalScenarios) * 100}%` }}
                ></div>
                <div
                  className="bar-failed"
                  style={{ width: `${(selectedRun.failedScenarios / selectedRun.totalScenarios) * 100}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Features & Scenarios */}
      {selectedRun && selectedRun.features && (
        <div className="test-features">
          <h3>Features & Scenarios</h3>
          {selectedRun.features.map((feature) => (
            <div key={feature.filePath} className="feature-card">
              <div
                className="feature-header"
                onClick={() => toggleFeature(feature.filePath)}
              >
                <span className="feature-toggle">
                  {expandedFeatures.has(feature.filePath) ? '▼' : '▶'}
                </span>
                <h4>{feature.name}</h4>
                <div className="feature-stats">
                  <span className="stat-passed">✅ {feature.passedScenarios}</span>
                  <span className="stat-failed">❌ {feature.failedScenarios}</span>
                  <span className="stat-total">📊 {feature.totalScenarios}</span>
                </div>
              </div>

              {expandedFeatures.has(feature.filePath) && (
                <div className="scenarios-list">
                  {feature.scenarios.map((scenario, idx) => (
                    <div key={idx} className={`scenario-item ${scenario.status}`}>
                      <span className="scenario-status">
                        {getStatusIcon(scenario.status)}
                      </span>
                      <span className="scenario-name">{scenario.name}</span>
                      {scenario.duration && (
                        <span className="scenario-duration">
                          {(scenario.duration / 1000).toFixed(2)}s
                        </span>
                      )}
                      {scenario.errorMessage && (
                        <div className="scenario-error">
                          ⚠️ {scenario.errorMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Test Runs History */}
      {testRuns.length > 0 && (
        <div className="test-history">
          <h3>Recent Test Runs</h3>
          <div className="runs-list">
            {testRuns.slice(0, 5).map((run) => (
              <div
                key={run.id}
                className={`run-item ${run.status}`}
                onClick={() => setSelectedRun(run)}
              >
                <div className="run-time">{run.startedAt}</div>
                <div className="run-stats">
                  ✅ {run.passedScenarios} | ❌ {run.failedScenarios} | 📊 {run.totalScenarios}
                </div>
                <div className="run-status">
                  {run.status === 'completed' ? '✅ Completed' :
                   run.status === 'running' ? '⏳ Running' :
                   '❌ Failed'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <div className="loading">Loading test results...</div>}
    </div>
  );
};

export default CucumberTestRunner;
