import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Dashboard from './components/Dashboard';
import Signup from './components/Signup';
import MCPTesting from './components/MCPTesting';

// Point frontend to running backend API
const API_URL = 'http://localhost:3001/api';

// Add axios interceptor to always include token from localStorage
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      try {
        // Just verify the token is valid
        await axios.get(`${API_URL}/scripts`, { headers: { Authorization: `Bearer ${token}` } });
        setIsAuthenticated(true);
      } catch (err) {
        localStorage.removeItem('accessToken');
        delete axios.defaults.headers.common['Authorization'];
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const response = await axios.post(`${API_URL}/auth/login`, { email, password });
      const { accessToken } = response.data;
      localStorage.setItem('accessToken', accessToken);
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    }
  };

  const handleLogout = () => {
    // Clear access token
    localStorage.removeItem('accessToken');
    // Clear axios default headers
    delete axios.defaults.headers.common['Authorization'];
    // Update authentication state
    setIsAuthenticated(false);
    // Reset form fields
    setEmail('');
    setPassword('');
    setError('');
  };

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route
          path="/"
          element={
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl grid grid-cols-2">
                <div className="p-10 border-r border-gray-100 flex flex-col justify-center">
                  <h1 className="text-4xl font-bold text-gray-900 mb-3">🎭 Playwright-CRX</h1>
                  <p className="text-gray-600 text-lg">Test Automation Platform</p>
                  <div className="mt-6 text-sm text-gray-500">
                    <p>End-to-end automation, analytics, and reporting.</p>
                    <p>Sign in to access your dashboard.</p>
                  </div>
                </div>
                <div className="p-10">
                  <form onSubmit={handleLogin} className="space-y-4">
                    {error && (
                      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                        {error}
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail((e.target as HTMLInputElement).value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="demo@example.com"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword((e.target as HTMLInputElement).value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Enter password"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      Login
                    </button>

                    <div className="text-center text-sm text-gray-600 mt-4">
                      <p className="font-mono text-xs mt-1">demo@example.com / demo123</p>
                      <p className="mt-4">
                        New here? <Link to="/signup" className="text-blue-600 hover:underline">Create an account</Link>
                      </p>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          }
        />
        <Route
          path="/signup"
          element={<Signup onSuccess={() => setIsAuthenticated(true)} />}
        />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard onLogout={handleLogout} />} />
      <Route path="/mcp-testing" element={<MCPTesting />} />
    </Routes>
  );
}

export default App;