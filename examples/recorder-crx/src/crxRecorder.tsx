/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from 'react';
import { Toolbar } from '@web/components/toolbar';
import { ToolbarButton, ToolbarSeparator } from '@web/components/toolbarButton';
import { Dialog } from './dialog';
import { PreferencesForm } from './preferencesForm';
import type { CallLog, ElementInfo, Mode, Source } from '@recorder/recorderTypes';
import { Recorder } from '@recorder/recorder';
import type { CrxSettings } from './settings';
import { addSettingsChangedListener, defaultSettings, loadSettings, removeSettingsChangedListener } from './settings';
import ModalContainer, { create as createModal } from 'react-modal-promise';
import { SaveCodeForm } from './saveCodeForm';
import { TestExecutorUI } from './testExecutorUI';
import { apiService, type Project } from './apiService';
import './crxRecorder.css';
import './form.css';

function setElementPicked(elementInfo: ElementInfo, userGesture?: boolean) {
  window.playwrightElementPicked(elementInfo, userGesture);
}

function setRunningFileId(fileId: string) {
  window.playwrightSetRunningFile(fileId);
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function generateDatetimeSuffix() {
  return new Date().toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '-');
}

const codegenFilenames: Record<string, string> = {
  'javascript': 'example.js',
  'playwright-test': 'example.spec.ts',
  'java-junit': 'TestExample.java',
  'java': 'Example.java',
  'python-pytest': 'test_example.py',
  'python': 'example.py',
  'python-async': 'example.py',
  'csharp-mstest': 'Tests.cs',
  'csharp-nunit': 'Tests.cs',
  'csharp': 'Example.cs',
};

export const CrxRecorder: React.FC = ({
}) => {
  const [settings, setSettings] = React.useState<CrxSettings>(defaultSettings);
  const [sources, setSources] = React.useState<Source[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [log, setLog] = React.useState(new Map<string, CallLog>());
  const [mode, setMode] = React.useState<Mode>('none');
  const [selectedFileId, setSelectedFileId] = React.useState<string>(defaultSettings.targetLanguage);

  // Enhanced features state
  const [showTestExecutor, setShowTestExecutor] = React.useState(false);

  // Script replay state
  const [replayStatus, setReplayStatus] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [replayError, setReplayError] = React.useState('');

  // Save to database state
  const [showSaveModal, setShowSaveModal] = React.useState(false);
  const [scriptName, setScriptName] = React.useState('');
  const [scriptDescription, setScriptDescription] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  const [projectsLoading, setProjectsLoading] = React.useState(false);
  const [projectsError, setProjectsError] = React.useState('');

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = React.useState(true);
  const [showLoginForm, setShowLoginForm] = React.useState(false);
  const [loginEmail, setLoginEmail] = React.useState('');
  const [loginPassword, setLoginPassword] = React.useState('');
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);
  const [loginError, setLoginError] = React.useState('');
  const [userEmail, setUserEmail] = React.useState('');
  // Sign up state
  const [showRegisterForm, setShowRegisterForm] = React.useState(false);
  const [registerEmail, setRegisterEmail] = React.useState('');
  const [registerPassword, setRegisterPassword] = React.useState('');
  const [registerName, setRegisterName] = React.useState('');
  const [isRegistering, setIsRegistering] = React.useState(false);
  const [registerError, setRegisterError] = React.useState('');
  React.useEffect(() => {
    const checkAuthentication = async () => {
      try {
        // Load tokens from storage
        await apiService.loadTokens();

        // Try to get profile to verify token is valid
        const profile = await apiService.getProfile();
        setIsAuthenticated(true);
        setUserEmail(profile.email);
      } catch (error) {
        // Not authenticated
        setIsAuthenticated(false);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkAuthentication();
  }, []);

  React.useEffect(() => {
    const port = chrome.runtime.connect({ name: 'recorder' });
    const onMessage = (msg: any) => {
      if (!('type' in msg) || msg.type !== 'recorder')
        return;

      switch (msg.method) {
        case 'setPaused': setPaused(msg.paused); break;
        case 'setMode': setMode(msg.mode); break;
        case 'setSources': setSources(msg.sources); break;
        case 'resetCallLogs': setLog(new Map()); break;
        case 'updateCallLogs': setLog(log => {
          const newLog = new Map<string, CallLog>(log);
          for (const callLog of msg.callLogs) {
            callLog.reveal = !log.has(callLog.id);
            newLog.set(callLog.id, callLog);
          }
          return newLog;
        }); break;
        case 'setRunningFile': setRunningFileId(msg.file); break;
        case 'elementPicked': setElementPicked(msg.elementInfo, msg.userGesture); break;
      }
    };
    port.onMessage.addListener(onMessage);

    window.dispatch = async (data: any) => {
      port.postMessage({ type: 'recorderEvent', ...data });
      if (data.event === 'fileChanged')
        setSelectedFileId(data.params.file);
    };
    loadSettings().then(settings => {
      setSettings(settings);
      setSelectedFileId(settings.targetLanguage);
    }).catch(() => {});

    addSettingsChangedListener(setSettings);

    return () => {
      removeSettingsChangedListener(setSettings);
      port.disconnect();
    };
  }, []);

  const source = React.useMemo(() => sources.find(s => s.id === selectedFileId), [sources, selectedFileId]);

  const requestStorageState = React.useCallback(() => {
    if (!settings.experimental)
      return;

    chrome.runtime.sendMessage({ event: 'storageStateRequested' }).then(storageState => {
      const fileSuffix = generateDatetimeSuffix();
      download(`storageState-${fileSuffix}.json`, JSON.stringify(storageState, null, 2));
    });
  }, [settings]);

  const showPreferences = React.useCallback(() => {
    const modal = createModal(({ isOpen, onResolve }) =>
      <Dialog title='Preferences' isOpen={isOpen} onClose={onResolve}>
        <PreferencesForm />
      </Dialog>
    );
    modal().catch(() => {});
  }, []);

  const saveCode = React.useCallback(() => {
    if (!settings.experimental)
      return;

    const modal = createModal(({ isOpen, onResolve, onReject }) => {
      return <Dialog title='Save code' isOpen={isOpen} onClose={onReject}>
        <SaveCodeForm onSubmit={onResolve} suggestedFilename={codegenFilenames[selectedFileId]} />
      </Dialog>;
    });
    modal()
        .then(({ filename }) => {
          const code = source?.text;
          if (!code)
            return;

          download(filename, code);
        })
        .catch(() => {});
  }, [settings, source, selectedFileId]);

  const saveToDatabase = React.useCallback(async () => {
    if (!source?.text) {
      setSaveError('No code to save');
      return;
    }

    setShowSaveModal(true);
    setSaveError('');
    setSaveSuccess(false);
    setSelectedProjectId('');
  }, [source]);

  React.useEffect(() => {
    if (!showSaveModal) return;
    let cancelled = false;
    (async () => {
      try {
        setProjectsLoading(true);
        setProjectsError('');
        const list = await apiService.getProjects();
        if (!cancelled) setProjects(list);
      } catch (e: any) {
        if (!cancelled) setProjectsError(e?.message || 'Failed to load projects');
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showSaveModal]);

  const handleSaveToDatabase = React.useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!scriptName.trim()) {
      setSaveError('Script name is required');
      return;
    }

    if (!source?.text) {
      setSaveError('No code to save');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    try {
      await apiService.createScript(
        scriptName.trim(),
        source.text,
        selectedFileId,
        scriptDescription.trim() || undefined,
        selectedProjectId || undefined
      );

      setSaveSuccess(true);
      setTimeout(() => {
        setShowSaveModal(false);
        setScriptName('');
        setScriptDescription('');
        setSaveSuccess(false);
        setSelectedProjectId('');
      }, 1500);
    } catch (error: any) {
      setSaveError(error?.message || 'Failed to save script');
    } finally {
      setIsSaving(false);
    }
  }, [scriptName, scriptDescription, source, selectedFileId, selectedProjectId]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    try {
      const response = await apiService.login(loginEmail, loginPassword);
      setIsAuthenticated(true);
      setUserEmail(response.user.email);
      setShowLoginForm(false);
      setLoginEmail('');
      setLoginPassword('');
    } catch (error: any) {
      setLoginError(error?.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistering(true);
    setRegisterError('');

    try {
      const result = await apiService.register(registerEmail, registerPassword, registerName);
      setIsAuthenticated(true);
      setUserEmail(result.user.email);
      setShowRegisterForm(false);
      setRegisterEmail('');
      setRegisterPassword('');
      setRegisterName('');
    } catch (error: any) {
      setRegisterError(error?.message || 'Sign up failed. Please check your details.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiService.logout();
      setIsAuthenticated(false);
      setUserEmail('');
    } catch (error) {
      // Logout failed, clear tokens anyway
      apiService.clearTokens();
      setIsAuthenticated(false);
      setUserEmail('');
    }
  };

  const toggleTestExecutor = React.useCallback(() => {
    setShowTestExecutor(prev => !prev);
  }, []);

  const replayScript = React.useCallback(async () => {
    const code = source?.text;
    if (!code) {
      setReplayError('No script code to replay. Record some actions first.');
      setReplayStatus('error');
      return;
    }

    if (selectedFileId !== 'playwright-test') {
      setReplayError('Replay is only available for Playwright Test format. Switch language to "playwright-test".');
      setReplayStatus('error');
      return;
    }

    if (['recording', 'assertingText', 'assertingVisibility', 'assertingValue', 'assertingSnapshot'].includes(mode)) {
      setReplayError('Stop recording before replaying the script.');
      setReplayStatus('error');
      return;
    }

    setReplayStatus('running');
    setReplayError('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'replayScript',
        code,
      });

      if (response?.error) {
        setReplayStatus('error');
        setReplayError(response.error);
      } else {
        setReplayStatus('done');
        setTimeout(() => setReplayStatus('idle'), 3000);
      }
    } catch (error: any) {
      setReplayStatus('error');
      setReplayError(error?.message || 'Replay failed unexpectedly');
    }
  }, [source, selectedFileId, mode]);

  const stopReplay = React.useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'stopReplay' });
      setReplayStatus('idle');
      setReplayError('');
    } catch (error: any) {
      console.error('Failed to stop replay:', error);
    }
  }, []);

  React.useEffect(() => {
    if (!settings.experimental)
      return;

    const keydownHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveCode();
      }
    };
    window.addEventListener('keydown', keydownHandler);

    return () => {
      window.removeEventListener('keydown', keydownHandler);
    };
  }, [selectedFileId, settings, saveCode]);

  const dispatchEditedCode = React.useCallback((code: string) => {
    window.dispatch({ event: 'codeChanged', params: { code } });
  }, []);

  const dispatchCursorActivity = React.useCallback((position: { line: number }) => {
    window.dispatch({ event: 'cursorActivity', params: { position } });
  }, []);

  // Show loading state while checking authentication
  if (isCheckingAuth) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-content">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show login or signup form if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div className="auth-header">
            <h2>Playwright CRX</h2>
            <p>{showRegisterForm ? 'Create an account to continue' : 'Please login to continue'}</p>
          </div>

          {showRegisterForm ? (
            <form onSubmit={handleRegister} className="auth-form">
              {registerError && (
                <div className="auth-error">
                  {registerError}
                </div>
              )}

              <div className="auth-field">
                <label>Name</label>
                <input
                  type="text"
                  value={registerName}
                  onChange={e => setRegisterName(e.target.value)}
                  placeholder="Your name"
                  required
                  disabled={isRegistering}
                />
              </div>

              <div className="auth-field">
                <label>Email</label>
                <input
                  type="email"
                  value={registerEmail}
                  onChange={e => setRegisterEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={isRegistering}
                />
              </div>

              <div className="auth-field">
                <label>Password</label>
                <input
                  type="password"
                  value={registerPassword}
                  onChange={e => setRegisterPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  disabled={isRegistering}
                />
              </div>

              <button type="submit" className="auth-button" disabled={isRegistering}>
                {isRegistering ? 'Signing up...' : 'Sign Up'}
              </button>

              <div className="auth-hint">
                <a href="#" onClick={(e) => { e.preventDefault(); setShowRegisterForm(false); }}>Already have an account? Log in</a>
              </div>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="auth-form">
              {loginError && (
                <div className="auth-error">
                  {loginError}
                </div>
              )}

              <div className="auth-field">
                <label>Email</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="demo@example.com"
                  required
                  disabled={isLoggingIn}
                />
              </div>

              <div className="auth-field">
                <label>Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  disabled={isLoggingIn}
                />
              </div>

              <button type="submit" className="auth-button" disabled={isLoggingIn}>
                {isLoggingIn ? 'Logging in...' : 'Login'}
              </button>

              <div className="auth-hint">
                <p>Demo credentials:</p>
                <p className="auth-demo">demo@example.com / demo123</p>
                <a href="#" onClick={(e) => { e.preventDefault(); setShowRegisterForm(true); }}>Create account</a>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }
  return (<>
    <ModalContainer />

    {/* Save to Database Modal */}
    {showSaveModal && (
      <div className="auth-container" style={{ zIndex: 9999 }}>
        <div className="auth-box" style={{ maxWidth: '500px' }}>
          <div className="auth-header">
            <h2>Save Script to Database</h2>
            <button
              onClick={() => setShowSaveModal(false)}
              style={{ position: 'absolute', right: '20px', top: '20px', background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSaveToDatabase} className="auth-form">
            {saveError && (
              <div className="auth-error">
                {saveError}
              </div>
            )}

            {saveSuccess && (
              <div className="auth-success" style={{ background: '#d4edda', color: '#155724', padding: '12px', borderRadius: '4px', marginBottom: '15px' }}>
                ✓ Script saved successfully!
              </div>
            )}

            <div className="auth-field">
              <label>Script Name *</label>
              <input
                type="text"
                value={scriptName}
                onChange={e => setScriptName(e.target.value)}
                placeholder="My Test Script"
                required
                disabled={isSaving || saveSuccess}
              />
            </div>

            <div className="auth-field">
              <label>Description (optional)</label>
              <textarea
                value={scriptDescription}
                onChange={e => setScriptDescription(e.target.value)}
                placeholder="Describe what this script does..."
                rows={3}
                disabled={isSaving || saveSuccess}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </div>

            <div className="auth-field">
              <label>Project</label>
              {projectsError && (
                <div className="auth-error" style={{ marginBottom: '8px' }}>
                  {projectsError}
                </div>
              )}
              <select
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
                disabled={isSaving || saveSuccess || projectsLoading}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', background: projectsLoading ? '#f0f0f0' : undefined }}
              >
                <option value="">No project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {projectsLoading && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: '#6c757d' }}>Loading projects…</div>
              )}
            </div>

            <div className="auth-field">
              <label>Language</label>
              <input
                type="text"
                value={selectedFileId}
                disabled
                style={{ background: '#f0f0f0' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="submit"
                className="auth-button"
                disabled={isSaving || saveSuccess}
                style={{ flex: 1 }}
              >
                {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save to Database'}
              </button>
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                disabled={isSaving}
                style={{ flex: 1, background: '#6c757d' }}
                className="auth-button"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

    <div className='recorder'>
      {/* Authentication status and logout */}
      {isAuthenticated && (
        <div className="auth-status">
          <div className="authenticated">
            <span className="status-indicator">Signed in as {userEmail || 'current user'}</span>
            <button className="logout-btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      )}
      <Recorder sources={sources} paused={paused} log={log} mode={mode} onEditedCode={dispatchEditedCode} onCursorActivity={dispatchCursorActivity} />
      <div className='replay-toolbar'>
        {replayStatus === 'running' ? (
          <button className='replay-btn replay-btn-stop' title='Stop Replay' onClick={stopReplay}>
            <span className='codicon codicon-debug-stop'></span> Stop
          </button>
        ) : (
          <button className='replay-btn replay-btn-play' title='Replay script in browser' onClick={replayScript}>
            <span className='codicon codicon-run'></span> {replayStatus === 'done' ? 'Done' : replayStatus === 'error' ? 'Retry' : 'Replay'}
          </button>
        )}
        {settings.experimental && <>
          <button className='replay-btn' title='Save to File' onClick={saveCode}>
            <span className='codicon codicon-save'></span> Save File
          </button>
          <button className='replay-btn' title='Save to Database' onClick={saveToDatabase}>
            <span className='codicon codicon-cloud-upload'></span> Save DB
          </button>
          <button className='replay-btn' title='Test Executor' onClick={toggleTestExecutor}>
            <span className='codicon codicon-debug-console'></span> Execute
          </button>
        </>}
        <div style={{ flex: 'auto' }}></div>
        <button className='replay-btn' title='Preferences' onClick={showPreferences}>
          <span className='codicon codicon-settings-gear'></span>
        </button>
        {settings.experimental && <>
          <div className='dropdown'>
            <button className='replay-btn' title='Tools' onClick={() => {}}>
              <span className='codicon codicon-tools'></span>
            </button>
            <div className='dropdown-content right-align'>
              <a href='#' onClick={requestStorageState}>Download storage state</a>
            </div>
          </div>
        </>}
      </div>
      {replayStatus === 'error' && replayError && (
        <div className='replay-status replay-error'>
          Replay error: {replayError}
        </div>
      )}
      {replayStatus === 'running' && (
        <div className='replay-status replay-running'>
          Replaying script in browser...
        </div>
      )}
      {replayStatus === 'done' && (
        <div className='replay-status replay-done'>
          Replay completed successfully
        </div>
      )}

      {/* Enhanced Features Panels */}
      {showTestExecutor && (
        <div style={{ position: 'absolute', top: 0, right: 0, width: '450px', height: '100%', background: 'var(--vscode-sideBar-background)', borderLeft: '1px solid var(--vscode-panel-border)', zIndex: 1000, overflow: 'auto' }}>
          <TestExecutorUI onClose={toggleTestExecutor} script={source?.text || ''} scriptName={selectedFileId} />
        </div>
      )}
    </div>
  </>);
};
