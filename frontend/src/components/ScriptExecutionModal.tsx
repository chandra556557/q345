import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './ScriptExecutionModal.css';

const API_URL = 'http://localhost:3002/api';

interface Script {
  id: string;
  name: string;
  language: string;
  description?: string;
}

interface Environment {
  id: string;
  name: string;
  type: string;
  displayName?: string;
}

interface Props {
  script: Script;
  onClose: () => void;
  onExecuteSuccess?: () => void;
}

const ScriptExecutionModal: React.FC<Props> = ({ script, onClose, onExecuteSuccess }) => {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<string>('development');
  const [selectedBrowser, setSelectedBrowser] = useState<string>('chromium');
  const [loading, setLoading] = useState(false);
  const [loadingEnvs, setLoadingEnvs] = useState(true);
  const [executing, setExecuting] = useState(false);

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  // Get current organization from localStorage
  const getCurrentOrg = () => {
    const orgsStr = localStorage.getItem('organizations');
    if (orgsStr) {
      const orgs = JSON.parse(orgsStr);
      return orgs[0]?.slug || null; // Use first org as default
    }
    return null;
  };

  useEffect(() => {
    loadEnvironments();
  }, []);

  const loadEnvironments = async () => {
    setLoadingEnvs(true);
    try {
      const orgSlug = getCurrentOrg();
      
      if (orgSlug) {
        // Load from organization environments
        const res = await axios.get(
          `${API_URL}/organizations/${orgSlug}/environments`,
          { headers: { ...headers, 'X-Organization': orgSlug } }
        );
        setEnvironments(res.data.environments || res.data.data || []);
      } else {
        // Fallback to default environments
        setEnvironments([
          { id: 'dev', name: 'development', type: 'development', displayName: 'Development' },
          { id: 'staging', name: 'staging', type: 'staging', displayName: 'Staging' },
          { id: 'prod', name: 'production', type: 'production', displayName: 'Production' }
        ]);
      }
    } catch (error) {
      console.error('Error loading environments:', error);
      // Fallback to defaults on error
      setEnvironments([
        { id: 'dev', name: 'development', type: 'development', displayName: 'Development' },
        { id: 'staging', name: 'staging', type: 'staging', displayName: 'Staging' },
        { id: 'prod', name: 'production', type: 'production', displayName: 'Production' }
      ]);
    } finally {
      setLoadingEnvs(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setLoading(true);

    try {
      const response = await axios.post(
        `${API_URL}/scripts/${script.id}/execute`,
        {
          environment: selectedEnv,
          browser: selectedBrowser
        },
        { headers }
      );

      console.log('Test execution started:', response.data);
      
      alert(`✅ Test execution started!

Test Run ID: ${response.data.data.testRunId}
Environment: ${selectedEnv}
Browser: ${selectedBrowser}

Check the "Test Runs" tab to monitor progress.`);
      
      if (onExecuteSuccess) {
        onExecuteSuccess();
      }
      
      onClose();
    } catch (error: any) {
      console.error('Error executing script:', error);
      alert(`❌ Failed to execute script:\n${error.response?.data?.error || error.message}`);
    } finally {
      setExecuting(false);
      setLoading(false);
    }
  };

  const getEnvIcon = (type: string) => {
    switch (type) {
      case 'development': return '💻';
      case 'staging': return '🔧';
      case 'production': return '🚀';
      default: return '🌍';
    }
  };

  const getBrowserIcon = (browser: string) => {
    switch (browser) {
      case 'chromium': return '🌐';
      case 'firefox': return '🦊';
      case 'webkit': return '🧭';
      default: return '🌐';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="execution-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🚀 Execute Test Script</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Script Info */}
          <div className="script-info">
            <h3>📝 Script Details</h3>
            <div className="info-row">
              <span className="label">Name:</span>
              <span className="value">{script.name}</span>
            </div>
            <div className="info-row">
              <span className="label">Language:</span>
              <span className="value language-badge">{script.language}</span>
            </div>
            {script.description && (
              <div className="info-row">
                <span className="label">Description:</span>
                <span className="value">{script.description}</span>
              </div>
            )}
          </div>

          {/* Environment Selection */}
          <div className="config-section">
            <h3>🌍 Environment</h3>
            <p className="section-desc">Select the environment where the test will run</p>
            
            {loadingEnvs ? (
              <div className="loading-envs">Loading environments...</div>
            ) : (
              <div className="env-options">
                {environments.map(env => (
                  <button
                    key={env.id}
                    className={`env-option ${selectedEnv === env.name ? 'selected' : ''}`}
                    onClick={() => setSelectedEnv(env.name)}
                  >
                    <div className="env-icon">{getEnvIcon(env.type)}</div>
                    <div className="env-details">
                      <div className="env-name">{env.displayName || env.name}</div>
                      <div className="env-type">{env.type}</div>
                    </div>
                    {selectedEnv === env.name && <div className="check-icon">✓</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Browser Selection */}
          <div className="config-section">
            <h3>🌐 Browser</h3>
            <p className="section-desc">Choose the browser for test execution</p>
            
            <div className="browser-options">
              <button
                className={`browser-option ${selectedBrowser === 'chromium' ? 'selected' : ''}`}
                onClick={() => setSelectedBrowser('chromium')}
              >
                <div className="browser-icon">{getBrowserIcon('chromium')}</div>
                <div className="browser-name">Chromium</div>
                {selectedBrowser === 'chromium' && <div className="check-icon">✓</div>}
              </button>
              
              <button
                className={`browser-option ${selectedBrowser === 'firefox' ? 'selected' : ''}`}
                onClick={() => setSelectedBrowser('firefox')}
              >
                <div className="browser-icon">{getBrowserIcon('firefox')}</div>
                <div className="browser-name">Firefox</div>
                {selectedBrowser === 'firefox' && <div className="check-icon">✓</div>}
              </button>
              
              <button
                className={`browser-option ${selectedBrowser === 'webkit' ? 'selected' : ''}`}
                onClick={() => setSelectedBrowser('webkit')}
              >
                <div className="browser-icon">{getBrowserIcon('webkit')}</div>
                <div className="browser-name">WebKit</div>
                {selectedBrowser === 'webkit' && <div className="check-icon">✓</div>}
              </button>
            </div>
          </div>

          {/* Execution Summary */}
          <div className="execution-summary">
            <h4>📋 Execution Summary</h4>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="summary-label">Script:</span>
                <span className="summary-value">{script.name}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Environment:</span>
                <span className="summary-value">{selectedEnv}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Browser:</span>
                <span className="summary-value">{selectedBrowser}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button 
            className="btn-secondary" 
            onClick={onClose}
            disabled={executing}
          >
            Cancel
          </button>
          <button 
            className="btn-primary btn-execute" 
            onClick={handleExecute}
            disabled={loading || executing}
          >
            {executing ? '⏳ Executing...' : '🚀 Execute Test'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScriptExecutionModal;
