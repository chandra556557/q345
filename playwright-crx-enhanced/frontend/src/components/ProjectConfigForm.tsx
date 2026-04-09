import React, { useState, useEffect } from 'react';

interface ProjectConfig {
  id?: string;
  name: string;
  description?: string;
  baseUrl: string;
  apiBaseUrl?: string;
  environment: string;
  dbHost?: string;
  dbPort?: number | string;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
  tags?: string;
  envVars?: Record<string, string>;
}

interface ProjectConfigFormProps {
  project?: ProjectConfig | null;
  onSave: (config: ProjectConfig) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

const ENVIRONMENTS = ['development', 'staging', 'production', 'qa', 'uat'];

const ProjectConfigForm: React.FC<ProjectConfigFormProps> = ({ project, onSave, onCancel, saving }) => {
  const [form, setForm] = useState<ProjectConfig>({
    name: '',
    baseUrl: '',
    apiBaseUrl: '',
    environment: 'development',
    tags: '',
    dbHost: '',
    dbPort: '',
    dbName: '',
    dbUser: '',
    dbPassword: '',
    envVars: {},
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');

  useEffect(() => {
    if (project) {
      setForm({
        name: project.name || '',
        description: project.description || '',
        baseUrl: project.baseUrl || '',
        apiBaseUrl: project.apiBaseUrl || '',
        environment: project.environment || 'development',
        tags: project.tags || '',
        dbHost: project.dbHost || '',
        dbPort: project.dbPort || '',
        dbName: project.dbName || '',
        dbUser: project.dbUser || '',
        dbPassword: project.dbPassword || '',
        envVars: project.envVars || {},
        ...(project.id ? { id: project.id } : {}),
      });
      if (project.dbHost || project.dbPort || project.dbName) setShowAdvanced(true);
      if (project.envVars && Object.keys(project.envVars).length > 0) setShowEnvVars(true);
    }
  }, [project]);

  const handleChange = (field: keyof ProjectConfig, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const addEnvVar = () => {
    if (envKey.trim()) {
      setForm(prev => ({ ...prev, envVars: { ...prev.envVars, [envKey.trim()]: envValue } }));
      setEnvKey('');
      setEnvValue('');
    }
  };

  const removeEnvVar = (key: string) => {
    setForm(prev => {
      const updated = { ...prev.envVars };
      delete updated[key];
      return { ...prev, envVars: updated };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-lg font-semibold text-gray-900 mb-2">
        {project?.id ? 'Edit Project Configuration' : 'Add New Project'}
      </div>

      {/* Basic Fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Project Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => handleChange('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g. SauceDemo, Staging API"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Environment</label>
          <select
            value={form.environment}
            onChange={e => handleChange('environment', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {ENVIRONMENTS.map(env => (
              <option key={env} value={env}>{env}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Base URL *</label>
        <input
          type="url"
          value={form.baseUrl}
          onChange={e => handleChange('baseUrl', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="https://saucedemo.com or http://localhost:3001"
          required
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">API Base URL</label>
        <input
          type="url"
          value={form.apiBaseUrl || ''}
          onChange={e => handleChange('apiBaseUrl', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="http://localhost:3001/api (optional)"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Default Cucumber Tags</label>
        <input
          type="text"
          value={form.tags || ''}
          onChange={e => handleChange('tags', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="@smoke, @api, @saucedemo"
        />
        <p className="text-xs text-gray-500 mt-1">Comma-separated tags applied when running with this project</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
        <input
          type="text"
          value={form.description || ''}
          onChange={e => handleChange('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Optional description"
        />
      </div>

      {/* Database Configuration (collapsible) */}
      <div className="border border-gray-200 rounded-md">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span>Database Configuration</span>
          <span className="text-gray-400">{showAdvanced ? '▲' : '▼'}</span>
        </button>
        {showAdvanced && (
          <div className="px-3 pb-3 space-y-3 border-t border-gray-200">
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">DB Host</label>
                <input
                  type="text"
                  value={form.dbHost || ''}
                  onChange={e => handleChange('dbHost', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="localhost"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">DB Port</label>
                <input
                  type="number"
                  value={form.dbPort || ''}
                  onChange={e => handleChange('dbPort', e.target.value ? parseInt(e.target.value) : '')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="5432"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">DB Name</label>
              <input
                type="text"
                value={form.dbName || ''}
                onChange={e => handleChange('dbName', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="playwright_project1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">DB User</label>
                <input
                  type="text"
                  value={form.dbUser || ''}
                  onChange={e => handleChange('dbUser', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="postgres"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">DB Password</label>
                <input
                  type="password"
                  value={form.dbPassword || ''}
                  onChange={e => handleChange('dbPassword', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  placeholder="••••••••"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Custom Environment Variables (collapsible) */}
      <div className="border border-gray-200 rounded-md">
        <button
          type="button"
          onClick={() => setShowEnvVars(!showEnvVars)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span>Custom Environment Variables</span>
          <span className="text-gray-400">{showEnvVars ? '▲' : '▼'}</span>
        </button>
        {showEnvVars && (
          <div className="px-3 pb-3 border-t border-gray-200">
            {form.envVars && Object.keys(form.envVars).length > 0 && (
              <div className="mt-2 space-y-1">
                {Object.entries(form.envVars).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 text-xs bg-gray-50 px-2 py-1 rounded">
                    <span className="font-mono font-medium text-blue-700">{key}</span>
                    <span className="text-gray-400">=</span>
                    <span className="font-mono text-gray-600 flex-1 truncate">{val}</span>
                    <button type="button" onClick={() => removeEnvVar(key)} className="text-red-500 hover:text-red-700">x</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 mt-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Key</label>
                <input
                  type="text"
                  value={envKey}
                  onChange={e => setEnvKey(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                  placeholder="VARIABLE_NAME"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Value</label>
                <input
                  type="text"
                  value={envValue}
                  onChange={e => setEnvValue(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                  placeholder="value"
                />
              </div>
              <button
                type="button"
                onClick={addEnvVar}
                className="px-3 py-1 bg-gray-100 border border-gray-300 rounded text-xs hover:bg-gray-200"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving || !(form.name || '').trim() || !(form.baseUrl || '').trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : project?.id ? 'Update Project' : 'Add Project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

export default ProjectConfigForm;
