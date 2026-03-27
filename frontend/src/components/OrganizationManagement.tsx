import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './OrganizationManagement.css';

const API_URL = 'http://localhost:3001/api';

interface Organization {
  id: string;
  name: string;
  slug: string;
  subscription: string;
  maxConcurrentRuns: number;
  maxUsers: number;
  createdAt: string;
}

interface Member {
  userId: string;
  userName: string;
  userEmail: string;
  role: string;
  joinedAt: string;
}

interface Environment {
  id: string;
  name: string;
  type: string;
  config: any;
  createdAt: string;
}

const OrganizationManagement: React.FC = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'environments' | 'settings'>('overview');
  const [loading, setLoading] = useState(false);

  // Create Organization Form
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');

  // Invite Member Form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');

  // Create Environment Form
  const [showCreateEnv, setShowCreateEnv] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvType, setNewEnvType] = useState('development');

  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    loadOrganizations();
  }, []);

  useEffect(() => {
    if (selectedOrg) {
      loadOrgDetails();
    }
  }, [selectedOrg, activeTab]);

  const loadOrganizations = async () => {
    try {
      const res = await axios.get(`${API_URL}/organizations/my-organizations`, { headers });
      setOrganizations(res.data.organizations || res.data.data || []);
      if (res.data.organizations?.length > 0 && !selectedOrg) {
        setSelectedOrg(res.data.organizations[0]);
      }
    } catch (error) {
      console.error('Error loading organizations:', error);
    }
  };

  const loadOrgDetails = async () => {
    if (!selectedOrg) return;
    
    setLoading(true);
    try {
      if (activeTab === 'members') {
        const res = await axios.get(
          `${API_URL}/organizations/${selectedOrg.slug}/members`,
          { headers: { ...headers, 'X-Organization': selectedOrg.slug } }
        );
        setMembers(res.data.members || res.data.data || []);
      } else if (activeTab === 'environments') {
        const res = await axios.get(
          `${API_URL}/organizations/${selectedOrg.slug}/environments`,
          { headers: { ...headers, 'X-Organization': selectedOrg.slug } }
        );
        setEnvironments(res.data.environments || res.data.data || []);
      }
    } catch (error) {
      console.error('Error loading organization details:', error);
    } finally {
      setLoading(false);
    }
  };

  const createOrganization = async () => {
    if (!newOrgName.trim()) {
      alert('Organization name is required');
      return;
    }

    try {
      const res = await axios.post(
        `${API_URL}/organizations`,
        {
          name: newOrgName,
          slug: newOrgSlug || newOrgName.toLowerCase().replace(/\s+/g, '-'),
          subscription: 'free',
          maxConcurrentRuns: 5,
          maxUsers: 10
        },
        { headers }
      );
      
      await loadOrganizations();
      setShowCreateOrg(false);
      setNewOrgName('');
      setNewOrgSlug('');
      alert('Organization created successfully!');
    } catch (error: any) {
      console.error('Error creating organization:', error);
      alert('Failed to create organization: ' + (error.response?.data?.error || error.message));
    }
  };

  const inviteMember = async () => {
    if (!inviteEmail.trim() || !selectedOrg) return;

    try {
      await axios.post(
        `${API_URL}/organizations/${selectedOrg.slug}/invite`,
        { email: inviteEmail, role: inviteRole },
        { headers: { ...headers, 'X-Organization': selectedOrg.slug } }
      );
      
      await loadOrgDetails();
      setShowInvite(false);
      setInviteEmail('');
      alert('User invited successfully!');
    } catch (error: any) {
      console.error('Error inviting user:', error);
      alert('Failed to invite user: ' + (error.response?.data?.error || error.message));
    }
  };

  const createEnvironment = async () => {
    if (!newEnvName.trim() || !selectedOrg) return;

    try {
      await axios.post(
        `${API_URL}/organizations/${selectedOrg.slug}/environments`,
        { name: newEnvName, type: newEnvType, config: {} },
        { headers: { ...headers, 'X-Organization': selectedOrg.slug } }
      );
      
      await loadOrgDetails();
      setShowCreateEnv(false);
      setNewEnvName('');
      alert('Environment created successfully!');
    } catch (error: any) {
      console.error('Error creating environment:', error);
      alert('Failed to create environment: ' + (error.response?.data?.error || error.message));
    }
  };

  const updateMemberRole = async (userId: string, newRole: string) => {
    if (!selectedOrg) return;

    try {
      await axios.patch(
        `${API_URL}/organizations/${selectedOrg.slug}/members/${userId}/role`,
        { role: newRole },
        { headers: { ...headers, 'X-Organization': selectedOrg.slug } }
      );
      
      await loadOrgDetails();
      alert('Member role updated successfully!');
    } catch (error: any) {
      console.error('Error updating role:', error);
      alert('Failed to update role: ' + (error.response?.data?.error || error.message));
    }
  };

  const removeMember = async (userId: string) => {
    if (!selectedOrg || !confirm('Are you sure you want to remove this member?')) return;

    try {
      await axios.delete(
        `${API_URL}/organizations/${selectedOrg.slug}/members/${userId}`,
        { headers: { ...headers, 'X-Organization': selectedOrg.slug } }
      );
      
      await loadOrgDetails();
      alert('Member removed successfully!');
    } catch (error: any) {
      console.error('Error removing member:', error);
      alert('Failed to remove member: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="org-management">
      <div className="org-header">
        <h1>🏢 Organization Management</h1>
        <button className="btn-primary" onClick={() => setShowCreateOrg(true)}>
          ➕ Create Organization
        </button>
      </div>

      <div className="org-layout">
        {/* Organization Selector */}
        <div className="org-selector">
          <h3>Your Organizations</h3>
          <div className="org-list">
            {organizations.map(org => (
              <div
                key={org.id}
                className={`org-item ${selectedOrg?.id === org.id ? 'active' : ''}`}
                onClick={() => setSelectedOrg(org)}
              >
                <div className="org-icon">🏢</div>
                <div className="org-info">
                  <div className="org-name">{org.name}</div>
                  <div className="org-slug">@{org.slug}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Organization Details */}
        {selectedOrg && (
          <div className="org-details">
            <div className="org-tabs">
              <button
                className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                📊 Overview
              </button>
              <button
                className={`tab ${activeTab === 'members' ? 'active' : ''}`}
                onClick={() => setActiveTab('members')}
              >
                👥 Members ({members.length})
              </button>
              <button
                className={`tab ${activeTab === 'environments' ? 'active' : ''}`}
                onClick={() => setActiveTab('environments')}
              >
                🌍 Environments ({environments.length})
              </button>
              <button
                className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveTab('settings')}
              >
                ⚙️ Settings
              </button>
            </div>

            <div className="tab-content">
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="overview">
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-icon">👥</div>
                      <div className="stat-value">{members.length}</div>
                      <div className="stat-label">Team Members</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">🌍</div>
                      <div className="stat-value">{environments.length}</div>
                      <div className="stat-label">Environments</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">🚀</div>
                      <div className="stat-value">{selectedOrg.maxConcurrentRuns}</div>
                      <div className="stat-label">Max Concurrent Runs</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">💼</div>
                      <div className="stat-value">{selectedOrg.subscription}</div>
                      <div className="stat-label">Subscription</div>
                    </div>
                  </div>

                  <div className="info-card">
                    <h3>Organization Details</h3>
                    <div className="info-row">
                      <span className="label">Name:</span>
                      <span className="value">{selectedOrg.name}</span>
                    </div>
                    <div className="info-row">
                      <span className="label">Slug:</span>
                      <span className="value">@{selectedOrg.slug}</span>
                    </div>
                    <div className="info-row">
                      <span className="label">Created:</span>
                      <span className="value">{new Date(selectedOrg.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="info-row">
                      <span className="label">Max Users:</span>
                      <span className="value">{selectedOrg.maxUsers}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Members Tab */}
              {activeTab === 'members' && (
                <div className="members">
                  <div className="section-header">
                    <h3>Team Members</h3>
                    <button className="btn-primary" onClick={() => setShowInvite(true)}>
                      ➕ Invite Member
                    </button>
                  </div>

                  {loading ? (
                    <div className="loading">Loading members...</div>
                  ) : (
                    <div className="members-list">
                      {members.map(member => (
                        <div key={member.userId} className="member-card">
                          <div className="member-avatar">
                            {member.userName.charAt(0).toUpperCase()}
                          </div>
                          <div className="member-info">
                            <div className="member-name">{member.userName}</div>
                            <div className="member-email">{member.userEmail}</div>
                          </div>
                          <div className="member-role">
                            <select
                              value={member.role}
                              onChange={(e) => updateMemberRole(member.userId, e.target.value)}
                              className="role-select"
                            >
                              <option value="owner">Owner</option>
                              <option value="admin">Admin</option>
                              <option value="member">Member</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </div>
                          <button
                            className="btn-danger-small"
                            onClick={() => removeMember(member.userId)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Environments Tab */}
              {activeTab === 'environments' && (
                <div className="environments">
                  <div className="section-header">
                    <h3>Test Environments</h3>
                    <button className="btn-primary" onClick={() => setShowCreateEnv(true)}>
                      ➕ Create Environment
                    </button>
                  </div>

                  {loading ? (
                    <div className="loading">Loading environments...</div>
                  ) : (
                    <div className="env-grid">
                      {environments.map(env => (
                        <div key={env.id} className="env-card">
                          <div className="env-header">
                            <div className="env-icon">
                              {env.type === 'production' && '🚀'}
                              {env.type === 'staging' && '🔧'}
                              {env.type === 'development' && '💻'}
                            </div>
                            <div className="env-type-badge">{env.type}</div>
                          </div>
                          <h4>{env.name}</h4>
                          <p className="env-meta">Created {new Date(env.createdAt).toLocaleDateString()}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="settings">
                  <h3>Organization Settings</h3>
                  <div className="settings-section">
                    <h4>General</h4>
                    <p>Organization settings and preferences</p>
                    <div className="empty-state">
                      <p>Settings configuration coming soon...</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Organization Modal */}
      {showCreateOrg && (
        <div className="modal-overlay" onClick={() => setShowCreateOrg(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Organization</h2>
            <div className="form-group">
              <label>Organization Name</label>
              <input
                type="text"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="e.g., Acme Corp"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Slug (optional)</label>
              <input
                type="text"
                value={newOrgSlug}
                onChange={(e) => setNewOrgSlug(e.target.value)}
                placeholder="e.g., acme-corp"
                className="form-input"
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreateOrg(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={createOrganization}>
                Create Organization
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Member Modal */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Invite Team Member</h2>
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="form-select"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowInvite(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={inviteMember}>
                Send Invitation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Environment Modal */}
      {showCreateEnv && (
        <div className="modal-overlay" onClick={() => setShowCreateEnv(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Environment</h2>
            <div className="form-group">
              <label>Environment Name</label>
              <input
                type="text"
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.target.value)}
                placeholder="e.g., Production"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Environment Type</label>
              <select
                value={newEnvType}
                onChange={(e) => setNewEnvType(e.target.value)}
                className="form-select"
              >
                <option value="development">Development</option>
                <option value="staging">Staging</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreateEnv(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={createEnvironment}>
                Create Environment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationManagement;