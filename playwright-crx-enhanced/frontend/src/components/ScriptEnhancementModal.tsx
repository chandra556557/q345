import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './ScriptEnhancementModal.css';

const API_URL = 'http://localhost:3001/api';

interface Project {
  id: string;
  name: string;
}

interface Script {
  id: string;
  name: string;
  language: string;
  projectId: string;
}

interface EnhancementSuggestion {
  lineNumber: number;
  originalCode: string;
  suggestedCode: string;
  reason: string;
  confidence: number;
  category: string;
}

interface EnhancementData {
  scriptId: string;
  scriptName: string;
  originalCode: string;
  enhancedCode: string;
  suggestions: EnhancementSuggestion[];
  diff: Array<{ line: number; type: string; content: string }>;
  summary: {
    totalSuggestions: number;
    byCategory: Record<string, number>;
    estimatedImprovement: number;
  };
}

interface ScriptEnhancementModalProps {
  scriptId?: string;
  scriptName?: string;
  onClose: () => void;
  onApply: () => void;
  autoOpenTestData?: boolean; // Auto-open test data generation modal
}

export const ScriptEnhancementModal: React.FC<ScriptEnhancementModalProps> = ({
  scriptId: initialScriptId,
  scriptName: initialScriptName,
  onClose,
  onApply,
  autoOpenTestData = false
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedScriptId, setSelectedScriptId] = useState<string>(initialScriptId || '');
  const [selectedScriptName, setSelectedScriptName] = useState<string>(initialScriptName || '');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [enhancement, setEnhancement] = useState<EnhancementData | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'suggestions' | 'diff'>('suggestions');
  const [error, setError] = useState<string | null>(null);
  const [useMLEnhancement, setUseMLEnhancement] = useState(false); // ML toggle
  const [analyzeXPath, setAnalyzeXPath] = useState(false); // XPath analysis toggle
  const [analyzeVisualAI, setAnalyzeVisualAI] = useState(false); // Visual AI screenshot analysis toggle
  const [xpathAnalysis, setXpathAnalysis] = useState<any>(null); // XPath analysis results
  const [visualAIAnalysis, setVisualAIAnalysis] = useState<any>(null); // Visual AI analysis results
  const [uploadedFile, setUploadedFile] = useState<File | null>(null); // Uploaded script file
  const [uploadAnalysis, setUploadAnalysis] = useState<any>(null); // Upload analysis results
  
  // Screenshot comparison states
  const [baselineScreenshot, setBaselineScreenshot] = useState<File | null>(null);
  const [currentScreenshot, setCurrentScreenshot] = useState<File | null>(null);
  const [screenshotComparison, setScreenshotComparison] = useState<any>(null);
  const [comparingScreenshots, setComparingScreenshots] = useState(false);
  
  const [testDataRecommendation, setTestDataRecommendation] = useState<any>(null); // Test data recommendations
  const [generatedTestData, setGeneratedTestData] = useState<any>(null); // Generated test data
  const [generatingTestData, setGeneratingTestData] = useState(false); // Loading state for test data generation
  const [showTestDataModal, setShowTestDataModal] = useState(false); // Show test data generation modal
  const [testDataSource, setTestDataSource] = useState<'current' | 'database' | 'upload'>('current'); // Source for test data generation
  const [selectedTestDataProject, setSelectedTestDataProject] = useState<string>(''); // Selected project for test data
  const [selectedTestDataScript, setSelectedTestDataScript] = useState<string>(''); // Selected script for test data
  const [testDataType, setTestDataType] = useState<'positive' | 'negative' | 'boundary' | 'equivalence' | 'security' | 'all'>('all'); // Type of test data to generate
  const [testDataCount, setTestDataCount] = useState<number>(10); // Number of records to generate

  // Field Binding states (post-enhancement test data binding)
  const [bindingPlaceholders, setBindingPlaceholders] = useState<Array<{ name: string; line: number; context: string }>>([]);
  const [fieldBindings, setFieldBindings] = useState<Record<string, string>>({});
  const [extractingPlaceholders, setExtractingPlaceholders] = useState(false);
  const [savingBindings, setSavingBindings] = useState(false);
  const [bindingSaved, setBindingSaved] = useState(false);
  const [manualPlaceholderName, setManualPlaceholderName] = useState('');
  const [manualPlaceholderField, setManualPlaceholderField] = useState('');

  // Phase I: Category toggles for selective enhancement
  const [enableSelectors, setEnableSelectors] = useState(true);
  const [enableWaits, setEnableWaits] = useState(true);
  const [enableAssertions, setEnableAssertions] = useState(true);
  
  // Phase II: Additional category toggles
  const [enablePageObjects, setEnablePageObjects] = useState(true);
  const [enableParameterization, setEnableParameterization] = useState(true);
  const [enableErrorHandling, setEnableErrorHandling] = useState(true);

  // Phase III: New category toggles
  const [enableLogging, setEnableLogging] = useState(true);
  const [enableRetry, setEnableRetry] = useState(true);
  const [enableBestPractices, setEnableBestPractices] = useState(true);

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadScripts(selectedProjectId);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedScriptId) {
      loadEnhancement();
    }
  }, [selectedScriptId, useMLEnhancement, analyzeXPath, analyzeVisualAI]); // Re-run when ML toggle, XPath toggle, or Visual AI toggle changes

  // Auto-open test data modal if requested
  useEffect(() => {
    if (autoOpenTestData && enhancement && !showTestDataModal) {
      setShowTestDataModal(true);
    }
  }, [autoOpenTestData, enhancement]);

  // Debug: Monitor generatedTestData state changes
  useEffect(() => {
    console.log('🔄 generatedTestData state changed:', {
      hasData: !!generatedTestData,
      data: generatedTestData
    });
    
    // Auto-scroll to test data results when data is generated
    if (generatedTestData) {
      setTimeout(() => {
        const resultsElement = document.querySelector('[data-testdata-results]');
        if (resultsElement) {
          resultsElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          console.log('📜 Auto-scrolled to test data results');
        }
      }, 100);
    }
  }, [generatedTestData]);

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      const res = await axios.get(`${API_URL}/projects`, { headers });
      console.log('Projects loaded:', res.data);
      setProjects(res.data.data || []);
      
      // If initialScriptId provided, find its project
      if (initialScriptId && res.data.data?.length > 0) {
        const scriptRes = await axios.get(`${API_URL}/scripts/${initialScriptId}`, { headers });
        const script = scriptRes.data.data;
        console.log('Initial script loaded:', script);
        if (script) {
          setSelectedProjectId(script.projectId);
        }
      }
    } catch (err: any) {
      console.error('Failed to load projects:', err);
      setError(err.response?.data?.error || 'Failed to load projects. Please ensure you are logged in.');
    } finally {
      setLoadingProjects(false);
    }
  };

  const loadScripts = async (projectId: string) => {
    try {
      console.log('Loading scripts for project:', projectId);
      const res = await axios.get(`${API_URL}/scripts`, { headers, params: { projectId } });
      console.log('Scripts loaded:', res.data);
      const scriptList = res.data.data || res.data.scripts || [];
      
      // Deduplicate scripts by ID to show only unique records
      const uniqueScripts = scriptList.reduce((acc: any[], script: any) => {
        if (!acc.find(s => s.id === script.id)) {
          acc.push(script);
        }
        return acc;
      }, []);
      
      console.log(`Loaded ${scriptList.length} scripts, ${uniqueScripts.length} unique`);
      setScripts(uniqueScripts);
      
      // Auto-select if initialScriptId is in this project
      if (initialScriptId && !selectedScriptId) {
        setSelectedScriptId(initialScriptId);
      }
    } catch (err: any) {
      console.error('Failed to load scripts:', err);
      setError(err.response?.data?.error || 'Failed to load scripts for this project.');
    }
  };

  const loadEnhancement = async () => {
    if (!selectedScriptId) return;
    
    console.log('Loading enhancement for script:', selectedScriptId, 'ML mode:', useMLEnhancement, 'XPath:', analyzeXPath, 'Visual AI:', analyzeVisualAI);
    setLoading(true);
    setError(null);
    setXpathAnalysis(null); // Reset XPath analysis
    setVisualAIAnalysis(null); // Reset Visual AI analysis
    try {
      // Choose endpoint based on ML toggle
      const endpoint = useMLEnhancement 
        ? `${API_URL}/ml/enhance-script/${selectedScriptId}`
        : `${API_URL}/scripts/${selectedScriptId}/enhance`;
      
      const res = await axios.post(
        endpoint,
        {},
        { headers }
      );
      console.log('Enhancement data received:', res.data);
      const data: EnhancementData = res.data.data;
      setEnhancement(data);
      setSelectedScriptName(data.scriptName);
      
      // If XPath analysis is enabled, extract and analyze XPath expressions
      if (analyzeXPath) {
        await analyzeXPathExpressions(data.originalCode);
      }
      
      // If Visual AI is enabled, extract and analyze screenshots
      if (analyzeVisualAI) {
        await analyzeVisualScreenshots(data.originalCode);
      }
      
      // Pre-select high-confidence suggestions (respecting category toggles)
      const enabledCategories = new Set<string>([
        ...(enableSelectors ? ['selector'] : []),
        ...(enableWaits ? ['wait'] : []),
        ...(enableAssertions ? ['assertion'] : []),
        ...(enablePageObjects ? ['page-object'] : []),
        ...(enableParameterization ? ['parameterization'] : []),
        ...(enableErrorHandling ? ['error-handling'] : []),
        ...(enableLogging ? ['logging'] : []),
        ...(enableRetry ? ['retry'] : []),
        ...(enableBestPractices ? ['best-practice'] : [])
      ]);
      
      const highConfidence = new Set(
        data.suggestions
          .map((s, idx) => ({ s, idx }))
          .filter(({ s }) => s.confidence >= 0.8 && enabledCategories.has(s.category))
          .map(({ idx }) => idx)
      );
      setSelectedSuggestions(highConfidence);
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to analyze script';
      console.error('Enhancement error:', err);
      console.error('Error details:', err.response?.data);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const analyzeXPathExpressions = async (code: string) => {
    try {
      // Extract XPath expressions from code
      const xpathMatches = code.match(/['"]xpath=([^'"]+)['"]/g) || [];
      const absoluteXPaths = code.match(/locator\(['"](\/[^'"]+)['"]\)/g) || [];
      const relativeXPaths = code.match(/locator\(['"](\/\/[^'"]+)['"]\)/g) || [];
      
      const allXPaths = [
        ...xpathMatches.map(m => m.replace(/['"]xpath=/g, '').replace(/['"]/g, '')),
        ...absoluteXPaths.map(m => m.match(/locator\(['"]([^'"]+)['"]\)/)?.[1] || ''),
        ...relativeXPaths.map(m => m.match(/locator\(['"]([^'"]+)['"]\)/)?.[1] || '')
      ].filter(x => x && (x.startsWith('/') || x.startsWith('./')));

      if (allXPaths.length === 0) {
        setXpathAnalysis({
          found: false,
          message: 'No XPath expressions found in the script'
        });
        return;
      }

      console.log('Found XPath expressions:', allXPaths);
      console.log('🔍 Analyzing XPaths via backend AI enhancement service');

      // Analyze each XPath using backend ai-enhancement endpoint
      const analyses = await Promise.all(
        allXPaths.map(async (xpath) => {
          try {
            const response = await axios.post(`${API_URL}/ai-enhancement/xpath-analyze`, {
              xpath: xpath
            }, {
              headers,
              timeout: 30000
            });
            return {
              xpath,
              ...response.data.data
            };
          } catch (error: any) {
            console.error('XPath analysis error for:', xpath, error);

            let errorMsg = 'Analysis failed';
            if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') {
              errorMsg = 'Network error - backend unreachable';
            } else if (error.response) {
              errorMsg = `API error (${error.response.status})`;
            }

            return {
              xpath,
              error: errorMsg
            };
          }
        })
      );

      setXpathAnalysis({
        found: true,
        count: allXPaths.length,
        analyses
      });

    } catch (error) {
      console.error('XPath extraction error:', error);
      setXpathAnalysis({
        found: false,
        error: 'Failed to analyze XPath expressions'
      });
    }
  };

  const analyzeVisualScreenshots = async (code: string) => {
    try {
      // Extract screenshot commands from code
      const screenshotMatches = code.match(/screenshot\([^)]*\)/g) || [];
      const toHaveScreenshotMatches = code.match(/toHaveScreenshot\([^)]*\)/g) || [];
      const screenshotPaths = code.match(/path:\s*['"]([^'"]+\.png)['"]/g) || [];
      
      const allScreenshots = [
        ...screenshotMatches,
        ...toHaveScreenshotMatches
      ];

      if (allScreenshots.length === 0) {
        setVisualAIAnalysis({
          found: false,
          message: 'No screenshot assertions found in the script'
        });
        return;
      }

      console.log('Found screenshot commands:', allScreenshots);

      // Extract screenshot paths/names
      const paths = screenshotPaths.map(p => {
        const match = p.match(/path:\s*['"]([^'"]+)['"]/);
        return match ? match[1] : null;
      }).filter(Boolean);

      setVisualAIAnalysis({
        found: true,
        count: allScreenshots.length,
        screenshot_commands: allScreenshots,
        screenshot_paths: paths,
        recommendations: [
          {
            screenshot_type: 'Visual Regression Testing',
            suggestions: [
              'Upload baseline and current screenshots for AI-powered comparison',
              'Use the screenshot comparison feature below',
              'Set appropriate tolerance levels (0.95 for strict, 0.70 for lenient)'
            ],
            best_practices: [
              'Store baseline screenshots in version control',
              'Use consistent viewport sizes',
              'Mask dynamic content (timestamps, ads, user-specific data)',
              'Run visual tests in headless mode for consistency'
            ]
          }
        ]
      });

    } catch (error) {
      console.error('Visual AI analysis error:', error);
      setVisualAIAnalysis({
        found: false,
        error: 'Failed to analyze visual screenshots'
      });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setLoading(true);
    setError(null);
    setUploadAnalysis(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      console.log('📤 Uploading script to backend for XPath analysis');

      const response = await axios.post(`${API_URL}/ai-enhancement/upload-script-xpath-analysis`, formData, {
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data'
        },
        timeout: 30000,
        validateStatus: (status) => status < 500
      });

      console.log('Upload analysis received:', response.data);
      setUploadAnalysis(response.data.data);
    } catch (err: any) {
      console.error('File upload error:', err);
      
      // Detailed error handling
      let errorMessage = 'Failed to analyze uploaded script';
      
      if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') {
        errorMessage = '⚠️ Cannot connect to backend API. Please check:\n' +
                      '1. Backend server is running on port 3001\n' +
                      '2. Network connection';
      } else if (err.response) {
        errorMessage = `API Error (${err.response.status}): ${err.response.data?.detail || err.response.statusText}`;
      } else if (err.request) {
        errorMessage = '⚠️ No response from server. The API might be down or unreachable.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleBaselineUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setBaselineScreenshot(file);
      console.log('Baseline screenshot uploaded:', file.name);
    } else {
      alert('Please upload a valid image file (PNG, JPG, etc.)');
    }
  };

  const handleCurrentUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setCurrentScreenshot(file);
      console.log('Current screenshot uploaded:', file.name);
    } else {
      alert('Please upload a valid image file (PNG, JPG, etc.)');
    }
  };

  const compareScreenshots = async () => {
    if (!baselineScreenshot || !currentScreenshot) {
      alert('Please upload both baseline and current screenshots');
      return;
    }

    setComparingScreenshots(true);
    setScreenshotComparison(null);
    setError(null);

    try {
      // Convert images to base64
      const baselineBase64 = await fileToBase64(baselineScreenshot);
      const currentBase64 = await fileToBase64(currentScreenshot);

      console.log('📸 Comparing screenshots via Node.js backend API...');
      
      // Call Node.js backend API for visual regression analysis
      const response = await axios.post(`${API_URL}/ai-enhancement/layout-changes`, {
        before_screenshot: baselineBase64,
        after_screenshot: currentBase64,
        tolerance: 0.95
      }, {
        timeout: 30000,
        headers
      });

      console.log('✅ Screenshot comparison complete:', response.data);
      setScreenshotComparison(response.data.data);

    } catch (err: any) {
      console.error('Screenshot comparison error:', err);
      
      let errorMessage = 'Failed to compare screenshots';
      if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') {
        errorMessage = '⚠️ Cannot connect to backend API. Please ensure the backend server is running on port 3001.';
      } else if (err.response) {
        errorMessage = `API Error (${err.response.status}): ${err.response.data?.error || err.response.statusText}`;
      }
      
      setError(errorMessage);
    } finally {
      setComparingScreenshots(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const generateTestData = async () => {
    setGeneratingTestData(true);
    setTestDataRecommendation(null);
    setGeneratedTestData(null);

    try {
      let scriptCode = '';

      // Get script code based on source
      if (testDataSource === 'current') {
        if (!enhancement?.originalCode) {
          alert('No script loaded. Please select a script first.');
          return;
        }
        scriptCode = enhancement.originalCode;
      } else if (testDataSource === 'database') {
        if (!selectedTestDataScript) {
          alert('Please select a script from the database.');
          return;
        }
        // Fetch script code from database
        const scriptRes = await axios.get(`${API_URL}/scripts/${selectedTestDataScript}`, { headers });
        scriptCode = scriptRes.data.data.code;
      } else if (testDataSource === 'upload') {
        if (!uploadedFile) {
          alert('Please upload a file.');
          return;
        }
        // Read file content
        scriptCode = await uploadedFile.text();
      }
      
      console.log('🚀 Generating test data via external GPT-4 APIs (no local AI service)');
      
      // Call backend API directly - backend will analyze script and generate test data via external GPT-4 APIs
      const endpointMap: Record<string, string> = {
        'security': '/api/testdata/generate/security',
        'boundary': '/api/testdata/generate/boundary',
        'equivalence': '/api/testdata/generate/equivalence',
        'positive': '/api/testdata/generate/positive',
        'negative': '/api/testdata/generate/negative'
      };
      
      // If 'all' is selected, call all endpoints and combine results
      if (testDataType === 'all') {
        console.log(`📤 Generating ALL test data types via external GPT-4 APIs`);
        const allResults: any = {
          success: true,
          data: [],
          metadata: {
            test_data_types: ['positive', 'negative', 'boundary', 'security', 'equivalence'],
            source: 'external_api',
            combined: true
          }
        };
        
        // Call each endpoint sequentially
        for (const [type, endpoint] of Object.entries(endpointMap)) {
          try {
            const fullUrl = `http://localhost:3001${endpoint}`;
            console.log(`📤 Calling ${type}: ${fullUrl}`);
            console.log(`   → External GPT-4 will analyze script and generate test data`);
            
            const genResponse = await axios.post(fullUrl, {
              scriptCode: scriptCode,  // Use camelCase as per Swagger API docs
              template: {},
              count: Math.ceil(testDataCount / 5) // Distribute count across types
            }, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              }
            });
            
            console.log(`✅ ${type} completed via external GPT-4 API`);
            console.log(`   → Endpoint: ${genResponse.data.metadata?.external_endpoint}`);
            
            // Extract and add data
            const responseData = Array.isArray(genResponse.data.data) 
              ? genResponse.data.data 
              : genResponse.data.data?.data || [];
            
            allResults.data.push(...responseData);
          } catch (err: any) {
            console.error(`❌ Failed to generate ${type}:`, err.message);
          }
        }
        
        console.log(`🎉 All test data types generated: ${allResults.data.length} total records`);
        setGeneratedTestData(allResults);
      } else {
        // Single type generation
        const endpoint = endpointMap[testDataType];
        if (!endpoint) {
          throw new Error(`Unknown test data type: ${testDataType}`);
        }
        
        const fullUrl = `http://localhost:3001${endpoint}`;
        
        console.log(`📤 Calling backend API: ${fullUrl}`);
        console.log(`🎯 Test Data Type: ${testDataType}`);
        console.log(`📦 External GPT-4 will analyze script and generate test data`);
        
        const genResponse = await axios.post(fullUrl, {
          scriptCode: scriptCode,  // Use camelCase as per Swagger API docs
          template: {},
          count: testDataCount
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        
        console.log(`✅ Response received from backend`);
        console.log(`🌐 External GPT-4 API: ${genResponse.data.metadata?.external_endpoint || 'unknown'}`);
        console.log(`📊 Full Response Data:`, genResponse.data);

        setGeneratedTestData(genResponse.data);
        console.log(`✅ State updated - generatedTestData should now be set`);
      }

      // DON'T close modal - keep it open to show results
      // User can close it manually or click the close button

    } catch (err: any) {
      console.error('Test data generation error:', err);
      setError(err.response?.data?.detail || err.response?.data?.error || 'Failed to generate test data');
    } finally {
      setGeneratingTestData(false);
    }
  };

  // ── Field Binding Logic ────────────────────────────────────────────

  /** Extract {{placeholder}} patterns from enhanced (or original) script code */
  const extractPlaceholders = async () => {
    if (!enhancement) return;
    setExtractingPlaceholders(true);
    try {
      // Try backend extraction first
      const res = await axios.post(
        `${API_URL}/data-driven-runs/extract-placeholders`,
        { scriptId: selectedScriptId },
        { headers }
      );
      const phs = res.data?.placeholders || [];
      setBindingPlaceholders(phs);
      autoBindFields(phs);
    } catch {
      // Fallback: client-side regex extraction from enhanced code
      const code = enhancement.enhancedCode || enhancement.originalCode || '';
      const phs: Array<{ name: string; line: number; context: string }> = [];
      const seen = new Set<string>();
      code.split('\n').forEach((line, i) => {
        const phRegex = /\{\{(\w+)\}\}/g;
        let match: RegExpExecArray | null;
        while ((match = phRegex.exec(line)) !== null) {
          if (!seen.has(match[1])) {
            seen.add(match[1]);
            phs.push({ name: match[1], line: i + 1, context: line.trim().substring(0, 80) });
          }
        }
      });
      // Also extract from fill/getByLabel/getByPlaceholder patterns for smart detection
      const selectorPatterns = [
        /\.fill\(['"]#?([^'"]+)['"],\s*['"]([^'"]*)['"]\)/g,
        /\.fill\(['"]\.([^'"]+)['"],\s*['"]([^'"]*)['"]\)/g,
        /getByPlaceholder\(['"]([^'"]+)['"]\)/g,
        /getByLabel\(['"]([^'"]+)['"]\)/g,
      ];
      code.split('\n').forEach((line, i) => {
        for (const pattern of selectorPatterns) {
          let sMatch: RegExpExecArray | null;
          while ((sMatch = pattern.exec(line)) !== null) {
            const fieldName = sMatch[1].replace(/[^a-zA-Z0-9_]/g, '_');
            if (fieldName && !seen.has(fieldName)) {
              seen.add(fieldName);
              phs.push({ name: fieldName, line: i + 1, context: line.trim().substring(0, 80) });
            }
          }
        }
      });
      setBindingPlaceholders(phs);
      autoBindFields(phs);
    } finally {
      setExtractingPlaceholders(false);
    }
  };

  /** Get available data field names from generated test data */
  const getAvailableDataFields = (): string[] => {
    if (!generatedTestData) return [];
    const dataArray = Array.isArray(generatedTestData.data)
      ? generatedTestData.data
      : generatedTestData.data?.data || [];
    if (dataArray.length === 0) return [];
    return Object.keys(dataArray[0]).filter((k: string) => !k.startsWith('_'));
  };

  /** Auto-bind placeholders to data fields by exact or fuzzy match */
  const autoBindFields = (phs: Array<{ name: string; line: number; context: string }>) => {
    const dataFields = getAvailableDataFields();
    if (dataFields.length === 0) return;
    const bindings: Record<string, string> = {};
    for (const ph of phs) {
      const exact = dataFields.find(f => f.toLowerCase() === ph.name.toLowerCase());
      if (exact) { bindings[ph.name] = exact; continue; }
      const fuzzy = dataFields.find(
        f => f.toLowerCase().includes(ph.name.toLowerCase()) || ph.name.toLowerCase().includes(f.toLowerCase())
      );
      if (fuzzy) bindings[ph.name] = fuzzy;
    }
    setFieldBindings(bindings);
  };

  /** Save field bindings and create a data-driven run */
  const saveFieldBindings = async () => {
    if (!selectedScriptId || !generatedTestData || Object.keys(fieldBindings).length === 0) {
      alert('Please complete field binding before saving.');
      return;
    }
    setSavingBindings(true);
    setBindingSaved(false);
    try {
      const dataArray = Array.isArray(generatedTestData.data)
        ? generatedTestData.data
        : generatedTestData.data?.data || [];

      const res = await axios.post(`${API_URL}/data-driven-runs`, {
        scriptId: selectedScriptId,
        dataRows: dataArray,
        fieldBindings,
        browser: 'chromium',
        executionMode: 'sequential',
        executionConfig: { stopOnFirstFailure: false, delayBetweenRows: 500, maxParallel: 1 },
        name: `${selectedScriptName || 'Script'} - Post Enhancement DDR`
      }, { headers });

      console.log('Data-driven run created:', res.data);
      setBindingSaved(true);
    } catch (err: any) {
      console.error('Failed to save field bindings:', err);
      alert(err.response?.data?.error || 'Failed to save field bindings. Please try again.');
    } finally {
      setSavingBindings(false);
    }
  };

  const toggleSuggestion = (index: number) => {
    const newSelected = new Set(selectedSuggestions);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedSuggestions(newSelected);
  };

  const applyEnhancements = async () => {
    if (!enhancement) return;

    setApplying(true);
    try {
      // Use the enhanced code from backend or build it from selected suggestions
      let finalCode = enhancement.enhancedCode;
      
      // Build enabled categories set
      const enabledCategories = new Set<string>([
        ...(enableSelectors ? ['selector'] : []),
        ...(enableWaits ? ['wait'] : []),
        ...(enableAssertions ? ['assertion'] : []),
        ...(enablePageObjects ? ['page-object'] : []),
        ...(enableParameterization ? ['parameterization'] : []),
        ...(enableErrorHandling ? ['error-handling'] : []),
        ...(enableLogging ? ['logging'] : []),
        ...(enableRetry ? ['retry'] : []),
        ...(enableBestPractices ? ['best-practice'] : [])
      ]);
      
      // If user deselected some suggestions or disabled categories, rebuild the code
      if (
        selectedSuggestions.size !== enhancement.suggestions.length ||
        enabledCategories.size !== 9
      ) {
        const lines = enhancement.originalCode.split('\n');
        const selectedSuggestionsList = enhancement.suggestions
          .map((s, idx) => ({ s, idx }))
          .filter(({ s, idx }) => selectedSuggestions.has(idx) && enabledCategories.has(s.category))
          .sort((a, b) => b.s.lineNumber - a.s.lineNumber);

        selectedSuggestionsList.forEach(({ s }) => {
          if (s.lineNumber < lines.length) {
            lines[s.lineNumber] = s.suggestedCode;
          }
        });
        finalCode = lines.join('\n');
      }

      const response = await axios.post(
        `${API_URL}/scripts/${selectedScriptId}/apply-enhancement`,
        { enhancedCode: finalCode },
        { headers }
      );

      alert('✅ ' + (response.data.message || 'Script enhanced successfully!'));
      onApply();
      onClose();
    } catch (err: any) {
      alert('Failed to apply enhancements: ' + (err.response?.data?.error || err.message));
    } finally {
      setApplying(false);
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      selector: '#3b82f6',
      wait: '#f59e0b',
      assertion: '#10b981',
      'page-object': '#8b5cf6',
      parameterization: '#ec4899',
      'error-handling': '#ef4444',
      logging: '#06b6d4',
      retry: '#f97316',
      'best-practice': '#84cc16',
      locator: '#3b82f6'
    };
    return colors[category] || '#6b7280';
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, string> = {
      selector: '🎯',
      wait: '⏱️',
      assertion: '✅',
      'page-object': '📦',
      parameterization: '🔧',
      'error-handling': '🛡️',
      logging: '📝',
      retry: '🔁',
      'best-practice': '✨',
      locator: '🎯'
    };
    return icons[category] || '📝';
  };

  if (loadingProjects) {
    return (
      <div className="modal-overlay">
        <div className="enhancement-modal">
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading projects...</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="enhancement-modal">
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Analyzing script for improvements...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="modal-overlay">
        <div className="enhancement-modal">
          <div className="error-state">
            <h3>❌ Error</h3>
            <p>{error}</p>
            <button onClick={onClose} className="btn-secondary">Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (!enhancement) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="enhancement-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2>🚀 AI Script Enhancement</h2>
              <p className="script-name">Select a script to enhance</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {/* ML Enhancement Toggle */}
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                cursor: 'pointer',
                padding: '8px 12px',
                background: useMLEnhancement ? '#3b82f6' : '#e2e8f0',
                color: useMLEnhancement ? 'white' : '#475569',
                borderRadius: '8px',
                fontWeight: 500,
                fontSize: '14px',
                transition: 'all 0.2s'
              }}
              title={useMLEnhancement 
                ? 'ML Mode: Uses AST analysis and pattern recognition for intelligent suggestions' 
                : 'Rule-Based Mode: Uses predefined patterns for fast analysis'}
              >
                <input 
                  type="checkbox" 
                  checked={useMLEnhancement} 
                  onChange={(e) => setUseMLEnhancement(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#3b82f6' }}
                />
                <span>🧠 ML Enhancement</span>
              </label>
              
              {/* XPath Analysis Toggle */}
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                cursor: 'pointer',
                padding: '8px 12px',
                background: analyzeXPath ? '#10b981' : '#e2e8f0',
                color: analyzeXPath ? 'white' : '#475569',
                borderRadius: '8px',
                fontWeight: 500,
                fontSize: '14px',
                transition: 'all 0.2s'
              }}
              title="Analyze XPath expressions and get AI-powered conversion recommendations"
              >
                <input 
                  type="checkbox" 
                  checked={analyzeXPath} 
                  onChange={(e) => setAnalyzeXPath(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#10b981' }}
                />
                <span>🔍 XPath Analysis</span>
              </label>
              
              {/* Visual AI Toggle */}
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                cursor: 'pointer',
                padding: '8px 12px',
                background: analyzeVisualAI ? '#8b5cf6' : '#e2e8f0',
                color: analyzeVisualAI ? 'white' : '#475569',
                borderRadius: '8px',
                fontWeight: 500,
                fontSize: '14px',
                transition: 'all 0.2s'
              }}
              title="Analyze screenshots with Visual AI for regression testing"
              >
                <input 
                  type="checkbox" 
                  checked={analyzeVisualAI} 
                  onChange={(e) => setAnalyzeVisualAI(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#8b5cf6' }}
                />
                <span>🇺 Visual AI</span>
              </label>
              <button onClick={onClose} className="close-btn">×</button>
            </div>
          </div>

          <div className="script-selector">
            {projects.length === 0 ? (
              <div className="empty-state">
                <p style={{ marginBottom: '16px' }}>⚠️ No projects found. Please create a project first.</p>
                <button onClick={onClose} className="btn-primary">Close</button>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label htmlFor="project-select">📁 Select Project</label>
                  <select 
                    id="project-select"
                    value={selectedProjectId} 
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value);
                      setSelectedScriptId('');
                      setEnhancement(null);
                    }}
                    className="form-select"
                  >
                    <option value="">Choose a project...</option>
                    {projects.map(proj => (
                      <option key={proj.id} value={proj.id}>{proj.name}</option>
                    ))}
                  </select>
                </div>

                {selectedProjectId && (
                  <div className="form-group">
                    <label htmlFor="script-select">📝 Select Script</label>
                    {scripts.length === 0 ? (
                      <p style={{ color: '#f59e0b', marginTop: '8px' }}>⚠️ No scripts found in this project. Please create or import a script first.</p>
                    ) : (
                      <select 
                        id="script-select"
                        value={selectedScriptId} 
                        onChange={(e) => {
                          setSelectedScriptId(e.target.value);
                          const script = scripts.find(s => s.id === e.target.value);
                          if (script) {
                            setSelectedScriptName(script.name);
                          }
                        }}
                        className="form-select"
                      >
                        <option value="">Choose a script...</option>
                        {scripts.map(script => (
                          <option key={script.id} value={script.id}>
                            {script.name} ({script.language})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {/* File Upload Section */}
                <div style={{ 
                  marginTop: '24px', 
                  padding: '16px', 
                  background: '#f8fafc', 
                  borderRadius: '8px',
                  border: '2px dashed #cbd5e1'
                }}>
                  <label style={{ 
                    display: 'block', 
                    fontWeight: 600, 
                    marginBottom: '12px',
                    color: '#1e293b'
                  }}>📤 Or Upload Playwright Script for XPath Analysis</label>
                  <input 
                    type="file" 
                    accept=".ts,.js,.spec.ts,.spec.js"
                    onChange={handleFileUpload}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '12px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      background: 'white',
                      cursor: 'pointer'
                    }}
                  />
                  {uploadedFile && (
                    <p style={{ marginTop: '8px', fontSize: '14px', color: '#10b981' }}>
                      ✅ Uploaded: {uploadedFile.name}
                    </p>
                  )}
                </div>

                {selectedScriptId && (
                  <button 
                    onClick={loadEnhancement}
                    className="btn-primary"
                    style={{ marginTop: '16px', width: '100%' }}
                  >
                    🚀 Analyze Script
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="enhancement-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>🚀 AI Script Enhancement</h2>
            <p className="script-name">{selectedScriptName}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* ML Enhancement Toggle */}
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              cursor: 'pointer',
              padding: '8px 12px',
              background: useMLEnhancement ? '#3b82f6' : '#e2e8f0',
              color: useMLEnhancement ? 'white' : '#475569',
              borderRadius: '8px',
              fontWeight: 500,
              fontSize: '14px',
              transition: 'all 0.2s'
            }}>
              <input 
                type="checkbox" 
                checked={useMLEnhancement} 
                onChange={(e) => setUseMLEnhancement(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#3b82f6' }}
              />
              <span>🧠 ML Enhancement</span>
            </label>
            <button onClick={onClose} className="close-btn">×</button>
          </div>
        </div>

        <div className="enhancement-summary">
          <div className="summary-card">
            <div className="summary-icon">💡</div>
            <div>
              <div className="summary-value">{enhancement.summary.totalSuggestions}</div>
              <div className="summary-label">Suggestions</div>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-icon">{useMLEnhancement ? '🧠' : '📊'}</div>
            <div>
              <div className="summary-value">{useMLEnhancement ? 'ML' : 'Rule'}</div>
              <div className="summary-label">Mode</div>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-icon">✅</div>
            <div>
              <div className="summary-value">{selectedSuggestions.size}</div>
              <div className="summary-label">Selected</div>
            </div>
          </div>
        </div>

        <div className="view-tabs">
          <button
            className={`tab ${viewMode === 'suggestions' ? 'active' : ''}`}
            onClick={() => setViewMode('suggestions')}
          >
            📝 Suggestions
          </button>
          <button
            className={`tab ${viewMode === 'diff' ? 'active' : ''}`}
            onClick={() => setViewMode('diff')}
          >
            🔄 Code Diff
          </button>
        </div>

        <div className="modal-content" style={{width:"93vw",maxWidth:"100vw"}}>
          {viewMode === 'suggestions' ? (
            <div className="suggestions-list">
              {/* Phase I + II: Category toggles */}
              <div className="category-toggles" style={{ 
                display: 'flex', 
                flexWrap: 'wrap',
                gap: '12px', 
                marginBottom: '16px', 
                padding: '12px', 
                background: '#f8fafc', 
                borderRadius: '8px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ width: '100%', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>Phase I: Core Improvements</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enableSelectors} 
                    onChange={(e) => setEnableSelectors(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#3b82f6' }}>🎯 Selectors</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enableWaits} 
                    onChange={(e) => setEnableWaits(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#f59e0b' }}>⏱️ Waits</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enableAssertions} 
                    onChange={(e) => setEnableAssertions(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#10b981' }}>✅ Assertions</span>
                </label>
                
                <div style={{ width: '100%', height: '1px', background: '#e2e8f0', margin: '4px 0' }}></div>
                <div style={{ width: '100%', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>Phase II: Advanced</div>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enablePageObjects} 
                    onChange={(e) => setEnablePageObjects(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#8b5cf6' }}>📦 Page Objects</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enableParameterization} 
                    onChange={(e) => setEnableParameterization(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#ec4899' }}>🔧 Parameterization</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enableErrorHandling} 
                    onChange={(e) => setEnableErrorHandling(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#ef4444' }}>🛡️ Error Handling</span>
                </label>
                
                <div style={{ width: '100%', height: '1px', background: '#e2e8f0', margin: '4px 0' }}></div>
                <div style={{ width: '100%', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>Phase III: New Enhancements</div>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enableLogging} 
                    onChange={(e) => setEnableLogging(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#06b6d4' }}>📝 Logging</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enableRetry} 
                    onChange={(e) => setEnableRetry(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#f97316' }}>🔁 Retry Logic</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={enableBestPractices} 
                    onChange={(e) => setEnableBestPractices(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 500, color: '#84cc16' }}>✨ Best Practices</span>
                </label>
              </div>

              {/* 🔥 GENERATED TEST DATA - PROMINENT DISPLAY 🔥 */}
              {generatedTestData && (() => {
                const dataArray = Array.isArray(generatedTestData.data) 
                  ? generatedTestData.data 
                  : generatedTestData.data?.data || [];
                
                if (dataArray.length === 0) return null;
                
                return (
                  <div style={{
                    marginBottom: '20px',
                    padding: '20px',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: 'white',
                    borderRadius: '12px',
                    boxShadow: '0 8px 24px rgba(16, 185, 129, 0.5)',
                    border: '3px solid #059669',
                    animation: 'pulse 2s infinite'
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '16px'
                    }}>
                      <h3 style={{ 
                        fontSize: '20px', 
                        fontWeight: 700,
                        margin: 0
                      }}>
                        ✅ GPT-4 Generated Test Data ({dataArray.length} records)
                      </h3>
                      <span style={{ 
                        padding: '8px 16px', 
                        background: 'rgba(255,255,255,0.3)', 
                        borderRadius: '8px', 
                        fontSize: '13px',
                        fontWeight: 700
                      }}>
                        🎯 {generatedTestData.metadata?.testDataType?.toUpperCase() || 'MIXED TYPES'}
                      </span>
                    </div>
                    
                    <div style={{
                      background: 'rgba(255,255,255,0.98)',
                      color: '#1e293b',
                      padding: '16px',
                      borderRadius: '8px',
                      marginBottom: '12px',
                      maxHeight: '500px',
                      overflowY: 'auto'
                    }}>
                      {dataArray.map((record: any, idx: number) => (
                        <div key={idx} style={{
                          marginBottom: '12px',
                          padding: '12px',
                          background: idx % 2 === 0 ? '#f8fafc' : 'white',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <div style={{ 
                            fontWeight: 700, 
                            color: '#059669', 
                            marginBottom: '8px',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            <span>#{idx + 1}</span>
                            {record._testDataType && (
                              <span style={{ 
                                padding: '3px 10px',
                                background: record._testDataType === 'security' ? '#ef4444' : 
                                           record._testDataType === 'boundary' ? '#f59e0b' :
                                           record._testDataType === 'negative' ? '#ec4899' : 
                                           record._testDataType === 'positive' ? '#10b981' : '#6366f1',
                                color: 'white',
                                borderRadius: '4px',
                                fontSize: '10px'
                              }}>
                                {record._testDataType.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <pre style={{ 
                            margin: 0, 
                            whiteSpace: 'pre-wrap', 
                            wordBreak: 'break-word', 
                            fontSize: '11px',
                            background: 'transparent',
                            padding: 0
                          }}>
                            {JSON.stringify(record, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                    
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(dataArray, null, 2));
                          alert(`✅ ${dataArray.length} test records copied to clipboard!`);
                        }}
                        style={{
                          flex: 1,
                          padding: '12px 20px',
                          background: 'white',
                          color: '#059669',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                      >
                        📋 Copy All ({dataArray.length} records)
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Clear test data results?')) {
                            setGeneratedTestData(null);
                          }
                        }}
                        style={{
                          padding: '12px 20px',
                          background: 'rgba(239, 68, 68, 0.9)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ Clear
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Test Data Generation Button */}
              <div style={{ marginTop: '20px', marginBottom: '20px' }}>
                <button
                  onClick={() => setShowTestDataModal(true)}
                  disabled={generatingTestData}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: generatingTestData ? '#9ca3af' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: generatingTestData ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    transition: 'all 0.2s'
                  }}
                >
                  {generatingTestData ? '⏳ Generating Test Data...' : '🧪 Generate Test Data with GPT-4o'}
                </button>
              </div>

              {/* Test Data Recommendation Results */}
              {(testDataRecommendation || generatedTestData) && (
                <div 
                  data-testdata-results
                  style={{
                  marginBottom: '24px',
                  padding: '16px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  borderRadius: '12px',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                }}>
                  <h4 style={{ 
                    fontSize: '16px', 
                    fontWeight: 700, 
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    🧪 Test Data Generation Results
                  </h4>

                  {/* Detected Fields */}
                  {testDataRecommendation?.detected_fields && testDataRecommendation.detected_fields.length > 0 && (
                    <div style={{
                      background: 'rgba(255,255,255,0.95)',
                      color: '#1e293b',
                      padding: '16px',
                      borderRadius: '8px',
                      marginBottom: '16px'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: '12px', color: '#059669' }}>📊 Detected Fields ({testDataRecommendation.detected_fields.length}):</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                        {testDataRecommendation.detected_fields.map((field: any, idx: number) => (
                          <div key={idx} style={{
                            padding: '8px',
                            background: '#f0fdf4',
                            borderRadius: '6px',
                            fontSize: '12px'
                          }}>
                            <div style={{ fontWeight: 600, color: '#059669' }}>{field.field}</div>
                            <div style={{ color: '#6b7280', fontSize: '11px' }}>{field.type}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* GPT-4o Recommendation */}
                  {testDataRecommendation?.gpt4_recommendation && (
                    <div style={{
                      background: 'rgba(255,255,255,0.95)',
                      color: '#1e293b',
                      padding: '16px',
                      borderRadius: '8px',
                      marginBottom: '16px',
                      fontSize: '13px',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: '8px', color: '#059669' }}>🤖 GPT-4o Recommendations:</div>
                      {testDataRecommendation.gpt4_recommendation}
                    </div>
                  )}

                  {/* Generated Test Data */}
                  {generatedTestData && (() => {
                    const dataArray = Array.isArray(generatedTestData.data) 
                      ? generatedTestData.data 
                      : generatedTestData.data?.data || [];
                    
                    console.log('📊 Test Data Display Check:', {
                      hasGeneratedTestData: !!generatedTestData,
                      dataArrayLength: dataArray.length,
                      structure: generatedTestData
                    });
                    
                    if (dataArray.length === 0) return null;
                    
                    // Check if data contains only metadata (_testDataType, _index)
                    const hasActualData = dataArray.some((record: any) => {
                      const keys = Object.keys(record);
                      return keys.some(key => !key.startsWith('_'));
                    });
                    
                    if (!hasActualData) {
                      return (
                        <div style={{
                          background: 'rgba(251, 191, 36, 0.1)',
                          color: '#92400e',
                          padding: '16px',
                          borderRadius: '8px',
                          marginBottom: '16px',
                          border: '2px solid #fbbf24'
                        }}>
                          <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '14px' }}>
                            ⚠️ No Input Fields Detected
                          </div>
                          <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                            The AI analyzed your script but found <strong>no input fields</strong> to generate test data for.
                            <br/><br/>
                            <strong>Your script contains:</strong>
                            <ul style={{ marginTop: '8px', marginBottom: '8px', paddingLeft: '20px' }}>
                              <li>Page navigation</li>
                              <li>Element clicks</li>
                              <li>No form inputs (fill, type, select, etc.)</li>
                            </ul>
                            <strong>💡 To generate test data:</strong>
                            <ol style={{ marginTop: '8px', paddingLeft: '20px' }}>
                              <li>Select a script with input fields (login forms, registration, search, etc.)</li>
                              <li>Or upload a script that uses <code>.fill()</code>, <code>.type()</code>, <code>.selectOption()</code></li>
                              <li>The AI will detect fields like username, email, password, etc. and generate test data</li>
                            </ol>
                          </div>
                        </div>
                      );
                    }
                    
                    return (
                    <div style={{
                      background: 'rgba(255,255,255,0.95)',
                      color: '#1e293b',
                      padding: '16px',
                      borderRadius: '8px',
                      marginBottom: '16px'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: '12px', color: '#059669' }}>
                        ✅ Generated Test Data ({dataArray.length} records)
                        {generatedTestData.metadata && (
                          <span style={{ 
                            marginLeft: '12px', 
                            padding: '4px 12px', 
                            background: '#3b82f6', 
                            color: 'white', 
                            borderRadius: '6px', 
                            fontSize: '11px',
                            fontWeight: 700
                          }}>                            Type: {generatedTestData.metadata?.testDataType?.toUpperCase() || 'UNKNOWN'}
                          </span>
                        )}
                      </div>
                      <div style={{
                        maxHeight: '300px',
                        overflowY: 'auto',
                        background: '#f8fafc',
                        padding: '12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}>
                        {/* Show sample of first 3 records in a prettier format */}
                        {dataArray.slice(0, 3).map((record: any, idx: number) => (
                          <div key={idx} style={{
                            marginBottom: '12px',
                            padding: '10px',
                            background: 'white',
                            borderRadius: '6px',
                            border: '2px solid #e5e7eb'
                          }}>
                            <div style={{ fontWeight: 600, color: '#3b82f6', marginBottom: '6px' }}>
                              Record #{idx + 1}
                              {record._testDataType && (
                                <span style={{ 
                                  marginLeft: '8px',
                                  padding: '2px 8px',
                                  background: record._testDataType === 'security' ? '#ef4444' : 
                                             record._testDataType === 'boundary' ? '#f59e0b' :
                                             record._testDataType === 'negative' ? '#ec4899' : '#10b981',
                                  color: 'white',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 700
                                }}>
                                  {record._testDataType?.toUpperCase() || 'UNKNOWN'}
                                </span>
                              )}
                            </div>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '11px' }}>
                              {JSON.stringify(record, null, 2)}
                            </pre>
                          </div>
                        ))}
                        {dataArray.length > 3 && (
                          <div style={{ marginTop: '12px', padding: '8px', background: '#fef3c7', borderRadius: '6px', fontSize: '11px', textAlign: 'center', color: '#92400e' }}>
                            ... and {dataArray.length - 3} more records (click "View All" below)
                          </div>
                        )}
                      </div>
                      
                      {/* Full JSON view (collapsible) */}
                      <details style={{ marginTop: '12px' }}>
                        <summary style={{ cursor: 'pointer', padding: '8px', background: '#e0f2fe', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: '#0369a1' }}>
                          📄 View All Records (Full JSON)
                        </summary>
                        <div style={{
                          marginTop: '8px',
                          maxHeight: '300px',
                          overflowY: 'auto',
                          background: '#f8fafc',
                          padding: '12px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontFamily: 'monospace'
                        }}>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {JSON.stringify(dataArray, null, 2)}
                          </pre>
                        </div>
                      </details>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(dataArray, null, 2));
                          alert('✅ Test data copied to clipboard!');
                        }}
                        style={{
                          marginTop: '12px',
                          padding: '8px 16px',
                          background: '#059669',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        📋 Copy to Clipboard
                      </button>
                    </div>
                  );  
                })()}

                  {/* Test Scenarios */}
                  {testDataRecommendation?.test_scenarios && (
                    <div style={{
                      background: 'rgba(255,255,255,0.95)',
                      color: '#1e293b',
                      padding: '16px',
                      borderRadius: '8px'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: '12px', color: '#059669' }}>🎯 Recommended Test Scenarios:</div>
                      {testDataRecommendation.test_scenarios.map((scenario: any, idx: number) => (
                        <div key={idx} style={{
                          padding: '10px',
                          background: '#f0fdf4',
                          borderRadius: '6px',
                          marginBottom: '8px',
                          fontSize: '12px'
                        }}>
                          <div style={{ fontWeight: 600, color: '#059669', marginBottom: '4px' }}>
                            {scenario.type?.toUpperCase() || 'UNKNOWN'}: {scenario.count} records
                          </div>
                          <div style={{ color: '#6b7280' }}>{scenario.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Inline Field Binding (after test data, before suggestions review) */}
              {generatedTestData && (() => {
                const dataArr = Array.isArray(generatedTestData.data)
                  ? generatedTestData.data
                  : generatedTestData.data?.data || [];
                if (dataArr.length === 0) return null;
                return (
                  <div data-testid="inline-field-binding" style={{
                    marginBottom: '24px',
                    padding: '20px',
                    background: '#f0f4ff',
                    borderRadius: '12px',
                    border: '2px solid #818cf8'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#4338ca', margin: 0 }}>
                        🔗 Bind Test Data Fields to Script
                      </h4>
                      <button
                        data-testid="inline-auto-detect-btn"
                        onClick={extractPlaceholders}
                        disabled={extractingPlaceholders}
                        style={{
                          padding: '6px 14px',
                          background: extractingPlaceholders ? '#9ca3af' : '#6366f1',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: extractingPlaceholders ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {extractingPlaceholders ? '⏳ Detecting...' : '🔍 Auto-Detect'}
                      </button>
                    </div>
                    {bindingPlaceholders.length > 0 ? (
                      <div data-testid="inline-binding-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {bindingPlaceholders.map((ph) => (
                          <div key={ph.name} data-testid={`inline-binding-row-${ph.name}`} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px 10px', background: 'white', borderRadius: '6px',
                            border: fieldBindings[ph.name] ? '1px solid #10b981' : '1px solid #e2e8f0'
                          }}>
                            <code data-testid={`inline-placeholder-${ph.name}`} style={{ padding: '2px 6px', background: '#eef2ff', borderRadius: '4px', fontSize: '11px', fontWeight: 600, color: '#4338ca' }}>
                              {`{{${ph.name}}}`}
                            </code>
                            <span style={{ color: '#6366f1', fontWeight: 700 }}>&rarr;</span>
                            <select
                              data-testid={`inline-binding-select-${ph.name}`}
                              value={fieldBindings[ph.name] || ''}
                              onChange={(e) => setFieldBindings(prev => ({ ...prev, [ph.name]: e.target.value }))}
                              style={{
                                flex: 1, padding: '6px', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '11px'
                              }}
                            >
                              <option value="">-- Select field --</option>
                              {getAvailableDataFields().map(f => (
                                <option key={f} value={f}>{f}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p data-testid="inline-empty-state" style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', margin: '12px 0' }}>
                        Click "Auto-Detect" to find {'{{placeholder}}'} patterns and selector fields in your script.
                      </p>
                    )}
                    {Object.keys(fieldBindings).filter(k => fieldBindings[k]).length > 0 && (
                      <div data-testid="inline-binding-summary" style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span data-testid="inline-binding-count" style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>
                          {Object.keys(fieldBindings).filter(k => fieldBindings[k]).length}/{bindingPlaceholders.length} bound &middot; {dataArr.length} rows
                        </span>
                        <button
                          data-testid="inline-save-ddr-btn"
                          onClick={saveFieldBindings}
                          disabled={savingBindings || bindingSaved}
                          style={{
                            padding: '8px 16px',
                            background: bindingSaved ? '#10b981' : savingBindings ? '#9ca3af' : '#6366f1',
                            color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                            cursor: savingBindings || bindingSaved ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {bindingSaved ? '✅ DDR Created!' : savingBindings ? '⏳ Saving...' : '💾 Create Data-Driven Run'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: 600 }}>🔍 Review & Accept Suggestions</h3>
              
              {/* XPath Analysis Results */}
              {xpathAnalysis && (
                <div style={{
                  marginBottom: '24px',
                  padding: '16px',
                  background: '#f0fdf4',
                  border: '2px solid #10b981',
                  borderRadius: '8px'
                }}>
                  <h4 style={{ 
                    fontSize: '15px', 
                    fontWeight: 600, 
                    marginBottom: '12px',
                    color: '#047857',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    🔍 XPath Analysis Results
                  </h4>
                  
                  {xpathAnalysis.found ? (
                    <>
                      <p style={{ marginBottom: '12px', color: '#065f46' }}>
                        Found <strong>{xpathAnalysis.count}</strong> XPath expression{xpathAnalysis.count > 1 ? 's' : ''}
                      </p>
                      
                      {xpathAnalysis.analyses.map((analysis: any, idx: number) => (
                        <div key={idx} style={{
                          marginTop: '12px',
                          padding: '12px',
                          background: 'white',
                          borderRadius: '6px',
                          border: '1px solid #d1fae5'
                        }}>
                          <div style={{ 
                            fontSize: '13px', 
                            fontFamily: 'monospace',
                            marginBottom: '8px',
                            color: '#374151',
                            wordBreak: 'break-all'
                          }}>
                            <strong>XPath:</strong> {analysis.xpath}
                          </div>
                          
                          {analysis.error ? (
                            <div style={{ color: '#ef4444' }}>⚠️ {analysis.error}</div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                <span style={{ 
                                  padding: '4px 8px', 
                                  background: '#dbeafe', 
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: 500
                                }}>
                                  Type: {analysis.type}
                                </span>
                                <span style={{ 
                                  padding: '4px 8px', 
                                  background: analysis.stability === 'high' ? '#d1fae5' : analysis.stability === 'medium' ? '#fef3c7' : '#fee2e2',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: 500
                                }}>
                                  Stability: {analysis.stability}
                                </span>
                                <span style={{ 
                                  padding: '4px 8px', 
                                  background: '#f3e8ff', 
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: 500
                                }}>
                                  Complexity: {analysis.complexity_score}/100
                                </span>
                              </div>
                              
                              {analysis.issues && analysis.issues.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#dc2626', marginBottom: '4px' }}>
                                    ⚠️ Issues:
                                  </div>
                                  {analysis.issues.map((issue: string, i: number) => (
                                    <div key={i} style={{ fontSize: '12px', color: '#991b1b', marginLeft: '12px' }}>
                                      • {issue}
                                    </div>
                                  ))}
                                </div>
                              )}
                              
                              {/* GPT-4o Analysis */}
                              {analysis.gpt4_analysis && (
                                <div style={{
                                  marginTop: '12px',
                                  padding: '12px',
                                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                  color: 'white',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  lineHeight: '1.5'
                                }}>
                                  <div style={{ fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    🤖 GPT-4o Analysis:
                                  </div>
                                  <div style={{ whiteSpace: 'pre-wrap', opacity: 0.95 }}>
                                    {typeof analysis.gpt4_analysis === 'string' 
                                      ? analysis.gpt4_analysis 
                                      : JSON.stringify(analysis.gpt4_analysis, null, 2)}
                                  </div>
                                </div>
                              )}
                              
                              {analysis.ai_recommendation && (
                                <div style={{ 
                                  marginTop: '12px',
                                  padding: '12px',
                                  background: '#ecfdf5',
                                  border: '2px solid #10b981',
                                  borderRadius: '8px'
                                }}>
                                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#047857', marginBottom: '8px' }}>
                                    🎯 Old vs New Comparison:
                                  </div>
                                  
                                  {/* Old XPath */}
                                  <div style={{ marginBottom: '12px' }}>
                                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#dc2626', marginBottom: '4px' }}>
                                      ❌ Old (XPath):
                                    </div>
                                    <code style={{ 
                                      fontSize: '12px', 
                                      color: '#991b1b',
                                      display: 'block',
                                      padding: '8px',
                                      background: '#fee2e2',
                                      borderRadius: '4px',
                                      wordBreak: 'break-all'
                                    }}>
                                      {analysis.xpath}
                                    </code>
                                  </div>
                                  
                                  {/* New Recommendation */}
                                  <div>
                                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#047857', marginBottom: '4px' }}>
                                      ✅ New (Recommended):
                                    </div>
                                    <code style={{ 
                                      fontSize: '12px', 
                                      color: '#065f46',
                                      display: 'block',
                                      padding: '8px',
                                      background: '#d1fae5',
                                      borderRadius: '4px',
                                      marginBottom: '8px',
                                      wordBreak: 'break-all'
                                    }}>
                                      {typeof analysis.ai_recommendation === 'object' && analysis.ai_recommendation.locator
                                        ? analysis.ai_recommendation.locator
                                        : typeof analysis.ai_recommendation === 'string'
                                        ? analysis.ai_recommendation
                                        : JSON.stringify(analysis.ai_recommendation, null, 2)}
                                    </code>
                                    {typeof analysis.ai_recommendation === 'object' && analysis.ai_recommendation.reasoning && (
                                      <div style={{ fontSize: '11px', color: '#047857', fontStyle: 'italic' }}>
                                        💡 {analysis.ai_recommendation.reasoning}
                                      </div>
                                    )}
                                    {typeof analysis.ai_recommendation === 'object' && analysis.ai_recommendation.confidence !== undefined && (
                                      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                                        Confidence: {Math.round(analysis.ai_recommendation.confidence * 100)}%
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </>
                  ) : (
                    <p style={{ color: '#6b7280' }}>
                      {xpathAnalysis.message || xpathAnalysis.error || 'No XPath expressions found'}
                    </p>
                  )}
                </div>
              )}
              
              {/* Visual AI Analysis Results */}
              {visualAIAnalysis && (
                <div style={{
                  marginBottom: '24px',
                  padding: '16px',
                  background: '#faf5ff',
                  border: '2px solid #8b5cf6',
                  borderRadius: '8px'
                }}>
                  <h4 style={{ 
                    fontSize: '15px', 
                    fontWeight: 600, 
                    marginBottom: '12px',
                    color: '#6b21a8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    🇺 Visual AI Screenshot Analysis
                  </h4>
                  
                  {visualAIAnalysis.found ? (
                    <>
                      <p style={{ marginBottom: '12px', color: '#6b21a8' }}>
                        Found <strong>{visualAIAnalysis.count}</strong> screenshot command{visualAIAnalysis.count > 1 ? 's' : ''}
                      </p>
                      
                      {visualAIAnalysis.recommendations && visualAIAnalysis.recommendations.map((rec: any, idx: number) => (
                        <div key={idx} style={{
                          marginTop: '12px',
                          padding: '12px',
                          background: 'white',
                          borderRadius: '6px',
                          border: '1px solid #e9d5ff'
                        }}>
                          <div style={{ 
                            fontSize: '13px', 
                            fontWeight: 600,
                            marginBottom: '8px',
                            color: '#6b21a8'
                          }}>
                            📸 {rec.screenshot_type || 'Screenshot Assertion'}
                          </div>
                          
                          {rec.suggestions && (
                            <div style={{ marginBottom: '8px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#047857', marginBottom: '4px' }}>
                                ✅ Recommendations:
                              </div>
                              {rec.suggestions.map((suggestion: string, i: number) => (
                                <div key={i} style={{ fontSize: '12px', color: '#374151', marginLeft: '12px', marginBottom: '4px' }}>
                                  • {suggestion}
                                </div>
                              ))}
                            </div>
                          )}
                          
                          {rec.best_practices && (
                            <div style={{ marginTop: '8px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb', marginBottom: '4px' }}>
                                💡 Best Practices:
                              </div>
                              {rec.best_practices.map((practice: string, i: number) => (
                                <div key={i} style={{ fontSize: '12px', color: '#374151', marginLeft: '12px', marginBottom: '4px' }}>
                                  • {practice}
                                </div>
                              ))}
                            </div>
                          )}

                          {rec.example_code && (
                            <div style={{ 
                              marginTop: '12px',
                              padding: '8px',
                              background: '#f3e8ff',
                              borderRadius: '6px'
                            }}>
                              <div style={{ fontSize: '11px', fontWeight: 600, color: '#6b21a8', marginBottom: '4px' }}>
                                📝 Example Code:
                              </div>
                              <code style={{ 
                                fontSize: '11px', 
                                color: '#4c1d95',
                                display: 'block',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all'
                              }}>
                                {rec.example_code}
                              </code>
                            </div>
                          )}
                        </div>
                      ))}
                      
                      {visualAIAnalysis.gpt4_analysis && (
                        <div style={{
                          marginTop: '12px',
                          padding: '12px',
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          color: 'white',
                          borderRadius: '8px',
                          fontSize: '13px',
                          lineHeight: '1.5'
                        }}>
                          <div style={{ fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            🤖 GPT-4o Visual AI Analysis:
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap', opacity: 0.95 }}>
                            {typeof visualAIAnalysis.gpt4_analysis === 'string'
                              ? visualAIAnalysis.gpt4_analysis
                              : JSON.stringify(visualAIAnalysis.gpt4_analysis, null, 2)}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ color: '#6b7280' }}>
                      {visualAIAnalysis.message || visualAIAnalysis.error || 'No screenshot assertions found'}
                    </p>
                  )}

                </div>
              )}

              {/* Screenshot Comparison Tool */}
              {analyzeVisualAI && (
                <div style={{
                  marginBottom: '24px',
                  padding: '20px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  borderRadius: '12px',
                  boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
                }}>
                  <h4 style={{ 
                    fontSize: '16px', 
                    fontWeight: 700, 
                    marginBottom: '16px',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    📸 Real Screenshot Comparison (Node.js Backend)
                  </h4>
                  
                  <div style={{ 
                    background: 'white', 
                    padding: '20px', 
                    borderRadius: '8px',
                    marginBottom: '16px'
                  }}>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: '1fr 1fr', 
                      gap: '20px',
                      marginBottom: '16px'
                    }}>
                      {/* Baseline Screenshot */}
                      <div>
                        <label style={{ 
                          display: 'block', 
                          fontWeight: 600, 
                          marginBottom: '8px',
                          color: '#374151',
                          fontSize: '14px'
                        }}>
                          📷 Baseline Screenshot
                        </label>
                        <input 
                          type="file" 
                          accept="image/*"
                          onChange={handleBaselineUpload}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: '12px',
                            border: '2px dashed #8b5cf6',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '13px'
                          }}
                        />
                        {baselineScreenshot && (
                          <div style={{ 
                            marginTop: '8px', 
                            fontSize: '13px', 
                            color: '#10b981',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            ✅ {baselineScreenshot.name}
                          </div>
                        )}
                      </div>
                      
                      {/* Current Screenshot */}
                      <div>
                        <label style={{ 
                          display: 'block', 
                          fontWeight: 600, 
                          marginBottom: '8px',
                          color: '#374151',
                          fontSize: '14px'
                        }}>
                          📷 Current Screenshot
                        </label>
                        <input 
                          type="file" 
                          accept="image/*"
                          onChange={handleCurrentUpload}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: '12px',
                            border: '2px dashed #8b5cf6',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '13px'
                          }}
                        />
                        {currentScreenshot && (
                          <div style={{ 
                            marginTop: '8px', 
                            fontSize: '13px', 
                            color: '#10b981',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            ✅ {currentScreenshot.name}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <button
                      onClick={compareScreenshots}
                      disabled={!baselineScreenshot || !currentScreenshot || comparingScreenshots}
                      style={{
                        width: '100%',
                        padding: '12px 24px',
                        background: baselineScreenshot && currentScreenshot ? '#8b5cf6' : '#cbd5e1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '15px',
                        fontWeight: 600,
                        cursor: baselineScreenshot && currentScreenshot ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s'
                      }}
                    >
                      {comparingScreenshots ? '⏳ Comparing...' : '🔍 Compare Screenshots'}
                    </button>
                  </div>

                  {/* Comparison Results */}
                  {screenshotComparison && (
                    <div style={{
                      background: 'white',
                      padding: '20px',
                      borderRadius: '8px'
                    }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '12px',
                        marginBottom: '16px'
                      }}>
                        <div style={{
                          fontSize: '24px',
                          fontWeight: 'bold',
                          color: screenshotComparison.verdict === 'PASS' ? '#10b981' : '#ef4444'
                        }}>
                          {screenshotComparison.verdict === 'PASS' ? '✅ PASS' : '❌ FAIL'}
                        </div>
                        <div style={{ fontSize: '16px', color: '#6b7280' }}>
                          Similarity: <strong>{(screenshotComparison.similarity * 100).toFixed(2)}%</strong>
                        </div>
                      </div>

                      {/* Similarity Metrics */}
                      {screenshotComparison.similarity_metrics && (
                        <div style={{
                          background: '#f3f4f6',
                          padding: '12px',
                          borderRadius: '6px',
                          marginBottom: '16px'
                        }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                            📊 Metrics:
                          </div>
                          <div style={{ fontSize: '12px', color: '#374151' }}>
                            • Pixel Similarity: {(screenshotComparison.similarity_metrics.pixel_similarity * 100).toFixed(2)}%<br/>
                            • Pixel Difference: {screenshotComparison.similarity_metrics.pixel_difference_percent}%<br/>
                            • Dimensions: {screenshotComparison.similarity_metrics.before_dimensions}
                          </div>
                        </div>
                      )}

                      {/* Changes Detected */}
                      {screenshotComparison.changes && screenshotComparison.changes.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                            ⚠️ Changes Detected:
                          </div>
                          {screenshotComparison.changes.map((change: any, idx: number) => (
                            <div key={idx} style={{
                              padding: '8px 12px',
                              background: '#fef3c7',
                              borderLeft: '4px solid #f59e0b',
                              borderRadius: '4px',
                              marginBottom: '8px',
                              fontSize: '12px'
                            }}>
                              <strong>{change.type}:</strong> {change.description}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Playwright Code Suggestion */}
                      {screenshotComparison.suggested_playwright_code && (
                        <div style={{
                          background: '#f0fdf4',
                          padding: '12px',
                          borderRadius: '6px',
                          border: '1px solid #10b981'
                        }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#047857', marginBottom: '8px' }}>
                            💡 Suggested Playwright Code:
                          </div>
                          <code style={{
                            fontSize: '11px',
                            color: '#065f46',
                            display: 'block',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            marginBottom: '8px'
                          }}>
                            {typeof screenshotComparison.suggested_playwright_code.assertion === 'string'
                              ? screenshotComparison.suggested_playwright_code.assertion
                              : JSON.stringify(screenshotComparison.suggested_playwright_code.assertion, null, 2)}
                          </code>
                          <div style={{ fontSize: '11px', color: '#6b7280' }}>
                            Options: {typeof screenshotComparison.suggested_playwright_code.options === 'string'
                              ? screenshotComparison.suggested_playwright_code.options
                              : JSON.stringify(screenshotComparison.suggested_playwright_code.options, null, 2)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              {/* Upload Analysis Results - GPT-4o */}
              {uploadAnalysis && (
                <div style={{
                  marginBottom: '24px',
                  padding: '16px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  borderRadius: '12px',
                  boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
                }}>
                  <h4 style={{ 
                    fontSize: '16px', 
                    fontWeight: 700, 
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    🤖 GPT-4o Script Analysis: {uploadAnalysis.filename}
                  </h4>
                  
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                    gap: '12px',
                    marginBottom: '16px'
                  }}>
                    <div style={{ background: 'rgba(255,255,255,0.2)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{uploadAnalysis.xpath_count}</div>
                      <div style={{ fontSize: '12px', opacity: 0.9 }}>XPaths Found</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.2)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{uploadAnalysis.summary?.low_stability || 0}</div>
                      <div style={{ fontSize: '12px', opacity: 0.9 }}>Low Stability</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.2)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{uploadAnalysis.summary?.avg_complexity?.toFixed(0) || 0}</div>
                      <div style={{ fontSize: '12px', opacity: 0.9 }}>Avg Complexity</div>
                    </div>
                  </div>

                  {uploadAnalysis.gpt4_script_analysis && (
                    <div style={{
                      background: 'rgba(255,255,255,0.95)',
                      color: '#1e293b',
                      padding: '16px',
                      borderRadius: '8px',
                      marginBottom: '16px',
                      fontSize: '14px',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: '8px', color: '#667eea' }}>📝 Overall Analysis:</div>
                      {typeof uploadAnalysis.gpt4_script_analysis === 'string'
                        ? uploadAnalysis.gpt4_script_analysis
                        : JSON.stringify(uploadAnalysis.gpt4_script_analysis, null, 2)}
                    </div>
                  )}

                  {uploadAnalysis.xpaths_analyzed && uploadAnalysis.xpaths_analyzed.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: '12px', fontSize: '15px' }}>
                        🔍 Detailed XPath Analysis:
                      </div>
                      {uploadAnalysis.xpaths_analyzed.map((analysis: any, idx: number) => (
                        <div key={idx} style={{
                          background: 'rgba(255,255,255,0.95)',
                          color: '#1e293b',
                          padding: '16px',
                          borderRadius: '8px',
                          marginBottom: '12px'
                        }}>
                          <div style={{ 
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            marginBottom: '12px',
                            padding: '8px',
                            background: '#f1f5f9',
                            borderRadius: '4px',
                            wordBreak: 'break-all'
                          }}>
                            {analysis.xpath}
                          </div>

                          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                            <span style={{ 
                              padding: '4px 10px', 
                              background: '#dbeafe', 
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#1e40af'
                            }}>
                              {analysis.type}
                            </span>
                            <span style={{ 
                              padding: '4px 10px', 
                              background: analysis.stability === 'high' ? '#d1fae5' : analysis.stability === 'medium' ? '#fef3c7' : '#fee2e2',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: analysis.stability === 'high' ? '#065f46' : analysis.stability === 'medium' ? '#92400e' : '#991b1b'
                            }}>
                              {analysis.stability} stability
                            </span>
                            <span style={{ 
                              padding: '4px 10px', 
                              background: '#f3e8ff', 
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#6b21a8'
                            }}>
                              {analysis.complexity_score}/100 complexity
                            </span>
                          </div>

                          {analysis.issues && analysis.issues.length > 0 && (
                            <div style={{ marginBottom: '12px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, color: '#dc2626', marginBottom: '6px' }}>
                                ⚠️ Issues:
                              </div>
                              {analysis.issues.map((issue: string, i: number) => (
                                <div key={i} style={{ fontSize: '12px', color: '#7f1d1d', marginLeft: '12px', marginBottom: '2px' }}>
                                  • {issue}
                                </div>
                              ))}
                            </div>
                          )}

                          {analysis.gpt4_recommendation && (
                            <div style={{
                              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                              color: 'white',
                              padding: '12px',
                              borderRadius: '8px',
                              fontSize: '13px',
                              lineHeight: '1.5'
                            }}>
                              <div style={{ fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                🤖 GPT-4o Recommendation:
                              </div>
                              <div style={{ whiteSpace: 'pre-wrap', opacity: 0.95 }}>
                                {typeof analysis.gpt4_recommendation === 'string'
                                  ? analysis.gpt4_recommendation
                                  : JSON.stringify(analysis.gpt4_recommendation, null, 2)}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {uploadAnalysis.recommendations && (
                    <div style={{ marginTop: '16px' }}>
                      <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '14px' }}>
                        💡 General Recommendations:
                      </div>
                      {uploadAnalysis.recommendations.map((rec: string, i: number) => (
                        <div key={i} style={{ 
                          fontSize: '13px', 
                          marginBottom: '6px',
                          paddingLeft: '12px',
                          opacity: 0.95
                        }}>
                          • {rec}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              {enhancement.suggestions.length === 0 ? (
                <div className="no-suggestions">
                  <p>✨ Great! No improvements needed - your script looks good!</p>
                </div>
              ) : (
                enhancement.suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className={`suggestion-card ${selectedSuggestions.has(index) ? 'selected' : ''}`}
                  >
                    <div className="suggestion-header">
                      <input
                        type="checkbox"
                        checked={selectedSuggestions.has(index)}
                        onChange={() => toggleSuggestion(index)}
                      />
                      <span
                        className="category-badge"
                        style={{ backgroundColor: getCategoryColor(suggestion.category) }}
                      >
                        {getCategoryIcon(suggestion.category)} {suggestion.category}
                      </span>
                      <span className="confidence-badge">
                        {Math.round(suggestion.confidence * 100)}% confidence
                      </span>
                      <span className="line-number">Line {suggestion.lineNumber}</span>
                    </div>
                    <p className="suggestion-reason">{suggestion.reason}</p>
                    <div className="code-comparison">
                      <div className="code-block original">
                        <div className="code-label">Original</div>
                        <pre>{suggestion.originalCode}</pre>
                      </div>
                      <div className="arrow">→</div>
                      <div className="code-block suggested">
                        <div className="code-label">Suggested</div>
                        <pre>{suggestion.suggestedCode}</pre>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="diff-view">
              <div className="diff-container">
                {(enhancement.diff || []).map((line, idx) => (
                  <div key={idx} className={`diff-line ${line.type}`}>
                    <span className="line-num">{line.line + 1}</span>
                    <span className="line-content">{line.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary" disabled={applying}>
            Cancel
          </button>
          <button
            onClick={applyEnhancements}
            className="btn-primary"
            disabled={applying || selectedSuggestions.size === 0}
          >
            {applying ? 'Applying...' : `Apply ${selectedSuggestions.size} Enhancement${selectedSuggestions.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* Test Data Generation Modal */}
      {showTestDataModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => {
            // Close modal when clicking backdrop
            setShowTestDataModal(false);
            setTestDataSource('current');
            setSelectedTestDataProject('');
            setSelectedTestDataScript('');
          }}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
            }}
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside modal
          >
            <h3 style={{ marginBottom: '20px', fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>
              🧪 Generate Test Data - Select Source
            </h3>

            {/* Source Selection */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '12px', color: '#475569' }}>
                Choose Source:
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px',
                  border: testDataSource === 'current' ? '2px solid #10b981' : '2px solid #e2e8f0',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: testDataSource === 'current' ? '#f0fdf4' : 'white',
                  transition: 'all 0.2s'
                }}>
                  <input
                    type="radio"
                    name="testDataSource"
                    value="current"
                    checked={testDataSource === 'current'}
                    onChange={(e) => setTestDataSource(e.target.value as any)}
                    style={{ cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>📝 Use Current Script</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Generate from currently loaded script</div>
                  </div>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px',
                  border: testDataSource === 'database' ? '2px solid #10b981' : '2px solid #e2e8f0',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: testDataSource === 'database' ? '#f0fdf4' : 'white',
                  transition: 'all 0.2s'
                }}>
                  <input
                    type="radio"
                    name="testDataSource"
                    value="database"
                    checked={testDataSource === 'database'}
                    onChange={(e) => setTestDataSource(e.target.value as any)}
                    style={{ cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>🗃️ Select from Database</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Pick a project and script from database</div>
                  </div>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px',
                  border: testDataSource === 'upload' ? '2px solid #10b981' : '2px solid #e2e8f0',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: testDataSource === 'upload' ? '#f0fdf4' : 'white',
                  transition: 'all 0.2s'
                }}>
                  <input
                    type="radio"
                    name="testDataSource"
                    value="upload"
                    checked={testDataSource === 'upload'}
                    onChange={(e) => setTestDataSource(e.target.value as any)}
                    style={{ cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>📄 Upload Script File</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Upload a .ts, .js, or .spec file</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Database Selection */}
            {testDataSource === 'database' && (
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px', color: '#475569' }}>
                  📁 Select Project:
                </label>
                <select
                  value={selectedTestDataProject}
                  onChange={(e) => {
                    setSelectedTestDataProject(e.target.value);
                    setSelectedTestDataScript('');
                    if (e.target.value) {
                      loadScripts(e.target.value);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()} // Prevent modal close
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '2px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '14px',
                    marginBottom: '16px'
                  }}
                >
                  <option value="">-- Select a project --</option>
                  {projects.map((project: any) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>

                {selectedTestDataProject && (
                  <>
                    <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px', color: '#475569' }}>
                      📜 Select Script:
                    </label>
                    <select
                      value={selectedTestDataScript}
                      onChange={(e) => setSelectedTestDataScript(e.target.value)}
                      onClick={(e) => e.stopPropagation()} // Prevent modal close
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '2px solid #e2e8f0',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    >
                      <option value="">-- Select a script --</option>
                      {scripts.map((script: any) => (
                        <option key={script.id} value={script.id}>
                          {script.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}

            {/* File Upload */}
            {testDataSource === 'upload' && (
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px', color: '#475569' }}>
                  📄 Upload Playwright Script:
                </label>
                <input
                  type="file"
                  accept=".ts,.js,.spec.ts,.spec.js"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setUploadedFile(file);
                  }}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '2px dashed #10b981',
                    borderRadius: '6px',
                    fontSize: '14px',
                    background: '#f0fdf4',
                    cursor: 'pointer'
                  }}
                />
                {uploadedFile && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#059669', fontWeight: 500 }}>
                    ✅ Selected: {uploadedFile.name}
                  </div>
                )}
              </div>
            )}

            {/* Test Data Type & Count Selection */}
            <div 
              style={{ marginBottom: '24px', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}
              onClick={(e) => e.stopPropagation()} // Prevent modal close when clicking inside
            >
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: '#1e293b' }}>
                ⚙️ Test Data Configuration
              </h4>
              
              {/* Test Data Type */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px', color: '#475569', fontSize: '13px' }}>
                  🎯 Select Test Data Type:
                </label>
                <select
                  value={testDataType}
                  onChange={(e) => setTestDataType(e.target.value as any)}
                  onClick={(e) => e.stopPropagation()} // Prevent modal close
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '2px solid #10b981',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: 500,
                    background: 'white',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">✨ All Types (Comprehensive)</option>
                  <option value="positive">✅ Positive Testing (Valid Data)</option>
                  <option value="negative">❌ Negative Testing (Invalid Data)</option>
                  <option value="boundary">📊 Boundary Value Analysis</option>
                  <option value="equivalence">📦 Equivalence Partitioning</option>
                  <option value="security">🔒 Security Testing (SQL Injection, XSS)</option>
                </select>
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>
                  {testDataType === 'all' && '• Generates mix of positive, negative, boundary, and security test cases'}
                  {testDataType === 'positive' && '• Valid data within expected ranges and formats'}
                  {testDataType === 'negative' && '• Invalid data: empty, null, wrong types, special characters'}
                  {testDataType === 'boundary' && '• Min, max, just below/above limits, edge cases'}
                  {testDataType === 'equivalence' && '• Representative values from each equivalence class'}
                  {testDataType === 'security' && '• SQL injection, XSS, script tags, malicious payloads'}
                </div>
              </div>

              {/* Test Data Count */}
              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px', color: '#475569', fontSize: '13px' }}>
                  🔢 Number of Records:
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={testDataCount}
                    onChange={(e) => setTestDataCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 10)))}
                    onClick={(e) => e.stopPropagation()} // Prevent modal close
                    style={{
                      flex: 1,
                      padding: '10px',
                      border: '2px solid #10b981',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 500
                    }}
                  />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTestDataCount(5);
                      }}
                      style={{
                        padding: '8px 12px',
                        background: testDataCount === 5 ? '#10b981' : '#e2e8f0',
                        color: testDataCount === 5 ? 'white' : '#64748b',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      5
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTestDataCount(10);
                      }}
                      style={{
                        padding: '8px 12px',
                        background: testDataCount === 10 ? '#10b981' : '#e2e8f0',
                        color: testDataCount === 10 ? 'white' : '#64748b',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      10
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTestDataCount(25);
                      }}
                      style={{
                        padding: '8px 12px',
                        background: testDataCount === 25 ? '#10b981' : '#e2e8f0',
                        color: testDataCount === 25 ? 'white' : '#64748b',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      25
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTestDataCount(50);
                      }}
                      style={{
                        padding: '8px 12px',
                        background: testDataCount === 50 ? '#10b981' : '#e2e8f0',
                        color: testDataCount === 50 ? 'white' : '#64748b',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      50
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#64748b' }}>
                  • Recommended: 5-10 for quick tests, 25-50 for comprehensive coverage
                </div>
              </div>
            </div>

            {/* Test Data Results - Show INSIDE the modal */}
            {(testDataRecommendation || generatedTestData) && (
              <div style={{
                marginTop: '24px',
                marginBottom: '24px',
                padding: '16px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
              }}>
                <h4 style={{ 
                  fontSize: '16px', 
                  fontWeight: 700, 
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  🧪 Test Data Generation Results
                </h4>

                {/* Detected Fields */}
                {testDataRecommendation?.detected_fields && testDataRecommendation.detected_fields.length > 0 && (
                  <div style={{
                    background: 'rgba(255,255,255,0.95)',
                    color: '#1e293b',
                    padding: '12px',
                    borderRadius: '8px',
                    marginBottom: '12px'
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '8px', color: '#059669', fontSize: '13px' }}>
                      📊 Detected Fields ({testDataRecommendation.detected_fields.length}):
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}>
                      {testDataRecommendation.detected_fields.map((field: any, idx: number) => (
                        <div key={idx} style={{
                          padding: '6px',
                          background: '#f0fdf4',
                          borderRadius: '4px',
                          fontSize: '11px'
                        }}>
                          <div style={{ fontWeight: 600, color: '#059669' }}>{field.field}</div>
                          <div style={{ color: '#6b7280', fontSize: '10px' }}>{field.type}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Generated Test Data */}
                {generatedTestData && (() => {
                  const dataArray = Array.isArray(generatedTestData.data) 
                    ? generatedTestData.data 
                    : generatedTestData.data?.data || [];
                  
                  if (dataArray.length === 0) return null;
                  
                  return (
                    <div style={{
                      background: 'rgba(255,255,255,0.98)',
                      color: '#1e293b',
                      padding: '16px',
                      borderRadius: '8px',
                      marginBottom: '12px'
                    }}>
                      <div style={{ 
                        fontWeight: 700, 
                        marginBottom: '12px', 
                        color: '#059669', 
                        fontSize: '15px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span>✅ Generated Test Data ({dataArray.length} records)</span>
                        {generatedTestData.metadata && (
                          <span style={{
                            padding: '4px 12px',
                            background: '#3b82f6',
                            color: 'white',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700
                          }}>
                            {generatedTestData.metadata?.testDataType?.toUpperCase() || 'MIXED'}
                          </span>
                        )}
                      </div>
                      <div style={{
                        maxHeight: '400px',
                        overflowY: 'auto',
                        background: '#f8fafc',
                        padding: '12px',
                        borderRadius: '6px',
                        fontSize: '11px'
                      }}>
                        {dataArray.map((record: any, idx: number) => (
                          <div key={idx} style={{
                            marginBottom: '10px',
                            padding: '10px',
                            background: 'white',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb'
                          }}>
                            <div style={{
                              fontWeight: 600,
                              color: '#3b82f6',
                              marginBottom: '6px',
                              fontSize: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}>
                              <span>Record #{idx + 1}</span>
                              {record._testDataType && (
                                <span style={{
                                  padding: '2px 8px',
                                  background: record._testDataType === 'security' ? '#ef4444' :
                                             record._testDataType === 'boundary' ? '#f59e0b' :
                                             record._testDataType === 'negative' ? '#ec4899' :
                                             record._testDataType === 'positive' ? '#10b981' : '#6366f1',
                                  color: 'white',
                                  borderRadius: '4px',
                                  fontSize: '10px'
                                }}>
                                  {record._testDataType.toUpperCase()}
                                </span>
                              )}
                            </div>
                            <pre style={{
                              margin: 0,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontSize: '10px',
                              fontFamily: 'monospace',
                              background: 'transparent',
                              padding: 0
                            }}>
                              {JSON.stringify(record, null, 2)}
                            </pre>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(dataArray, null, 2));
                          alert(`✅ ${dataArray.length} test records copied to clipboard!`);
                        }}
                        style={{
                          marginTop: '10px',
                          padding: '8px 16px',
                          background: '#059669',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          width: '100%'
                        }}
                      >
                        📋 Copy All {dataArray.length} Records to Clipboard
                      </button>
                    </div>
                  );
                })()}

                {/* GPT-4o Recommendation */}
                {testDataRecommendation?.gpt4_recommendation && (
                  <div style={{
                    background: 'rgba(255,255,255,0.95)',
                    color: '#1e293b',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px', color: '#059669' }}>🤖 GPT-4o Recommendations:</div>
                    {testDataRecommendation.gpt4_recommendation}
                  </div>
                )}
              </div>
            )}

            {/* ── Field Binding Section ─────────────────────────────── */}
            {generatedTestData && (() => {
              const dataArray = Array.isArray(generatedTestData.data)
                ? generatedTestData.data
                : generatedTestData.data?.data || [];
              if (dataArray.length === 0) return null;

              return (
                <div data-testid="modal-field-binding" style={{
                  marginTop: '24px',
                  marginBottom: '24px',
                  padding: '20px',
                  background: '#f0f4ff',
                  borderRadius: '12px',
                  border: '2px solid #818cf8'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px'
                  }}>
                    <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#4338ca', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      🔗 Field Binding
                    </h4>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        data-testid="modal-auto-detect-btn"
                        onClick={extractPlaceholders}
                        disabled={extractingPlaceholders}
                        style={{
                          padding: '6px 14px',
                          background: extractingPlaceholders ? '#9ca3af' : '#6366f1',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: extractingPlaceholders ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {extractingPlaceholders ? '⏳ Detecting...' : '🔍 Auto-Detect Fields'}
                      </button>
                      <button
                        data-testid="modal-clear-bindings-btn"
                        onClick={() => { setBindingPlaceholders([]); setFieldBindings({}); setBindingSaved(false); }}
                        style={{
                          padding: '6px 14px',
                          background: '#e2e8f0',
                          color: '#475569',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <p style={{ fontSize: '12px', color: '#6366f1', marginBottom: '16px', lineHeight: '1.5' }}>
                    Map {'{{placeholder}}'} patterns in your script to generated test data fields. Click "Auto-Detect" to scan the enhanced script, or add bindings manually below.
                  </p>

                  {/* Detected Placeholders & Binding Table */}
                  {bindingPlaceholders.length > 0 ? (
                    <div data-testid="modal-binding-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                      {bindingPlaceholders.map((ph) => (
                        <div key={ph.name} data-testid={`modal-binding-row-${ph.name}`} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px 12px',
                          background: 'white',
                          borderRadius: '8px',
                          border: fieldBindings[ph.name] ? '1px solid #10b981' : '1px solid #e2e8f0'
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <code data-testid={`modal-placeholder-${ph.name}`} style={{
                                padding: '2px 8px',
                                background: '#eef2ff',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: '#4338ca'
                              }}>
                                {`{{${ph.name}}}`}
                              </code>
                              {ph.line > 0 && (
                                <span style={{ fontSize: '10px', color: '#94a3b8' }}>Line {ph.line}</span>
                              )}
                            </div>
                            {ph.context && (
                              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ph.context}
                              </div>
                            )}
                          </div>
                          <span style={{ color: '#6366f1', fontWeight: 700, fontSize: '14px' }}>&rarr;</span>
                          <select
                            data-testid={`modal-binding-select-${ph.name}`}
                            value={fieldBindings[ph.name] || ''}
                            onChange={(e) => setFieldBindings(prev => ({ ...prev, [ph.name]: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: '180px',
                              padding: '8px',
                              border: fieldBindings[ph.name] ? '2px solid #10b981' : '2px solid #e2e8f0',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 500,
                              background: fieldBindings[ph.name] ? '#f0fdf4' : 'white'
                            }}
                          >
                            <option value="">-- Select field --</option>
                            {getAvailableDataFields().map(f => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div data-testid="modal-empty-state" style={{
                      padding: '16px',
                      background: 'white',
                      borderRadius: '8px',
                      border: '1px dashed #c7d2fe',
                      textAlign: 'center',
                      marginBottom: '16px'
                    }}>
                      <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                        No placeholders detected yet. Click "Auto-Detect Fields" or add manually below.
                      </p>
                    </div>
                  )}

                  {/* Manual Placeholder Addition */}
                  <div data-testid="modal-manual-binding" style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    padding: '12px',
                    background: 'white',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '16px'
                  }}>
                    <input
                      data-testid="modal-manual-placeholder-input"
                      type="text"
                      placeholder="Placeholder name"
                      value={manualPlaceholderName}
                      onChange={(e) => setManualPlaceholderName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}
                    />
                    <select
                      data-testid="modal-manual-field-select"
                      value={manualPlaceholderField}
                      onChange={(e) => setManualPlaceholderField(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '150px',
                        padding: '8px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}
                    >
                      <option value="">-- Field --</option>
                      {getAvailableDataFields().map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <button
                      data-testid="modal-manual-add-btn"
                      onClick={() => {
                        if (manualPlaceholderName && manualPlaceholderField) {
                          setBindingPlaceholders(prev => [...prev, { name: manualPlaceholderName, line: 0, context: '' }]);
                          setFieldBindings(prev => ({ ...prev, [manualPlaceholderName]: manualPlaceholderField }));
                          setManualPlaceholderName('');
                          setManualPlaceholderField('');
                        }
                      }}
                      style={{
                        padding: '8px 12px',
                        background: '#6366f1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      + Add
                    </button>
                  </div>

                  {/* Binding Summary & Save */}
                  {Object.keys(fieldBindings).length > 0 && (
                    <div data-testid="modal-binding-summary" style={{
                      padding: '12px',
                      background: '#ecfdf5',
                      borderRadius: '8px',
                      border: '1px solid #6ee7b7',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div data-testid="modal-binding-count" style={{ fontSize: '13px', fontWeight: 600, color: '#059669' }}>
                          {Object.keys(fieldBindings).filter(k => fieldBindings[k]).length} of {bindingPlaceholders.length} fields bound
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                          {dataArray.length} data rows &middot; Ready to create data-driven run
                        </div>
                      </div>
                      <button
                        data-testid="modal-save-ddr-btn"
                        onClick={saveFieldBindings}
                        disabled={savingBindings || bindingSaved}
                        style={{
                          padding: '10px 20px',
                          background: bindingSaved
                            ? '#10b981'
                            : savingBindings
                              ? '#9ca3af'
                              : 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '13px',
                          fontWeight: 700,
                          cursor: savingBindings || bindingSaved ? 'not-allowed' : 'pointer',
                          boxShadow: '0 2px 8px rgba(99,102,241,0.3)'
                        }}
                      >
                        {bindingSaved ? '✅ Data-Driven Run Created!' : savingBindings ? '⏳ Saving...' : '💾 Save & Create Data-Driven Run'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowTestDataModal(false);
                  setTestDataSource('current');
                  setSelectedTestDataProject('');
                  setSelectedTestDataScript('');
                  // Clear results when closing
                  setTestDataRecommendation(null);
                  setGeneratedTestData(null);
                  // Clear binding state
                  setBindingPlaceholders([]);
                  setFieldBindings({});
                  setBindingSaved(false);
                }}
                style={{
                  padding: '10px 20px',
                  background: '#e2e8f0',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {generatedTestData ? 'Close' : 'Cancel'}
              </button>
              <button
                onClick={generateTestData}
                disabled={generatingTestData}
                style={{
                  padding: '10px 20px',
                  background: generatingTestData ? '#9ca3af' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: generatingTestData ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                {generatingTestData ? '⏳ Generating...' : '✅ Generate Test Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScriptEnhancementModal;
