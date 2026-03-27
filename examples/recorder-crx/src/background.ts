/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Mode } from '@recorder/recorderTypes';
import type { CrxApplication } from 'playwright-crx';
import playwright, { crx, _debug, _setUnderTest, _isUnderTest as isUnderTest } from 'playwright-crx';
import type { CrxSettings } from './settings';
import { addSettingsChangedListener, defaultSettings, loadSettings } from './settings';
import { apiTestingService } from './apiTestingService';
import type { ApiRequest, ApiResponse } from './apiTestingService';

type CrxMode = Mode | 'detached';

const stoppedModes: CrxMode[] = ['none', 'standby', 'detached'];
const recordingModes: CrxMode[] = ['recording', 'assertingText', 'assertingVisibility', 'assertingValue', 'assertingSnapshot'];

// we must lazy initialize it
let crxAppPromise: Promise<CrxApplication> | undefined;

const attachedTabIds = new Set<number>();
let currentMode: CrxMode | 'detached' | undefined;
let settings: CrxSettings = defaultSettings;

// if it's in sidepanel mode, we need to open it synchronously on action click,
// so we need to fetch its value asap
const settingsInitializing = loadSettings().then(s => settings = s).catch(() => {});

addSettingsChangedListener(newSettings => {
  settings = newSettings;
  setTestIdAttributeName(newSettings.testIdAttributeName);
});

let allowsIncognitoAccess = false;
chrome.extension.isAllowedIncognitoAccess().then(allowed => {
  allowsIncognitoAccess = allowed;
});

// API Recording state
let isApiRecording = false;
let recordingTabId: number | null = null;
const pendingRequests = new Map<string, any>();
const networkListeners = new Map<number, (details: chrome.webRequest.WebRequestBodyDetails) => void>();

async function changeAction(tabId: number, mode?: CrxMode | 'detached') {
  if (!mode)
    mode = attachedTabIds.has(tabId) ? currentMode : 'detached';
  else if (mode !== 'detached')
    currentMode = mode;


  // detached basically implies recorder windows was closed
  if (!mode || stoppedModes.includes(mode)) {
    await Promise.all([
      chrome.action.setTitle({ title: mode === 'none' ? 'Stopped' : 'Record', tabId }),
      chrome.action.setBadgeText({ text: '', tabId }),
    ]).catch(() => {});
    return;
  }

  const { text, title, color, bgColor } = recordingModes.includes(mode) ?
    { text: 'REC', title: 'Recording', color: 'white', bgColor: 'darkred' } :
    { text: 'INS', title: 'Inspecting', color: 'white', bgColor: 'dodgerblue' };

  await Promise.all([
    chrome.action.setTitle({ title, tabId }),
    chrome.action.setBadgeText({ text, tabId }),
    chrome.action.setBadgeTextColor({ color, tabId }),
    chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId }),
  ]).catch(() => {});
}

// action state per tab is reset every time a navigation occurs
// https://bugs.chromium.org/p/chromium/issues/detail?id=1450904
chrome.tabs.onUpdated.addListener(tabId => changeAction(tabId));

async function getCrxApp(incognito: boolean) {
  if (!crxAppPromise) {
    await settingsInitializing;

    crxAppPromise = crx.start({ incognito }).then(crxApp => {
      crxApp.recorder.addListener('hide', async () => {
        await crxApp.close();
        crxAppPromise = undefined;
      });
      crxApp.recorder.addListener('modechanged', async ({ mode }) => {
        await Promise.all([...attachedTabIds].map(tabId => changeAction(tabId, mode)));
      });
      crxApp.addListener('attached', async ({ tabId }) => {
        attachedTabIds.add(tabId);
        await changeAction(tabId, crxApp.recorder.mode());
      });
      crxApp.addListener('detached', async tabId => {
        attachedTabIds.delete(tabId);
        await changeAction(tabId, 'detached');
      });
      setTestIdAttributeName(settings.testIdAttributeName);
      return crxApp;
    });
  }
  return await crxAppPromise;
}

async function attach(tab: chrome.tabs.Tab, mode?: Mode) {
  if (!tab?.id || (attachedTabIds.has(tab.id) && !mode))
    return;

  // if the tab is incognito, chek if can be started in incognito mode.
  if (tab.incognito && !allowsIncognitoAccess)
    throw new Error('Not authorized to launch in Incognito mode.');

  const sidepanel = !isUnderTest() && settings.sidepanel;

  // we need to open sidepanel before any async call
  if (sidepanel)
    await chrome.sidePanel.open({ windowId: tab.windowId });

  // ensure one attachment at a time
  chrome.action.disable();
  if (tab.url?.startsWith('chrome://')) {
    const windowId = tab.windowId;
    tab = await new Promise(resolve => {
      // we will not be able to attach to this tab, so we need to open a new one
      chrome.tabs.create({ windowId, url: 'about:blank' }).
          then(tab => {
            resolve(tab);
          }).
          catch(() => {});
    });
  }

  const crxApp = await getCrxApp(tab.incognito);

  try {

    if (crxApp.recorder.isHidden()) {
      await crxApp.recorder.show({
        mode: mode ?? 'recording',
        language: settings.targetLanguage,
        window: { type: sidepanel ? 'sidepanel' : 'popup', url: 'index.html' },
        playInIncognito: settings.playInIncognito,
      });
    }

    await crxApp.attach(tab.id!);

    if (mode)
      await crxApp.recorder.setMode(mode);
  } finally {
    chrome.action.enable();
  }
}

async function setTestIdAttributeName(testIdAttributeName: string) {
  playwright.selectors.setTestIdAttribute(testIdAttributeName);
}

chrome.action.onClicked.addListener(attach);

chrome.contextMenus.create({
  id: 'pw-recorder',
  title: 'Attach to Playwright Recorder',
  contexts: ['all'],
});

chrome.contextMenus.onClicked.addListener(async (_, tab) => {
  if (tab)
    await attach(tab);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab.id)
    return;
  if (command === 'inspect')
    await attach(tab, 'inspecting');
  else if (command === 'record')
    await attach(tab, 'recording');
});

async function getStorageState() {
  const crxApp = await crxAppPromise;
  if (!crxApp)
    return;

  return await crxApp.context().storageState();
}

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.event === 'storageStateRequested') {
    getStorageState().then(sendResponse).catch(() => {});
    return true;
  }

  // Handle API recording messages
  if (message.type === 'startApiRecording') {
    startApiRecording()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'stopApiRecording') {
    stopApiRecording();
    sendResponse({ success: true });
    return true;
  }

  // Handle script replay messages
  if (message.type === 'replayScript') {
    (async () => {
      try {
        const { code } = message;
        if (!code) {
          sendResponse({ error: 'No code provided' });
          return;
        }

        if (!crxAppPromise) {
          sendResponse({ error: 'Recorder is not active. Please start the recorder first.' });
          return;
        }

        const crxApp = await crxAppPromise;
        await crxApp.recorder.run(code);
        sendResponse({ status: 'completed' });
      } catch (error: any) {
        sendResponse({ error: error?.message || 'Replay failed' });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (message.type === 'stopReplay') {
    (async () => {
      try {
        if (!crxAppPromise) {
          sendResponse({ error: 'Recorder is not active' });
          return;
        }
        const crxApp = await crxAppPromise;
        await crxApp.recorder.stop();
        sendResponse({ status: 'stopped' });
      } catch (error: any) {
        sendResponse({ error: error?.message || 'Failed to stop replay' });
      }
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(details => {
  if ((globalThis as any).__crxTest)
    return;
  if ([chrome.runtime.OnInstalledReason.INSTALL, chrome.runtime.OnInstalledReason.UPDATE].includes(details.reason))
    chrome.tabs.create({ url: `https://github.com/ruifigueira/playwright-crx/releases/tag/v${chrome.runtime.getManifest().version}` }).catch(() => {});
});


/**
 * Start recording API requests using debugger API for full capture
 */
async function startApiRecording() {
  if (isApiRecording) return;
  
  // Get Playwright-attached tab (not just active tab)
  // If no attached tabs, fall back to active tab
  let targetTabId: number | undefined;
  
  if (attachedTabIds.size > 0) {
    // Use the first attached tab (Playwright recorder is connected here)
    targetTabId = Array.from(attachedTabIds)[0];
    console.log('Using Playwright-attached tab for API recording:', targetTabId);
  } else {
    // Fallback: use active tab if no Playwright connection
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTabId = activeTab?.id;
    console.log('Using active tab for API recording:', targetTabId);
  }
  
  if (!targetTabId) {
    console.error('No valid tab found for API recording');
    throw new Error('No valid tab found for API recording');
  }
  
  recordingTabId = targetTabId;
  isApiRecording = true;

  try {
    // Try to attach debugger
    await chrome.debugger.attach({ tabId: recordingTabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId: recordingTabId }, 'Network.enable');
    
    console.log('✅ API Recording started on tab', recordingTabId);
  } catch (error: any) {
    isApiRecording = false;
    recordingTabId = null;
    
    // Check if error is due to another debugger already attached
    if (error.message?.includes('already attached') || error.message?.includes('Another debugger')) {
      console.warn('⚠️ Another debugger is attached. Attempting to detach and retry...');
      
      try {
        // Try to detach any existing debugger
        await chrome.debugger.detach({ tabId: targetTabId }).catch(() => {});
        
        // Wait a bit for cleanup
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Retry attachment
        recordingTabId = targetTabId;
        isApiRecording = true;
        await chrome.debugger.attach({ tabId: recordingTabId }, '1.3');
        await chrome.debugger.sendCommand({ tabId: recordingTabId }, 'Network.enable');
        
        console.log('✅ API Recording started after detaching previous debugger');
        return; // Success on retry
      } catch (retryError: any) {
        isApiRecording = false;
        recordingTabId = null;
        console.error('❌ Failed to start API recording after retry:', retryError);
        throw new Error(
          'Another debugger is already attached to this tab. ' +
          'Please close Chrome DevTools (F12) on the target tab and try again.'
        );
      }
    }
    
    console.error('❌ Failed to start API recording:', error);
    throw error; // Propagate error to UI
  }
}

/**
 * Stop recording API requests
 */
async function stopApiRecording() {
  if (!isApiRecording || !recordingTabId) return;
  
  try {
    await chrome.debugger.detach({ tabId: recordingTabId });
    console.log('API Recording stopped');
  } catch (error) {
    console.error('Failed to stop API recording:', error);
  }
  
  isApiRecording = false;
  recordingTabId = null;
  pendingRequests.clear();
}

// Handle debugger events for network capture
chrome.debugger.onEvent.addListener((source, method, params: any) => {
  if (!isApiRecording || source.tabId !== recordingTabId) return;

  // Capture request
  if (method === 'Network.requestWillBeSent') {
    const { requestId, request, timestamp } = params;
    const url = new URL(request.url);
    
    if (shouldIgnoreRequest(url)) return;
    
    pendingRequests.set(requestId, {
      requestId,
      request,
      timestamp,
      startTime: Date.now()
    });

    const apiRequest: ApiRequest = {
      id: requestId,
      method: request.method,
      url: request.url,
      headers: request.headers || {},
      body: request.postData,
      timestamp: Date.now()
    };

    apiTestingService.captureRequest(apiRequest);
  }

  // Capture response
  if (method === 'Network.responseReceived') {
    const { requestId, response, timestamp } = params;
    const pending = pendingRequests.get(requestId);
    
    if (!pending) return;

    const responseTime = pending.startTime ? Date.now() - pending.startTime : 0;

    // Get response body
    chrome.debugger.sendCommand(
      { tabId: recordingTabId! },
      'Network.getResponseBody',
      { requestId }
    ).then((result: any) => {
      const { body, base64Encoded } = result;
      const apiResponse: ApiResponse = {
        id: `resp-${requestId}`,
        requestId: requestId,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers || {},
        body: base64Encoded ? atob(body) : body,
        responseTime,
        timestamp: Date.now()
      };

      apiTestingService.captureResponse(apiResponse);
      pendingRequests.delete(requestId);
    }).catch(() => {
      // Body not available, still capture response without body
      const apiResponse: ApiResponse = {
        id: `resp-${requestId}`,
        requestId: requestId,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers || {},
        responseTime,
        timestamp: Date.now()
      };

      apiTestingService.captureResponse(apiResponse);
      pendingRequests.delete(requestId);
    });
  }

  // Handle loading finished
  if (method === 'Network.loadingFinished') {
    const { requestId } = params;
    pendingRequests.delete(requestId);
  }
});

// Cleanup on debugger detach
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === recordingTabId) {
    isApiRecording = false;
    recordingTabId = null;
    pendingRequests.clear();
  }
});

/**
 * Check if request should be ignored
 */
function shouldIgnoreRequest(url: URL): boolean {
  // Ignore extension URLs
  if (url.protocol === 'chrome-extension:') return true;

  // Ignore common static resources
  const staticExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
  if (staticExtensions.some(ext => url.pathname.endsWith(ext))) return true;

  // Ignore internal chrome URLs
  if (url.hostname.includes('chrome.google.com')) return true;

  return false;
}

/**
 * Get HTTP status text from status code
 */
function getStatusText(statusCode: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable'
  };

  return statusTexts[statusCode] || 'Unknown';
}

// for testing
Object.assign(self, { attach, setTestIdAttributeName, getCrxApp, _debug, _setUnderTest, startApiRecording, stopApiRecording });
