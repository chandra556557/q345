import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3001/api';

interface Organization {
  id: string;
  name: string;
  slug: string;
  role: string;
  subscription: string;
  maxConcurrentRuns: number;
  maxUsers: number;
  logoUrl?: string;
}

interface OrganizationSelectorProps {
  onOrganizationChange?: (org: Organization | null) => void;
  compact?: boolean;
}

export const OrganizationSelector: React.FC<OrganizationSelectorProps> = ({ 
  onOrganizationChange,
  compact = false 
}) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadOrganizations();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get(`${API_URL}/organizations/my-organizations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const orgs = response.data.data || [];
      setOrganizations(orgs);
      
      // Restore saved selection or select first org
      const savedSlug = localStorage.getItem('selectedOrganization');
      const savedOrg = orgs.find((o: Organization) => o.slug === savedSlug);
      
      if (savedOrg) {
        selectOrganization(savedOrg);
      } else if (orgs.length > 0) {
        selectOrganization(orgs[0]);
      }
    } catch (err) {
      console.error('Failed to load organizations:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectOrganization = (org: Organization) => {
    setSelectedOrg(org);
    setIsOpen(false);
    localStorage.setItem('selectedOrganization', org.slug);
    axios.defaults.headers.common['X-Organization'] = org.slug;
    onOrganizationChange?.(org);
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 30);
  };

  const handleNameChange = (name: string) => {
    setNewOrgName(name);
    setNewOrgSlug(generateSlug(name));
  };

  const createOrganization = async () => {
    if (!newOrgName.trim() || !newOrgSlug.trim()) return;
    
    try {
      setCreating(true);
      setError(null);
      const token = localStorage.getItem('accessToken');
      
      const response = await axios.post(
        `${API_URL}/organizations`,
        { name: newOrgName, slug: newOrgSlug },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (response.data.success) {
        setShowCreateModal(false);
        setNewOrgName('');
        setNewOrgSlug('');
        await loadOrganizations();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner': return '#10b981';
      case 'admin': return '#3b82f6';
      case 'developer': return '#8b5cf6';
      default: return '#6b7280';
    }
  };

  const getSubscriptionBadge = (subscription: string) => {
    switch (subscription) {
      case 'enterprise': return { color: '#f59e0b', label: 'Enterprise' };
      case 'professional': return { color: '#8b5cf6', label: 'Pro' };
      case 'starter': return { color: '#3b82f6', label: 'Starter' };
      default: return { color: '#6b7280', label: 'Free' };
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.skeleton}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={styles.container} ref={dropdownRef}>
      {/* Selector Button */}
      <button 
        style={styles.selectorButton}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={styles.orgInfo}>
          {selectedOrg?.logoUrl ? (
            <img src={selectedOrg.logoUrl} alt="" style={styles.orgLogo} />
          ) : (
            <div style={styles.orgInitial}>
              {selectedOrg?.name?.[0]?.toUpperCase() || 'O'}
            </div>
          )}
          {!compact && (
            <div style={styles.orgDetails}>
              <span style={styles.orgName}>{selectedOrg?.name || 'Select Organization'}</span>
              {selectedOrg && (
                <span style={{
                  ...styles.roleBadge,
                  backgroundColor: getRoleBadgeColor(selectedOrg.role)
                }}>
                  {selectedOrg.role}
                </span>
              )}
            </div>
          )}
        </div>
        <svg 
          style={{ 
            ...styles.chevron, 
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' 
          }} 
          viewBox="0 0 20 20" 
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div style={styles.dropdown}>
          <div style={styles.dropdownHeader}>
            <span style={styles.dropdownTitle}>Organizations</span>
            <button 
              style={styles.createButton}
              onClick={() => setShowCreateModal(true)}
            >
              + New
            </button>
          </div>
          
          <div style={styles.orgList}>
            {organizations.map((org) => {
              const subBadge = getSubscriptionBadge(org.subscription);
              return (
                <button
                  key={org.id}
                  style={{
                    ...styles.orgItem,
                    backgroundColor: selectedOrg?.id === org.id ? '#f3f4f6' : 'transparent'
                  }}
                  onClick={() => selectOrganization(org)}
                >
                  <div style={styles.orgItemLeft}>
                    {org.logoUrl ? (
                      <img src={org.logoUrl} alt="" style={styles.orgItemLogo} />
                    ) : (
                      <div style={styles.orgItemInitial}>
                        {org.name[0]?.toUpperCase()}
                      </div>
                    )}
                    <div style={styles.orgItemInfo}>
                      <span style={styles.orgItemName}>{org.name}</span>
                      <span style={styles.orgItemSlug}>/{org.slug}</span>
                    </div>
                  </div>
                  <div style={styles.orgItemRight}>
                    <span style={{
                      ...styles.subscriptionBadge,
                      backgroundColor: subBadge.color
                    }}>
                      {subBadge.label}
                    </span>
                    <span style={{
                      ...styles.roleBadgeSmall,
                      backgroundColor: getRoleBadgeColor(org.role)
                    }}>
                      {org.role}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          
          {organizations.length === 0 && (
            <div style={styles.emptyState}>
              <p>No organizations yet</p>
              <button 
                style={styles.createFirstButton}
                onClick={() => setShowCreateModal(true)}
              >
                Create your first organization
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create Organization Modal */}
      {showCreateModal && (
        <div style={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Create Organization</h3>
            
            {error && (
              <div style={styles.errorAlert}>{error}</div>
            )}
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Organization Name</label>
              <input
                type="text"
                value={newOrgName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Team"
                style={styles.input}
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>URL Slug</label>
              <div style={styles.slugInputWrapper}>
                <span style={styles.slugPrefix}>/</span>
                <input
                  type="text"
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-team"
                  style={styles.slugInput}
                />
              </div>
              <span style={styles.hint}>Only lowercase letters, numbers, and hyphens</span>
            </div>
            
            <div style={styles.modalActions}>
              <button 
                style={styles.cancelButton}
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button 
                style={styles.submitButton}
                onClick={createOrganization}
                disabled={creating || !newOrgName.trim() || !newOrgSlug.trim()}
              >
                {creating ? 'Creating...' : 'Create Organization'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  skeleton: {
    padding: '8px 12px',
    backgroundColor: '#f3f4f6',
    borderRadius: '8px',
    color: '#9ca3af',
    fontSize: '14px',
  },
  selectorButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    minWidth: '200px',
    transition: 'all 0.2s',
  },
  orgInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  orgLogo: {
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    objectFit: 'cover' as const,
  },
  orgInitial: {
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: '14px',
  },
  orgDetails: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: '2px',
  },
  orgName: {
    fontWeight: 500,
    fontSize: '14px',
    color: '#111827',
  },
  roleBadge: {
    fontSize: '10px',
    fontWeight: 500,
    color: '#ffffff',
    padding: '2px 6px',
    borderRadius: '4px',
    textTransform: 'capitalize' as const,
  },
  chevron: {
    width: '16px',
    height: '16px',
    color: '#6b7280',
    transition: 'transform 0.2s',
  },
  dropdown: {
    position: 'absolute' as const,
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    minWidth: '280px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    zIndex: 1000,
    overflow: 'hidden',
  },
  dropdownHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
  },
  dropdownTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  createButton: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#3b82f6',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
  },
  orgList: {
    maxHeight: '300px',
    overflowY: 'auto' as const,
    padding: '8px',
  },
  orgItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background-color 0.15s',
  },
  orgItemLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  orgItemLogo: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    objectFit: 'cover' as const,
  },
  orgItemInitial: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    backgroundColor: '#e5e7eb',
    color: '#374151',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: '14px',
  },
  orgItemInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  orgItemName: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#111827',
  },
  orgItemSlug: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  orgItemRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  subscriptionBadge: {
    fontSize: '10px',
    fontWeight: 500,
    color: '#ffffff',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  roleBadgeSmall: {
    fontSize: '9px',
    fontWeight: 500,
    color: '#ffffff',
    padding: '2px 5px',
    borderRadius: '4px',
    textTransform: 'capitalize' as const,
  },
  emptyState: {
    padding: '24px',
    textAlign: 'center' as const,
    color: '#6b7280',
  },
  createFirstButton: {
    marginTop: '12px',
    padding: '8px 16px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '24px',
    width: '400px',
    maxWidth: '90vw',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '20px',
  },
  errorAlert: {
    padding: '12px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    color: '#dc2626',
    fontSize: '14px',
    marginBottom: '16px',
  },
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  slugInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  slugPrefix: {
    padding: '10px 8px 10px 12px',
    backgroundColor: '#f9fafb',
    color: '#6b7280',
    fontSize: '14px',
  },
  slugInput: {
    flex: 1,
    padding: '10px 12px 10px 4px',
    border: 'none',
    fontSize: '14px',
    outline: 'none',
  },
  hint: {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '4px',
    display: 'block',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px',
  },
  cancelButton: {
    padding: '10px 16px',
    backgroundColor: '#ffffff',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    cursor: 'pointer',
  },
  submitButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#ffffff',
    cursor: 'pointer',
  },
};

export default OrganizationSelector;
