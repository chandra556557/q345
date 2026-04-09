import { useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from './apiConfig';

export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  apiBaseUrl?: string;
  environment?: string;
  tags?: string;
  dbHost?: string;
  dbPort?: number;
  dbName?: string;
  dbUser?: string;
  envVars?: Record<string, string>;
}

export function useProjectManager() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectInfo | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [projectError, setProjectError] = useState('');

  const getHeaders = () => {
    const token = localStorage.getItem('accessToken');
    return { Authorization: `Bearer ${token}` };
  };

  const loadProjects = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/projects`, { headers: getHeaders() });
      setProjects(res.data.data || []);
    } catch {
      // Projects endpoint may not exist yet
    }
  }, []);

  const saveProject = async (config: any) => {
    setSavingProject(true);
    setProjectError('');
    try {
      if (config.id) {
        await axios.put(`${API_URL}/projects/${config.id}`, config, { headers: getHeaders() });
      } else {
        const res = await axios.post(`${API_URL}/projects`, config, { headers: getHeaders() });
        setSelectedProjectId(res.data.data.id);
      }
      await loadProjects();
      setShowProjectForm(false);
      setEditingProject(null);
    } catch (err: any) {
      setProjectError(err.response?.data?.error || 'Failed to save project');
    } finally {
      setSavingProject(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm('Delete this project configuration?')) return;
    try {
      await axios.delete(`${API_URL}/projects/${projectId}`, { headers: getHeaders() });
      if (selectedProjectId === projectId) setSelectedProjectId('');
      await loadProjects();
    } catch (err: any) {
      setProjectError(err.response?.data?.error || 'Failed to delete project');
    }
  };

  const openAddForm = () => { setEditingProject(null); setShowProjectForm(true); };
  const openEditForm = () => {
    setEditingProject(projects.find(p => p.id === selectedProjectId) || null);
    setShowProjectForm(true);
  };
  const closeForm = () => { setShowProjectForm(false); setEditingProject(null); };

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;

  /** Merge project default tags with user-entered tags */
  const mergeProjectTags = (userTags: string): string => {
    if (!selectedProjectId || !selectedProject?.tags) return userTags;
    const projectTags = selectedProject.tags.split(',').map(t => t.trim()).filter(Boolean);
    const userTagList = userTags ? userTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const allTags = [...new Set([...projectTags, ...userTagList])];
    return allTags.join(' and ');
  };

  return {
    projects, selectedProjectId, setSelectedProjectId,
    selectedProject,
    showProjectForm, editingProject, savingProject, projectError,
    loadProjects, saveProject, deleteProject,
    openAddForm, openEditForm, closeForm,
    mergeProjectTags,
  };
}
