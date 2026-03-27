import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import './NamingConventionInput.css';

interface NamingConventionSuggestion {
  name: string;
  featureArea: string;
  testType: string;
  specificAction: string;
  environment?: string;
  description: string;
}

interface NamingConventionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

const NamingConventionInput: React.FC<NamingConventionInputProps> = ({ 
  value, 
  onChange, 
  placeholder = 'Enter script name...',
  label = 'Script Name'
}) => {
  const [suggestions, setSuggestions] = useState<NamingConventionSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Naming convention data
  const namingConventions: NamingConventionSuggestion[] = [
    {
      name: 'login_ui_positive_validCredentials_LoginSuccess',
      featureArea: 'login',
      testType: 'ui',
      specificAction: 'validCredentials',
      description: 'Positive login test with valid credentials'
    },
    {
      name: 'search_function_negative_invalidInput_SearchFailure',
      featureArea: 'search',
      testType: 'function',
      specificAction: 'invalidInput',
      description: 'Negative search test with invalid input'
    },
    {
      name: 'cart_e2e_addItemsAndViewCart_Chrome',
      featureArea: 'cart',
      testType: 'e2e',
      specificAction: 'addItemsAndViewCart',
      environment: 'Chrome',
      description: 'End-to-end cart test in Chrome browser'
    },
    {
      name: 'api_auth_getUserData_SessionToken',
      featureArea: 'api_auth',
      testType: 'api',
      specificAction: 'getUserData',
      description: 'API test for retrieving user data with session token'
    },
    {
      name: 'checkout_payment_positive_creditCard_ValidTransaction',
      featureArea: 'checkout',
      testType: 'payment',
      specificAction: 'creditCard',
      description: 'Positive payment test with credit card'
    },
    {
      name: 'user_profile_ui_editPersonalInfo_SaveChanges',
      featureArea: 'user_profile',
      testType: 'ui',
      specificAction: 'editPersonalInfo',
      description: 'UI test for editing and saving user profile'
    },
    {
      name: 'dashboard_performance_loadTime_Under3Sec',
      featureArea: 'dashboard',
      testType: 'performance',
      specificAction: 'loadTime',
      environment: 'Under3Sec',
      description: 'Performance test checking dashboard load time'
    }
  ];

  // Filter suggestions based on input
  useEffect(() => {
    if (value.trim().length > 0) {
      const filtered = namingConventions.filter(item =>
        item.name.toLowerCase().includes(value.toLowerCase()) ||
        item.featureArea.toLowerCase().includes(value.toLowerCase()) ||
        item.testType.toLowerCase().includes(value.toLowerCase()) ||
        item.specificAction.toLowerCase().includes(value.toLowerCase()) ||
        item.description.toLowerCase().includes(value.toLowerCase())
      );
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setActiveSuggestionIndex(-1);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [value]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleSuggestionClick = (suggestion: NamingConventionSuggestion) => {
    onChange(suggestion.name);
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIndex(prev => 
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
      e.preventDefault();
      handleSuggestionClick(suggestions[activeSuggestionIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestionIndex(-1);
    }
  };

  return (
    <div className="naming-convention-input" ref={wrapperRef}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => value.trim().length > 0 && setShowSuggestions(true)}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion.name}
                onClick={() => handleSuggestionClick(suggestion)}
                className={`cursor-default select-none relative py-2 pl-3 pr-9 hover:bg-blue-100 ${
                  index === activeSuggestionIndex ? 'bg-blue-100' : 'bg-white'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{suggestion.name}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    [{suggestion.featureArea}] [{suggestion.testType}]
                  </span>
                </div>
                <div className="text-gray-500 text-sm ml-3">{suggestion.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Format: [Feature Area]_[Test Type]_[Specific Action]_[Environment (optional)]
      </p>
    </div>
  );
};

export default NamingConventionInput;