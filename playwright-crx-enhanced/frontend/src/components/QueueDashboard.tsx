import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3001/api';

interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

interface WorkerNode {
  id: string;
  name: string;
  hostname: string;
  status: string;
  maxConcurrency: number;
  currentLoad: number;
  lastHeartbeat: string;
  capabilities: {
    browsers: string[];
    applicationTypes: string[];
  };
}

interface QueueStatus {
  queue: {
    ready: boolean;
    metrics: QueueMetrics | null;
  };
  workers: {
    ready: boolean;
    total: number;
    active: number;
    totalCapacity: number;
    currentLoad: number;
    utilizationPercent: number;
  };
}

interface Job {
  id: string;
  name: string;
  data: {
    testRunId: string;
    scriptId: string;
    executionMode: string;
    browser: string;
  };
  timestamp: number;
  attemptsMade: number;
  failedReason?: string;
}

interface QueueDashboardProps {
  refreshInterval?: number;
  compact?: boolean;
}

export const QueueDashboard: React.FC<QueueDashboardProps> = ({
  refreshInterval = 5000,
  compact = false,
}) => {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [workers, setWorkers] = useState<WorkerNode[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobStatus, setSelectedJobStatus] = useState<string>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const headers = { Authorization: `Bearer ${token}` };

      const [statusRes, workersRes, jobsRes] = await Promise.all([
        axios.get(`${API_URL}/queue/status`, { headers }),
        axios.get(`${API_URL}/queue/workers`, { headers }),
        axios.get(`${API_URL}/queue/jobs?status=${selectedJobStatus}`, { headers }),
      ]);

      setStatus(statusRes.data.data);
      setWorkers(workersRes.data.data || []);
      setJobs(jobsRes.data.data || []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch queue status');
    } finally {
      setLoading(false);
    }
  }, [selectedJobStatus]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  const cancelJob = async (jobId: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      await axios.delete(`${API_URL}/queue/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchData();
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  };

  const retryJob = async (jobId: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      await axios.post(`${API_URL}/queue/jobs/${jobId}/retry`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchData();
    } catch (err) {
      console.error('Failed to retry job:', err);
    }
  };

  const getStatusColor = (statusStr: string) => {
    switch (statusStr) {
      case 'idle': return '#10b981';
      case 'busy': return '#f59e0b';
      case 'offline': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const formatTime = (timestamp: number | string) => {
    const date = new Date(typeof timestamp === 'number' ? timestamp : timestamp);
    return date.toLocaleTimeString();
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingState}>
          <div style={styles.spinner} />
          <span>Loading queue status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorState}>
          <span style={styles.errorIcon}>!</span>
          <span>{error}</span>
          <button style={styles.retryButton} onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  if (!status?.queue?.ready) {
    return (
      <div style={styles.container}>
        <div style={styles.disabledState}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <h3 style={styles.disabledTitle}>Queue Not Enabled</h3>
          <p style={styles.disabledText}>
            Set ENABLE_QUEUE=true in your environment to enable distributed test execution.
          </p>
        </div>
      </div>
    );
  }

  const metrics = status.queue.metrics!;

  if (compact) {
    return (
      <div style={styles.compactContainer}>
        <div style={styles.compactMetrics}>
          <MetricBadge label="Waiting" value={metrics.waiting} color="#f59e0b" />
          <MetricBadge label="Active" value={metrics.active} color="#3b82f6" />
          <MetricBadge label="Completed" value={metrics.completed} color="#10b981" />
          <MetricBadge label="Failed" value={metrics.failed} color="#ef4444" />
        </div>
        <div style={styles.compactWorkers}>
          <span style={styles.compactLabel}>Workers:</span>
          <span style={styles.compactValue}>
            {status.workers.active}/{status.workers.total}
          </span>
          <div style={styles.utilizationBar}>
            <div 
              style={{
                ...styles.utilizationFill,
                width: `${status.workers.utilizationPercent}%`,
                backgroundColor: status.workers.utilizationPercent > 80 ? '#ef4444' : 
                                 status.workers.utilizationPercent > 50 ? '#f59e0b' : '#10b981',
              }}
            />
          </div>
          <span style={styles.compactPercent}>{status.workers.utilizationPercent}%</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Queue Dashboard</h2>
          <p style={styles.subtitle}>Real-time test execution monitoring</p>
        </div>
        <div style={styles.headerActions}>
          <span style={styles.lastUpdate}>Last updated: {new Date().toLocaleTimeString()}</span>
          <button style={styles.refreshButton} onClick={fetchData}>
            Refresh
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div style={styles.metricsGrid}>
        <MetricCard 
          label="Waiting" 
          value={metrics.waiting} 
          color="#f59e0b" 
          icon="clock"
          description="Jobs in queue"
        />
        <MetricCard 
          label="Active" 
          value={metrics.active} 
          color="#3b82f6" 
          icon="play"
          description="Currently running"
        />
        <MetricCard 
          label="Completed" 
          value={metrics.completed} 
          color="#10b981" 
          icon="check"
          description="Successfully finished"
        />
        <MetricCard 
          label="Failed" 
          value={metrics.failed} 
          color="#ef4444" 
          icon="x"
          description="Need attention"
        />
        <MetricCard 
          label="Delayed" 
          value={metrics.delayed} 
          color="#8b5cf6" 
          icon="pause"
          description="Scheduled later"
        />
      </div>

      {/* Worker Pool Status */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Worker Pool</h3>
        <div style={styles.workerSummary}>
          <div style={styles.workerStat}>
            <span style={styles.workerStatLabel}>Total Workers</span>
            <span style={styles.workerStatValue}>{status.workers.total}</span>
          </div>
          <div style={styles.workerStat}>
            <span style={styles.workerStatLabel}>Active</span>
            <span style={{...styles.workerStatValue, color: '#10b981'}}>{status.workers.active}</span>
          </div>
          <div style={styles.workerStat}>
            <span style={styles.workerStatLabel}>Capacity</span>
            <span style={styles.workerStatValue}>{status.workers.totalCapacity}</span>
          </div>
          <div style={styles.workerStat}>
            <span style={styles.workerStatLabel}>Current Load</span>
            <span style={styles.workerStatValue}>{status.workers.currentLoad}</span>
          </div>
          <div style={styles.utilizationSection}>
            <span style={styles.workerStatLabel}>Utilization</span>
            <div style={styles.utilizationBarLarge}>
              <div 
                style={{
                  ...styles.utilizationFillLarge,
                  width: `${status.workers.utilizationPercent}%`,
                }}
              />
            </div>
            <span style={styles.utilizationValue}>{status.workers.utilizationPercent}%</span>
          </div>
        </div>

        {/* Worker Nodes */}
        {workers.length > 0 && (
          <div style={styles.workerList}>
            {workers.map((worker) => (
              <div key={worker.id} style={styles.workerCard}>
                <div style={styles.workerHeader}>
                  <div style={{
                    ...styles.statusDot,
                    backgroundColor: getStatusColor(worker.status),
                  }} />
                  <span style={styles.workerName}>{worker.name}</span>
                  <span style={{
                    ...styles.statusBadge,
                    backgroundColor: getStatusColor(worker.status),
                  }}>
                    {worker.status}
                  </span>
                </div>
                <div style={styles.workerDetails}>
                  <span>Host: {worker.hostname}</span>
                  <span>Load: {worker.currentLoad}/{worker.maxConcurrency}</span>
                  <span>Last heartbeat: {formatTime(worker.lastHeartbeat)}</span>
                </div>
                <div style={styles.workerCapabilities}>
                  {worker.capabilities?.browsers?.map((browser) => (
                    <span key={browser} style={styles.capabilityTag}>{browser}</span>
                  ))}
                  {worker.capabilities?.applicationTypes?.map((type) => (
                    <span key={type} style={styles.capabilityTag}>{type}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Jobs List */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Jobs</h3>
          <div style={styles.jobFilters}>
            {['waiting', 'active', 'completed', 'failed'].map((statusFilter) => (
              <button
                key={statusFilter}
                style={{
                  ...styles.filterButton,
                  ...(selectedJobStatus === statusFilter ? styles.filterButtonActive : {}),
                }}
                onClick={() => setSelectedJobStatus(statusFilter)}
              >
                {statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {jobs.length === 0 ? (
          <div style={styles.emptyJobs}>
            <p>No {selectedJobStatus} jobs</p>
          </div>
        ) : (
          <div style={styles.jobList}>
            {jobs.map((job) => (
              <div key={job.id} style={styles.jobCard}>
                <div style={styles.jobInfo}>
                  <span style={styles.jobId}>{job.id.substring(0, 8)}...</span>
                  <span style={styles.jobMode}>{job.data.executionMode}</span>
                  <span style={styles.jobBrowser}>{job.data.browser}</span>
                  <span style={styles.jobTime}>{formatTime(job.timestamp)}</span>
                  {job.attemptsMade > 0 && (
                    <span style={styles.jobAttempts}>Attempts: {job.attemptsMade}</span>
                  )}
                </div>
                <div style={styles.jobActions}>
                  {selectedJobStatus === 'failed' && (
                    <button 
                      style={styles.actionButton}
                      onClick={() => retryJob(job.id)}
                    >
                      Retry
                    </button>
                  )}
                  {['waiting', 'active'].includes(selectedJobStatus) && (
                    <button 
                      style={{...styles.actionButton, ...styles.cancelButton}}
                      onClick={() => cancelJob(job.id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: number;
  color: string;
  icon: string;
  description: string;
}> = ({ label, value, color, description }) => (
  <div style={styles.metricCard}>
    <div style={{...styles.metricIcon, backgroundColor: `${color}20`, color}}>
      <span style={styles.metricValue}>{value}</span>
    </div>
    <div style={styles.metricInfo}>
      <span style={styles.metricLabel}>{label}</span>
      <span style={styles.metricDescription}>{description}</span>
    </div>
  </div>
);

const MetricBadge: React.FC<{
  label: string;
  value: number;
  color: string;
}> = ({ label, value, color }) => (
  <div style={styles.metricBadge}>
    <span style={{...styles.badgeValue, backgroundColor: `${color}20`, color}}>{value}</span>
    <span style={styles.badgeLabel}>{label}</span>
  </div>
);

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '24px',
    backgroundColor: '#f9fafb',
    borderRadius: '16px',
  },
  loadingState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '48px',
    color: '#6b7280',
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '3px solid #e5e7eb',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '24px',
    backgroundColor: '#fef2f2',
    borderRadius: '12px',
    color: '#dc2626',
  },
  errorIcon: {
    width: '24px',
    height: '24px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
  },
  retryButton: {
    padding: '6px 12px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  disabledState: {
    textAlign: 'center' as const,
    padding: '48px',
    color: '#6b7280',
  },
  disabledTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#374151',
    margin: '16px 0 8px',
  },
  disabledText: {
    fontSize: '14px',
    maxWidth: '400px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#111827',
    margin: 0,
  },
  subtitle: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '4px 0 0',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  lastUpdate: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  refreshButton: {
    padding: '8px 16px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  metricCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '20px',
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  metricIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: {
    fontSize: '24px',
    fontWeight: 700,
  },
  metricInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  metricLabel: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#111827',
  },
  metricDescription: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '16px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#111827',
    margin: 0,
  },
  workerSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    flexWrap: 'wrap' as const,
    marginBottom: '16px',
  },
  workerStat: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  workerStatLabel: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '4px',
  },
  workerStatValue: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#111827',
  },
  utilizationSection: {
    flex: 1,
    minWidth: '200px',
  },
  utilizationBarLarge: {
    height: '8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: '8px',
  },
  utilizationFillLarge: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: '4px',
    transition: 'width 0.3s',
  },
  utilizationValue: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    marginTop: '4px',
    display: 'block',
  },
  workerList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '12px',
  },
  workerCard: {
    padding: '16px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  workerHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  workerName: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#111827',
    flex: 1,
  },
  statusBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#ffffff',
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'capitalize' as const,
  },
  workerDetails: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '12px',
  },
  workerCapabilities: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
  },
  capabilityTag: {
    fontSize: '10px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#e5e7eb',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  jobFilters: {
    display: 'flex',
    gap: '8px',
  },
  filterButton: {
    padding: '6px 12px',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: '#6b7280',
    transition: 'all 0.15s',
  },
  filterButtonActive: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
  },
  emptyJobs: {
    padding: '24px',
    textAlign: 'center' as const,
    color: '#9ca3af',
  },
  jobList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  jobCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  jobInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    fontSize: '13px',
  },
  jobId: {
    fontFamily: 'monospace',
    color: '#6b7280',
  },
  jobMode: {
    padding: '2px 8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 500,
  },
  jobBrowser: {
    color: '#6b7280',
  },
  jobTime: {
    color: '#9ca3af',
    fontSize: '12px',
  },
  jobAttempts: {
    color: '#f59e0b',
    fontSize: '12px',
  },
  jobActions: {
    display: 'flex',
    gap: '8px',
  },
  actionButton: {
    padding: '6px 12px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  },
  cancelButton: {
    backgroundColor: '#ef4444',
  },
  // Compact styles
  compactContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    padding: '12px 16px',
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  compactMetrics: {
    display: 'flex',
    gap: '12px',
  },
  metricBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  badgeValue: {
    padding: '4px 8px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 600,
  },
  badgeLabel: {
    fontSize: '12px',
    color: '#6b7280',
  },
  compactWorkers: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginLeft: 'auto',
  },
  compactLabel: {
    fontSize: '12px',
    color: '#6b7280',
  },
  compactValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#111827',
  },
  utilizationBar: {
    width: '60px',
    height: '6px',
    backgroundColor: '#e5e7eb',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  utilizationFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s',
  },
  compactPercent: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#374151',
  },
};

export default QueueDashboard;
