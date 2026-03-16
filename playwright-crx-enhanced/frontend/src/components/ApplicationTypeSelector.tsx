import React from 'react';

export type ExecutionMode = 'headless' | 'headed' | 'api';

interface ApplicationType {
  id: ExecutionMode;
  name: string;
  description: string;
  icon: React.ReactNode;
  features: string[];
  recommended?: boolean;
}

const applicationTypes: ApplicationType[] = [
  {
    id: 'headless',
    name: 'Headless Application',
    description: 'Run browser tests without GUI for CI/CD pipelines and high-throughput testing',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <path d="M7 10h.01M12 10h.01M17 10h.01" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
    features: ['Fast execution', 'Low resource usage', 'CI/CD optimized', 'Parallel runs'],
    recommended: true,
  },
  {
    id: 'headed',
    name: 'GUI Application',
    description: 'Run tests with visible browser window for debugging and visual verification',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <polyline points="8 10 10 12 8 14" />
        <line x1="12" y1="12" x2="16" y2="12" />
      </svg>
    ),
    features: ['Visual debugging', 'Real-time viewing', 'Screenshot capture', 'Video recording'],
  },
  {
    id: 'api',
    name: 'API / Microservice',
    description: 'Execute API tests and microservice integration tests without browser',
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
    features: ['REST/GraphQL', 'Response validation', 'Performance metrics', 'Chain requests'],
  },
];

interface ApplicationTypeSelectorProps {
  value: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  disabled?: boolean;
  layout?: 'horizontal' | 'vertical' | 'grid';
}

export const ApplicationTypeSelector: React.FC<ApplicationTypeSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  layout = 'grid',
}) => {
  const getLayoutStyles = (): React.CSSProperties => {
    switch (layout) {
      case 'horizontal':
        return { display: 'flex', flexDirection: 'row', gap: '12px' };
      case 'vertical':
        return { display: 'flex', flexDirection: 'column', gap: '12px' };
      default:
        return { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' };
    }
  };

  return (
    <div style={styles.container}>
      <label style={styles.label}>Application Type</label>
      <p style={styles.description}>Select the type of application you want to test</p>
      
      <div style={getLayoutStyles()}>
        {applicationTypes.map((type) => {
          const isSelected = value === type.id;
          
          return (
            <button
              key={type.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(type.id)}
              style={{
                ...styles.typeCard,
                ...(isSelected ? styles.typeCardSelected : {}),
                ...(disabled ? styles.typeCardDisabled : {}),
              }}
            >
              {type.recommended && (
                <div style={styles.recommendedBadge}>Recommended</div>
              )}
              
              <div style={{
                ...styles.iconWrapper,
                ...(isSelected ? styles.iconWrapperSelected : {}),
              }}>
                {type.icon}
              </div>
              
              <div style={styles.typeInfo}>
                <h4 style={{
                  ...styles.typeName,
                  ...(isSelected ? styles.typeNameSelected : {}),
                }}>
                  {type.name}
                </h4>
                <p style={styles.typeDescription}>{type.description}</p>
                
                <div style={styles.featureList}>
                  {type.features.map((feature, idx) => (
                    <span key={idx} style={{
                      ...styles.featureTag,
                      ...(isSelected ? styles.featureTagSelected : {}),
                    }}>
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
              
              {isSelected && (
                <div style={styles.checkmark}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Compact version for inline use
export const ApplicationTypeSelectorCompact: React.FC<ApplicationTypeSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  return (
    <div style={styles.compactContainer}>
      {applicationTypes.map((type) => {
        const isSelected = value === type.id;
        
        return (
          <button
            key={type.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(type.id)}
            style={{
              ...styles.compactButton,
              ...(isSelected ? styles.compactButtonSelected : {}),
              ...(disabled ? styles.compactButtonDisabled : {}),
            }}
            title={type.description}
          >
            <span style={styles.compactIcon}>{type.icon}</span>
            <span style={styles.compactLabel}>{type.name}</span>
          </button>
        );
      })}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '4px',
  },
  description: {
    fontSize: '13px',
    color: '#6b7280',
    marginBottom: '16px',
    marginTop: 0,
  },
  typeCard: {
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    padding: '20px',
    backgroundColor: '#ffffff',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'all 0.2s ease',
    outline: 'none',
  },
  typeCardSelected: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
    boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.1)',
  },
  typeCardDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  recommendedBadge: {
    position: 'absolute' as const,
    top: '-10px',
    right: '12px',
    padding: '4px 10px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    fontSize: '11px',
    fontWeight: 600,
    borderRadius: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  iconWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    backgroundColor: '#f3f4f6',
    borderRadius: '12px',
    color: '#6b7280',
    marginBottom: '16px',
    transition: 'all 0.2s',
  },
  iconWrapperSelected: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
  },
  typeInfo: {
    flex: 1,
  },
  typeName: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#111827',
    margin: '0 0 8px 0',
  },
  typeNameSelected: {
    color: '#1d4ed8',
  },
  typeDescription: {
    fontSize: '13px',
    color: '#6b7280',
    lineHeight: 1.5,
    margin: '0 0 12px 0',
  },
  featureList: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '6px',
  },
  featureTag: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    padding: '4px 8px',
    borderRadius: '6px',
  },
  featureTagSelected: {
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
  },
  checkmark: {
    position: 'absolute' as const,
    top: '12px',
    right: '12px',
    width: '28px',
    height: '28px',
    backgroundColor: '#3b82f6',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
  },
  // Compact styles
  compactContainer: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  compactButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 14px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    transition: 'all 0.15s',
  },
  compactButtonSelected: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
    color: '#1d4ed8',
  },
  compactButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  compactIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactLabel: {
    whiteSpace: 'nowrap' as const,
  },
};

export default ApplicationTypeSelector;
