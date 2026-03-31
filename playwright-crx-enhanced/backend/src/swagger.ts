import swaggerJsdoc from 'swagger-jsdoc';

const swaggerDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'Playwright CRX Enhanced Backend API',
    version: '1.0.0',
    description: 'API documentation for Playwright CRX Enhanced backend',
  },
  servers: [
    { url: 'http://localhost:3001/api' },
    { url: 'http://127.0.0.1:3001/api' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      Script: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          language: { type: 'string' },
          code: { type: 'string' },
          browserType: { type: 'string' },
          viewport: {
            type: 'object',
            properties: {
              width: { type: 'number' },
              height: { type: 'number' }
            }
          },
          testIdAttribute: { type: 'string' },
          selfHealingEnabled: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          projectId: { type: 'string' }
        }
      },
      TestRun: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          scriptId: { type: 'string' },
          status: { type: 'string' },
          duration: { type: 'number' },
          errorMsg: { type: 'string' },
          startedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time' },
          environment: { type: 'string' },
          browser: { type: 'string' },
          traceUrl: { type: 'string' },
          videoUrl: { type: 'string' },
          screenshotUrls: { type: 'array', items: { type: 'string' } }
        }
      },
      AuthTokens: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' }
        }
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' }
        }
      },
      BDDFeature: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          featureContent: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          projectId: { type: 'string' },
          scenarioCount: { type: 'integer' },
          scenarios: { type: 'array', items: { $ref: '#/components/schemas/BDDScenario' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      BDDScenario: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { $ref: '#/components/schemas/BDDStep' } }
        }
      },
      BDDStep: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          keyword: { type: 'string', enum: ['Given', 'When', 'Then', 'And', 'But'] },
          text: { type: 'string' },
          dataTable: { type: 'object' },
          docString: { type: 'string' }
        }
      },
      BDDRun: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          featureId: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'running', 'passed', 'failed', 'cancelled'] },
          browser: { type: 'string' },
          executionMode: { type: 'string' },
          duration: { type: 'number' },
          totalScenarios: { type: 'integer' },
          passedScenarios: { type: 'integer' },
          failedScenarios: { type: 'integer' },
          results: { type: 'object' },
          reportUrl: { type: 'string' },
          startedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time' }
        }
      },
      BDDStepLibraryEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          pattern: { type: 'string' },
          code: { type: 'string' },
          keyword: { type: 'string', enum: ['Given', 'When', 'Then', 'And', 'But'] },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      BDDSchedule: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          featureId: { type: 'string' },
          cronExpression: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          browser: { type: 'string' },
          executionMode: { type: 'string' },
          lastRunAt: { type: 'string', format: 'date-time' },
          nextRunAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' }
        }
      }
    }
  },
  tags: [
    { name: 'Auth' },
    { name: 'Scripts' },
    { name: 'TestRuns' },
    { name: 'Extensions' },
    { name: 'TestData' },
    { name: 'Testing Strategies' },
    { name: 'BDD Features', description: 'BDD feature management (Gherkin-based)' },
    { name: 'BDD Runs', description: 'BDD test execution and reporting' },
    { name: 'BDD Step Library', description: 'Reusable BDD step definitions' },
    { name: 'BDD Schedules', description: 'Scheduled BDD test runs' },
    { name: 'Epic Pipeline', description: 'Jira Epic to Playwright test pipeline' },
    { name: 'Data-Driven Pipeline', description: 'Data-driven test generation and execution' }
  ],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' }
                },
                required: ['email', 'password']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                    tokens: { $ref: '#/components/schemas/AuthTokens' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                  name: { type: 'string' }
                },
                required: ['email', 'password', 'name']
              }
            }
          }
        },
        responses: { '201': { description: 'User registered' } }
      }
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { refreshToken: { type: 'string' } },
                required: ['refreshToken']
              }
            }
          }
        },
        responses: { '200': { description: 'Token refreshed' } }
      }
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Logged out' } }
      }
    },

    '/scripts': {
      get: {
        tags: ['Scripts'],
        summary: 'Get scripts',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'List of scripts',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Script' } } } }
          }
        }
      },
      post: {
        tags: ['Scripts'],
        summary: 'Create script',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  code: { type: 'string' },
                  language: { type: 'string' },
                  description: { type: 'string' }
                },
                required: ['name', 'code']
              }
            }
          }
        },
        responses: { '201': { description: 'Script created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Script' } } } } }
      }
    },
    '/scripts/{id}': {
      get: {
        tags: ['Scripts'],
        summary: 'Get script by id',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Script', content: { 'application/json': { schema: { $ref: '#/components/schemas/Script' } } } } }
      },
      put: {
        tags: ['Scripts'],
        summary: 'Update script',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  code: { type: 'string' },
                  language: { type: 'string' },
                  description: { type: 'string' },
                  browserType: { type: 'string' },
                  viewport: { type: 'object' },
                  testIdAttribute: { type: 'string' },
                  selfHealingEnabled: { type: 'boolean' }
                }
              }
            }
          }
        },
        responses: { '200': { description: 'Script updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Script' } } } } }
      },
      delete: {
        tags: ['Scripts'],
        summary: 'Delete script',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Script deleted' } }
      }
    },

    '/test-runs': {
      get: {
        tags: ['TestRuns'],
        summary: 'Get test runs',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'List of test runs',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TestRun' } } } }
          }
        }
      }
    },
    '/test-runs/active': {
      get: {
        tags: ['TestRuns'],
        summary: 'Get active test runs',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Active test runs' } }
      }
    },
    '/test-runs/{id}': {
      get: {
        tags: ['TestRuns'],
        summary: 'Get test run by id',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Test run', content: { 'application/json': { schema: { $ref: '#/components/schemas/TestRun' } } } } }
      }
    },
    '/test-runs/start': {
      post: {
        tags: ['TestRuns'],
        summary: 'Start a test run',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { scriptId: { type: 'string' }, environment: { type: 'string' }, browser: { type: 'string' } }, required: ['scriptId'] } } }
        },
        responses: { '201': { description: 'Test run started' } }
      }
    },
    '/test-runs/{testRunId}/stop': {
      post: {
        tags: ['TestRuns'],
        summary: 'Stop a test run',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'testRunId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Test run stopped' } }
      }
    },
    '/test-runs/report': {
      post: {
        tags: ['TestRuns'],
        summary: 'Report a completed test run',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { testName: { type: 'string' }, status: { type: 'string' } }, required: ['testName', 'status'] } } }
        },
        responses: { '201': { description: 'Test run reported' } }
      }
    },

    '/extensions/ping': {
      get: {
        tags: ['Extensions'],
        summary: 'Ping backend',
        responses: { '200': { description: 'OK' } }
      }
    },

    '/testdata/generate': {
      post: {
        tags: ['TestData'],
        summary: 'Generate test data',
        description: 'Generate various types of test data including boundary values, equivalence partitions, and security test cases',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  dataType: {
                    type: 'string',
                    enum: ['user', 'product', 'order', 'transaction', 'custom', 'boundaryValue', 'equivalencePartition', 'securityTest'],
                    description: 'Type of test data to generate'
                  },
                  count: {
                    type: 'number',
                    description: 'Number of records to generate',
                    example: 10
                  },
                  schema: {
                    type: 'object',
                    description: 'Custom schema for custom data type'
                  },
                  locale: {
                    type: 'string',
                    description: 'Locale for data generation',
                    example: 'en-US'
                  },
                  options: {
                    type: 'object',
                    properties: {
                      includeEdgeCases: { type: 'boolean', description: 'Include edge cases' },
                      includeNullValues: { type: 'boolean', description: 'Include null values' },
                      includeSpecialChars: { type: 'boolean', description: 'Include special characters' },
                      fieldName: { type: 'string', description: 'Field name for boundary/partition testing', example: 'amount' },
                      fieldType: { type: 'string', enum: ['number', 'string', 'date'], description: 'Field type for boundary testing' },
                      minValue: { type: 'number', description: 'Minimum value for boundary testing', example: 0.01 },
                      maxValue: { type: 'number', description: 'Maximum value for boundary testing', example: 999999.99 },
                      partitionType: { type: 'string', enum: ['valid', 'invalid', 'boundary', 'all'], description: 'Partition type for equivalence testing' }
                    }
                  }
                },
                required: ['dataType', 'count']
              },
              examples: {
                'boundaryValue': {
                  summary: 'Boundary Value Analysis',
                  value: {
                    dataType: 'boundaryValue',
                    count: 9,
                    options: {
                      fieldName: 'transferAmount',
                      fieldType: 'number',
                      minValue: 0.01,
                      maxValue: 999999.99
                    }
                  }
                },
                'equivalencePartition': {
                  summary: 'Equivalence Partitioning',
                  value: {
                    dataType: 'equivalencePartition',
                    count: 15,
                    options: {
                      fieldName: 'transferAmount',
                      partitionType: 'all'
                    }
                  }
                },
                'securityTest': {
                  summary: 'Security Testing Data',
                  value: {
                    dataType: 'securityTest',
                    count: 20
                  }
                },
                'user': {
                  summary: 'User Data',
                  value: {
                    dataType: 'user',
                    count: 10,
                    options: {
                      includeEdgeCases: true
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Test data generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: { type: 'object' }
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        generatedCount: { type: 'number' },
                        dataType: { type: 'string' },
                        processingTime: { type: 'number' }
                      }
                    }
                  }
                },
                examples: {
                  'boundaryValue': {
                    summary: 'Boundary Value Response',
                    value: {
                      success: true,
                      data: [
                        {
                          id: 0,
                          testType: 'boundary_value_analysis',
                          fieldName: 'transferAmount',
                          fieldType: 'number',
                          boundaryType: 'min',
                          description: 'Minimum valid value',
                          value: 0.01,
                          isValid: true,
                          expectedResult: 'accept',
                          range: { min: 0.01, max: 999999.99 }
                        }
                      ],
                      metadata: {
                        generatedCount: 1,
                        dataType: 'boundaryValue',
                        processingTime: 15
                      }
                    }
                  },
                  'equivalencePartition': {
                    summary: 'Equivalence Partition Response',
                    value: {
                      success: true,
                      data: [
                        {
                          id: 0,
                          testType: 'equivalence_partitioning',
                          fieldName: 'transferAmount',
                          partition: 'valid',
                          partitionClass: 'Small transfers',
                          value: 250,
                          range: '0.01 - 1000',
                          isValid: true,
                          expectedResult: 'accept',
                          errorCode: null,
                          testScenario: 'Test transferAmount with Small transfers'
                        }
                      ],
                      metadata: {
                        generatedCount: 1,
                        dataType: 'equivalencePartition',
                        processingTime: 12
                      }
                    }
                  },
                  'securityTest': {
                    summary: 'Security Test Response',
                    value: {
                      success: true,
                      data: [
                        {
                          id: 0,
                          testType: 'security_test',
                          attackType: 'sql_injection',
                          severity: 'critical',
                          owasp: 'A03:2021 - Injection',
                          payload: "' OR '1'='1",
                          targetField: 'login_username',
                          description: 'Classic SQLi bypass',
                          expectedBehavior: 'reject_and_sanitize',
                          bankingImpact: 'Unauthorized access to customer accounts, data breach'
                        }
                      ],
                      metadata: {
                        generatedCount: 1,
                        dataType: 'securityTest',
                        processingTime: 8
                      }
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Invalid data type' }
                  }
                }
              }
            }
          },
          '500': {
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Failed to generate test data' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/testing-strategies/security': {
      post: {
        tags: ['Testing Strategies'],
        summary: 'Generate security test data (SQL injection, XSS, CSRF, etc.)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  count: { type: 'number', default: 10, description: 'Number of test cases to generate' },
                  options: { type: 'object', description: 'Additional options for generation' },
                  useAI: { type: 'boolean', default: true, description: 'Use Python AI for generation' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Security tests generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    data: { type: 'array', items: { type: 'object' } },
                    source: { type: 'string', enum: ['python-ai', 'local'] },
                    metadata: { type: 'object' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/testing-strategies/boundary': {
      post: {
        tags: ['Testing Strategies'],
        summary: 'Generate boundary value analysis test data',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  count: { type: 'number', default: 9, description: 'Number of boundary test cases' },
                  fieldName: { type: 'string', default: 'value', description: 'Field name to test' },
                  fieldType: { type: 'string', default: 'number', enum: ['number', 'string', 'date'], description: 'Field type' },
                  minValue: { type: 'number', default: 0, description: 'Minimum valid value' },
                  maxValue: { type: 'number', default: 100, description: 'Maximum valid value' },
                  options: { type: 'object', description: 'Additional options' },
                  useAI: { type: 'boolean', default: true, description: 'Use Python AI for generation' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Boundary tests generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    data: { type: 'array', items: { type: 'object' } },
                    source: { type: 'string' },
                    metadata: { type: 'object' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/testing-strategies/equivalence': {
      post: {
        tags: ['Testing Strategies'],
        summary: 'Generate equivalence partitioning test data',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  count: { type: 'number', default: 10, description: 'Number of test cases' },
                  fieldName: { type: 'string', default: 'transferAmount', description: 'Field name to test' },
                  partitionType: { type: 'string', default: 'all', enum: ['valid', 'invalid', 'boundary', 'all'], description: 'Partition type' },
                  options: { type: 'object', description: 'Additional options' },
                  useAI: { type: 'boolean', default: true, description: 'Use Python AI for generation' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Equivalence tests generated successfully'
          }
        }
      }
    },
    '/testing-strategies/analyze-security': {
      post: {
        tags: ['Testing Strategies'],
        summary: 'Analyze script for security vulnerabilities using Python AI',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scriptCode: { type: 'string', description: 'Playwright script code to analyze' },
                  scriptId: { type: 'string', description: 'Script ID (optional)' }
                },
                required: ['scriptCode']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Security analysis completed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    data: {
                      type: 'object',
                      properties: {
                        vulnerabilities: { type: 'array' },
                        recommendations: { type: 'array' },
                        riskScore: { type: 'number' }
                      }
                    },
                    source: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/testing-strategies/generate-comprehensive': {
      post: {
        tags: ['Testing Strategies'],
        summary: 'Generate comprehensive test suite using Python AI',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scriptCode: { type: 'string', description: 'Script code to analyze' },
                  scriptId: { type: 'string', description: 'Script ID' },
                  includeSecurityTests: { type: 'boolean', default: true },
                  includeBoundaryTests: { type: 'boolean', default: true },
                  includeEquivalenceTests: { type: 'boolean', default: true },
                  count: { type: 'number', default: 5, description: 'Test cases per category' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Comprehensive test suite generated successfully'
          }
        }
      }
    },

    // ─── BDD Features ───────────────────────────────────────────────
    '/bdd/features': {
      get: {
        tags: ['BDD Features'],
        summary: 'List all BDD features',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by name or description' },
          { name: 'tags', in: 'query', schema: { type: 'string' }, description: 'Comma-separated tags filter' },
          { name: 'projectId', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': {
            description: 'Paginated list of BDD features',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/BDDFeature' } }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' } } } } } } }
          }
        }
      },
      post: {
        tags: ['BDD Features'],
        summary: 'Create a new BDD feature',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Feature name' },
                  description: { type: 'string', description: 'Feature description' },
                  featureContent: { type: 'string', description: 'Gherkin feature file content' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Feature tags' },
                  projectId: { type: 'string', description: 'Project ID' }
                },
                required: ['name', 'featureContent']
              }
            }
          }
        },
        responses: {
          '201': { description: 'Feature created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/BDDFeature' } } } } } },
          '400': { description: 'Invalid Gherkin syntax or missing fields' }
        }
      }
    },
    '/bdd/features/{id}': {
      get: {
        tags: ['BDD Features'],
        summary: 'Get a BDD feature with scenarios and steps',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Feature details', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/BDDFeature' } } } } } },
          '404': { description: 'Feature not found' }
        }
      },
      put: {
        tags: ['BDD Features'],
        summary: 'Update a BDD feature',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  featureContent: { type: 'string', description: 'Updated Gherkin content (re-parses scenarios/steps)' },
                  tags: { type: 'array', items: { type: 'string' } },
                  projectId: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Feature updated' },
          '404': { description: 'Feature not found' }
        }
      },
      delete: {
        tags: ['BDD Features'],
        summary: 'Delete a BDD feature and cascading runs/schedules',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Feature deleted' },
          '404': { description: 'Feature not found' }
        }
      }
    },
    '/bdd/features/{id}/generate': {
      post: {
        tags: ['BDD Features'],
        summary: 'Generate Playwright test code from a BDD feature',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Playwright code generated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { playwrightCode: { type: 'string' } } } } } } } },
          '404': { description: 'Feature not found' }
        }
      }
    },
    '/bdd/parse': {
      post: {
        tags: ['BDD Features'],
        summary: 'Parse Gherkin feature content (preview without saving)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  featureContent: { type: 'string', description: 'Gherkin content to parse' },
                  language: { type: 'string', enum: ['typescript', 'java', 'java-cucumber'], default: 'typescript' }
                },
                required: ['featureContent']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Parsed feature', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { parsed: { type: 'object' }, playwrightCode: { type: 'string' }, language: { type: 'string' } } } } } } } },
          '400': { description: 'Invalid Gherkin syntax' }
        }
      }
    },
    '/bdd/convert': {
      post: {
        tags: ['BDD Features'],
        summary: 'Convert test cases to Gherkin format',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary', description: 'CSV/Excel file with test cases' }
                }
              }
            },
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: 'Raw test case content' },
                  filename: { type: 'string', description: 'Optional filename hint' }
                },
                required: ['content']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Converted to Gherkin', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { gherkin: { type: 'string' }, scenarioCount: { type: 'integer' }, warnings: { type: 'array', items: { type: 'string' } } } } } } } } }
        }
      }
    },

    // ─── BDD Runs ────────────────────────────────────────────────────
    '/bdd/features/{id}/run': {
      post: {
        tags: ['BDD Runs'],
        summary: 'Execute a BDD feature run',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Feature ID' }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scenarioId: { type: 'string', description: 'Run a specific scenario only' },
                  browser: { type: 'string', enum: ['chromium', 'firefox', 'webkit'], default: 'chromium' },
                  executionMode: { type: 'string', enum: ['sequential', 'parallel'], default: 'sequential' },
                  stepDefinitions: { type: 'object', description: 'Custom step definition overrides' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Filter scenarios by tags' },
                  parallelWorkers: { type: 'integer', default: 2 },
                  retryCount: { type: 'integer', minimum: 0, maximum: 5, default: 0 },
                  retryDelayMs: { type: 'integer', default: 1000 },
                  quarantineFailures: { type: 'boolean', default: false },
                  environment: { type: 'string', description: 'Environment profile name' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'BDD run started', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { $ref: '#/components/schemas/BDDRun' } } } } } },
          '404': { description: 'Feature not found' },
          '409': { description: 'Maximum concurrent runs reached' }
        }
      }
    },
    '/bdd/runs': {
      get: {
        tags: ['BDD Runs'],
        summary: 'List all BDD runs',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'featureId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'running', 'passed', 'failed', 'cancelled'] } },
          { name: 'projectId', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'List of BDD runs', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/BDDRun' } } } } } } }
        }
      }
    },
    '/bdd/runs/{id}': {
      get: {
        tags: ['BDD Runs'],
        summary: 'Get a BDD run with results',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Run details', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/BDDRun' } } } } } },
          '404': { description: 'Run not found' }
        }
      },
      delete: {
        tags: ['BDD Runs'],
        summary: 'Delete a BDD run',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Run deleted' },
          '404': { description: 'Run not found' }
        }
      }
    },
    '/bdd/runs/{id}/report': {
      get: {
        tags: ['BDD Runs'],
        summary: 'Get HTML report for a BDD run (Serenity BDD or custom)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'HTML report', content: { 'text/html': { schema: { type: 'string' } } } },
          '404': { description: 'Run or report not found' }
        }
      }
    },
    '/bdd/runs/{id}/cancel': {
      post: {
        tags: ['BDD Runs'],
        summary: 'Cancel a running BDD execution',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Run cancelled' },
          '404': { description: 'Run not found' }
        }
      }
    },
    '/bdd/runs/{id}/stream': {
      get: {
        tags: ['BDD Runs'],
        summary: 'SSE stream for live run execution updates',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'token', in: 'query', required: true, schema: { type: 'string' }, description: 'JWT token (SSE does not support headers)' }
        ],
        responses: {
          '200': { description: 'Server-Sent Events stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }
        }
      }
    },
    '/bdd/status': {
      get: {
        tags: ['BDD Runs'],
        summary: 'Get BDD execution status and concurrency info',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Execution status', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { activeRuns: { type: 'integer' }, maxConcurrent: { type: 'integer' } } } } } } } }
        }
      }
    },

    // ─── BDD Step Library ────────────────────────────────────────────
    '/bdd/step-library': {
      get: {
        tags: ['BDD Step Library'],
        summary: 'Get all step library entries',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Step library entries', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/BDDStepLibraryEntry' } } } } } } }
        }
      },
      post: {
        tags: ['BDD Step Library'],
        summary: 'Create a reusable step definition',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  pattern: { type: 'string', description: 'Step matching pattern (regex or Cucumber expression)' },
                  code: { type: 'string', description: 'Step implementation code' },
                  keyword: { type: 'string', enum: ['Given', 'When', 'Then', 'And', 'But'] },
                  description: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } }
                },
                required: ['pattern', 'code', 'keyword']
              }
            }
          }
        },
        responses: {
          '201': { description: 'Step created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/BDDStepLibraryEntry' } } } } } }
        }
      }
    },
    '/bdd/step-library/{id}': {
      put: {
        tags: ['BDD Step Library'],
        summary: 'Update a step definition',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  pattern: { type: 'string' },
                  code: { type: 'string' },
                  keyword: { type: 'string', enum: ['Given', 'When', 'Then', 'And', 'But'] },
                  description: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Step updated' },
          '404': { description: 'Step not found' }
        }
      },
      delete: {
        tags: ['BDD Step Library'],
        summary: 'Delete a step definition',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Step deleted' },
          '404': { description: 'Step not found' }
        }
      }
    },

    // ─── BDD Schedules ──────────────────────────────────────────────
    '/bdd/schedules': {
      get: {
        tags: ['BDD Schedules'],
        summary: 'Get all scheduled BDD runs',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'List of schedules', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/BDDSchedule' } } } } } } }
        }
      },
      post: {
        tags: ['BDD Schedules'],
        summary: 'Create a scheduled BDD run (cron)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  featureId: { type: 'string' },
                  cronExpression: { type: 'string', description: 'Cron expression (e.g. "0 9 * * *")' },
                  tags: { type: 'array', items: { type: 'string' } },
                  browser: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] },
                  executionMode: { type: 'string', enum: ['sequential', 'parallel'] }
                },
                required: ['featureId', 'cronExpression']
              }
            }
          }
        },
        responses: {
          '201': { description: 'Schedule created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/BDDSchedule' } } } } } }
        }
      }
    },
    '/bdd/schedules/{id}': {
      put: {
        tags: ['BDD Schedules'],
        summary: 'Update a schedule',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  cronExpression: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  browser: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] },
                  executionMode: { type: 'string', enum: ['sequential', 'parallel'] }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Schedule updated' },
          '404': { description: 'Schedule not found' }
        }
      },
      delete: {
        tags: ['BDD Schedules'],
        summary: 'Delete a schedule',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Schedule deleted' },
          '404': { description: 'Schedule not found' }
        }
      }
    },

    // ─── Epic Pipeline ──────────────────────────────────────────────
    '/epic-pipeline/jira/test-connection': {
      post: {
        tags: ['Epic Pipeline'],
        summary: 'Test Jira connection',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  baseUrl: { type: 'string', description: 'Jira base URL' },
                  email: { type: 'string', description: 'Jira user email' },
                  apiToken: { type: 'string', description: 'Jira API token' },
                  apiVersion: { type: 'string', default: '3' }
                },
                required: ['baseUrl', 'email', 'apiToken']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Connection successful' },
          '400': { description: 'Connection failed' }
        }
      }
    },
    '/epic-pipeline/jira/save-config': {
      post: {
        tags: ['Epic Pipeline'],
        summary: 'Save Jira configuration',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  baseUrl: { type: 'string' },
                  email: { type: 'string' },
                  apiToken: { type: 'string' },
                  apiVersion: { type: 'string' }
                },
                required: ['baseUrl', 'email', 'apiToken']
              }
            }
          }
        },
        responses: { '200': { description: 'Config saved' } }
      }
    },
    '/epic-pipeline/jira/config': {
      get: {
        tags: ['Epic Pipeline'],
        summary: 'Get saved Jira configuration',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Jira config', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    },
    '/epic-pipeline/jira/projects': {
      get: {
        tags: ['Epic Pipeline'],
        summary: 'List Jira projects',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'List of Jira projects', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { type: 'object' } } } } } } } }
      }
    },
    '/epic-pipeline/jira/epics/{projectKey}': {
      get: {
        tags: ['Epic Pipeline'],
        summary: 'Get epics for a Jira project',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'projectKey', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'List of epics' } }
      }
    },
    '/epic-pipeline/jira/epic/{epicKey}': {
      get: {
        tags: ['Epic Pipeline'],
        summary: 'Get epic with stories',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'epicKey', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Epic details with stories' } }
      }
    },
    '/epic-pipeline/jira/search': {
      post: {
        tags: ['Epic Pipeline'],
        summary: 'Search Jira issues via JQL',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  jql: { type: 'string', description: 'JQL query string' },
                  maxResults: { type: 'integer', default: 50 }
                },
                required: ['jql']
              }
            }
          }
        },
        responses: { '200': { description: 'Search results' } }
      }
    },
    '/epic-pipeline/generate': {
      post: {
        tags: ['Epic Pipeline'],
        summary: 'Generate test cases from manual input',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  summary: { type: 'string', description: 'Story/requirement summary' },
                  description: { type: 'string' },
                  acceptanceCriteria: { type: 'string' },
                  priority: { type: 'string' },
                  options: { type: 'object' }
                },
                required: ['summary']
              }
            }
          }
        },
        responses: { '200': { description: 'Generated test cases', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } } }
      }
    },
    '/epic-pipeline/generate-from-jira': {
      post: {
        tags: ['Epic Pipeline'],
        summary: 'Generate test cases from a Jira story',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  storyKey: { type: 'string', description: 'Jira story key (e.g. PROJ-123)' },
                  options: { type: 'object' }
                },
                required: ['storyKey']
              }
            }
          }
        },
        responses: { '200': { description: 'Generated test cases from Jira story' } }
      }
    },
    '/epic-pipeline/run': {
      post: {
        tags: ['Epic Pipeline'],
        summary: 'Start full Epic pipeline (Epic → Test Cases → Gherkin → Playwright)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  epicKey: { type: 'string', description: 'Jira epic key' },
                  storyKeys: { type: 'array', items: { type: 'string' }, description: 'Specific story keys' },
                  jql: { type: 'string', description: 'JQL query to select stories' },
                  sprintId: { type: 'string' },
                  projectKey: { type: 'string' },
                  categories: { type: 'array', items: { type: 'string' } },
                  maxCasesPerCategory: { type: 'integer' },
                  includeDataVariations: { type: 'boolean' },
                  securityDepth: { type: 'string' },
                  aiProvider: { type: 'string' },
                  aiApiKey: { type: 'string' },
                  aiModel: { type: 'string' },
                  applicationContext: { type: 'string' },
                  autoCreateFeatures: { type: 'boolean' },
                  autoExecute: { type: 'boolean' },
                  executionBrowser: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] },
                  executionMode: { type: 'string', enum: ['sequential', 'parallel'] },
                  jiraBaseUrl: { type: 'string' },
                  jiraEmail: { type: 'string' },
                  jiraApiToken: { type: 'string' },
                  jiraApiVersion: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Pipeline started', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } } } } } } } }
        }
      }
    },
    '/epic-pipeline/runs': {
      get: {
        tags: ['Epic Pipeline'],
        summary: 'List pipeline runs',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'List of pipeline runs' } }
      }
    },
    '/epic-pipeline/runs/{id}': {
      get: {
        tags: ['Epic Pipeline'],
        summary: 'Get pipeline run details',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Pipeline run details' } }
      }
    },
    '/epic-pipeline/runs/{id}/stream': {
      get: {
        tags: ['Epic Pipeline'],
        summary: 'SSE stream for pipeline progress',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'token', in: 'query', schema: { type: 'string' }, description: 'JWT token for SSE auth' }
        ],
        responses: { '200': { description: 'Server-Sent Events stream', content: { 'text/event-stream': { schema: { type: 'string' } } } } }
      }
    },

    // ─── Data-Driven Pipeline ────────────────────────────────────────
    '/data-driven-pipeline/analyze': {
      post: {
        tags: ['Data-Driven Pipeline'],
        summary: 'Analyze script to detect fields (dry-run)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scriptId: { type: 'string', description: 'Script ID (provide scriptId or scriptCode)' },
                  scriptCode: { type: 'string', description: 'Raw script code' },
                  fieldHints: { type: 'object', description: 'Hints to guide field detection' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Field analysis results', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, fields: { type: 'array', items: { type: 'object' } }, fieldCount: { type: 'integer' }, suggestedPlaceholders: { type: 'object' } } } } } },
          '400': { description: 'Must provide scriptId or scriptCode' }
        }
      }
    },
    '/data-driven-pipeline/preview': {
      post: {
        tags: ['Data-Driven Pipeline'],
        summary: 'Preview pipeline (analyze + generate + parameterize, no execution)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scriptId: { type: 'string' },
                  strategies: { type: 'array', items: { type: 'string', enum: ['positive', 'negative', 'boundary', 'equivalence', 'security'] } },
                  countPerStrategy: { type: 'integer', default: 5 },
                  autoParameterize: { type: 'boolean', default: true },
                  fieldHints: { type: 'object' }
                },
                required: ['scriptId', 'strategies']
              }
            }
          }
        },
        responses: {
          '200': { description: 'Pipeline preview', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, scriptName: { type: 'string' }, fields: { type: 'array', items: { type: 'object' } }, parameterizedCode: { type: 'string' }, fieldBindings: { type: 'object' }, datasets: { type: 'object' }, summary: { type: 'object' } } } } } }
        }
      }
    },
    '/data-driven-pipeline/run': {
      post: {
        tags: ['Data-Driven Pipeline'],
        summary: 'Full pipeline: analyze → generate → parameterize → execute → report',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scriptId: { type: 'string' },
                  strategies: { type: 'array', items: { type: 'string', enum: ['positive', 'negative', 'boundary', 'equivalence', 'security'] } },
                  countPerStrategy: { type: 'integer', default: 5 },
                  executionMode: { type: 'string', enum: ['sequential', 'parallel'], default: 'sequential' },
                  maxParallel: { type: 'integer', default: 3 },
                  autoParameterize: { type: 'boolean', default: true },
                  stopOnFirstFailure: { type: 'boolean', default: false },
                  fieldHints: { type: 'object' },
                  browser: { type: 'string', default: 'chromium' }
                },
                required: ['scriptId', 'strategies']
              }
            }
          }
        },
        responses: {
          '202': { description: 'Pipeline started', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { type: 'object', properties: { scriptId: { type: 'string' }, scriptName: { type: 'string' }, strategies: { type: 'array', items: { type: 'string' } }, countPerStrategy: { type: 'integer' }, executionMode: { type: 'string' }, browser: { type: 'string' }, autoParameterize: { type: 'boolean' } } } } } } } }
        }
      }
    },
    '/data-driven-pipeline/status/{id}': {
      get: {
        tags: ['Data-Driven Pipeline'],
        summary: 'Poll execution status',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Script ID' }],
        responses: {
          '200': { description: 'Execution status', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { id: { type: 'string' }, scriptId: { type: 'string' }, scriptName: { type: 'string' }, status: { type: 'string' }, totalRows: { type: 'integer' }, completedRows: { type: 'integer' }, passedRows: { type: 'integer' }, failedRows: { type: 'integer' }, duration: { type: 'number' }, executionMode: { type: 'string' }, browser: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, completedAt: { type: 'string', format: 'date-time' }, strategySummary: { type: 'object' }, progress: { type: 'number' } } } } } } } }
        }
      }
    },
    '/data-driven-pipeline/results/{id}': {
      get: {
        tags: ['Data-Driven Pipeline'],
        summary: 'Get full results with per-strategy breakdown',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Script ID' }],
        responses: {
          '200': { description: 'Full pipeline results' }
        }
      }
    },
    '/data-driven-pipeline/cancel/{id}': {
      post: {
        tags: ['Data-Driven Pipeline'],
        summary: 'Cancel a running pipeline',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Script ID' }],
        responses: {
          '200': { description: 'Pipeline cancelled' }
        }
      }
    }
  }
};

const options = {
  definition: swaggerDefinition,
  apis: []
};

export const swaggerSpec = swaggerJsdoc(options);
