import React from 'react';
import ProjectConfigForm from './ProjectConfigForm';
import { ProjectInfo } from './useProjectManager';

interface ProjectSelectorProps {
  projects: ProjectInfo[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  selectedProject: ProjectInfo | null;
  showForm: boolean;
  editingProject: ProjectInfo | null;
  savingProject: boolean;
  onAddProject: () => void;
  onEditProject: () => void;
  onDeleteProject: (id: string) => void;
  onSaveProject: (config: any) => Promise<void>;
  onCloseForm: () => void;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  projects, selectedProjectId, onSelectProject, selectedProject,
  showForm, editingProject, savingProject,
  onAddProject, onEditProject, onDeleteProject, onSaveProject, onCloseForm,
}) => {
  return (
    <>
      {!showForm && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '12px 16px', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
          <label style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap' }}>Target Project:</label>
          <select
            value={selectedProjectId}
            onChange={e => onSelectProject(e.target.value)}
            style={{ flex: 1, maxWidth: '300px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '13px' }}
          >
            <option value="">-- Default (env config) --</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.baseUrl ? `(${p.baseUrl})` : ''} {p.environment ? `[${p.environment}]` : ''}
              </option>
            ))}
          </select>
          {selectedProject && (
            <>
              <span style={{ fontSize: '12px', color: '#1565c0', background: '#e3f2fd', padding: '3px 8px', borderRadius: '4px' }}>
                {selectedProject.baseUrl}
              </span>
              <button className="bdd-btn bdd-btn-sm bdd-btn-secondary" onClick={onEditProject} style={{ fontSize: '11px' }}>Edit</button>
              <button className="bdd-btn bdd-btn-sm bdd-btn-danger" onClick={() => onDeleteProject(selectedProjectId)} style={{ fontSize: '11px' }}>Delete</button>
            </>
          )}
          <button className="bdd-btn bdd-btn-sm bdd-btn-primary" onClick={onAddProject} style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>+ Add Project</button>
        </div>
      )}

      {showForm && (
        <div style={{ marginBottom: '16px', padding: '16px', background: '#fff', borderRadius: '8px', border: '1px solid #1565c0', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
          <ProjectConfigForm
            project={editingProject as any}
            onSave={onSaveProject}
            onCancel={onCloseForm}
            saving={savingProject}
          />
        </div>
      )}
    </>
  );
};

export default ProjectSelector;
