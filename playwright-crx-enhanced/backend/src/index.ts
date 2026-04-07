import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import dotenv from 'dotenv';
// import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';
import * as path from 'path';

// Routes
import authRoutes from './routes/auth.routes';
import scriptRoutes from './routes/script.routes';
import projectRoutes from './routes/project.routes';
import testRunRoutes from './routes/testRun.routes';
import extensionRoutes from './routes/extension.routes';
import allureRoutes from './routes/allure.routes';
import apiTestingRoutes from './routes/apiTesting.routes';
import apiRequestRoutes from './routes/apiRequest.routes';
import mlEnhancementRoutes from './routes/ml-enhancement.routes';
import testDataManagementRoutes from './routes/testdata-management.routes';
import externalApiRoutes from './routes/external-api.routes';
import aiEnhancementRoutes from './routes/ai-enhancement.routes';
import aiAnalysisRoutes from './routes/ai-analysis.routes';
import workflowRoutes from './routes/workflow.routes';
import pipelineRoutes from './routes/pipeline.routes';
import testingStrategiesRoutes from './routes/testing-strategies.routes';
import visualRegressionRoutes from './routes/visual-regression.routes';
import organizationRoutes from './routes/organization.routes';
import queueRoutes from './routes/queue.routes';
// DISABLED: Data-driven testing is now integrated into test data management
// import dataDrivenRoutes from './routes/dataDriven.routes';
import bddRoutes from './routes/bdd.routes';
import screenplayRoutes from './routes/screenplay.routes';
import mcpRoutes from './routes/mcp.routes';
import pythonApiRoutes from './routes/python-api.routes';
import epicPipelineRoutes from './routes/epicPipeline.routes';
// DISABLED: Data-driven pipeline is now integrated into test data management
// import dataDrivenPipelineRoutes from './routes/dataDrivenPipeline.routes';
import pool from './db';

// Services
import { queueService } from './services/queue';
import { workerPoolService } from './services/workers';
import { bddService } from './services/bdd/bdd.service';

// Middleware
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { loadProjectEnvironmentWithFallback } from './utils/projectManager';

// Load environment variables from project-specific .env file
// Priority: ACTIVE_PROJECT env var > .env.{projectName} > .env
const projectName = process.env.ACTIVE_PROJECT || process.argv[2] || 'default';
if (projectName !== 'default') {
  loadProjectEnvironmentWithFallback(projectName, path.resolve(__dirname, '../'));
} else {
  dotenv.config();
}

const app: Application = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security
const isDev = (process.env.NODE_ENV || 'development') === 'development';
if (isDev) {
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'frame-ancestors': ["'self'", 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
        'frame-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'"]
      }
    },
    frameguard: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false
  }));
} else {
  app.use(helmet());
}

const envOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const defaultOrigins = [
  'chrome-extension://*',
  'ms-browser-extension://*',
  'edge-extension://*',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
];
const allowedOrigins = envOrigins.length ? envOrigins : defaultOrigins;

app.use(cors({
  origin: (origin, callback) => {
    if ((process.env.NODE_ENV || 'development') === 'development') {
      return callback(null, true);
    }
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        const pattern = new RegExp('^' + allowed.replace('*', '.*') + '$');
        return pattern.test(origin);
      }
      return allowed === origin;
    });
    if (isAllowed) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization'],
  optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting disabled for development
// const limiter = rateLimit({
//   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
//   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
//   message: 'Too many requests from this IP, please try again later.'
// });
// app.use('/api/', limiter);

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip, userAgent: req.get('user-agent') });
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), environment: NODE_ENV });
});

app.get('/db/health', async (_req, res) => {
  try {
    const r = await pool.query('SELECT 1 as ok');
    res.json({ status: 'ok', result: r.rows[0], timestamp: new Date().toISOString() });
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

app.get('/api', (_req, res) => {
  res.json({
    status: 'ok',
    api: 'playwright-crx-backend',
    endpoints: [
      '/api/auth/*',
      '/api/projects/*',
      '/api/scripts/*',
      '/api/test-runs/*',
      '/api/testdata/*',
      '/api/external-api/*',
      '/api/api-requests/*',
      '/api/api-testing/*',
      '/api/extensions/*',
      '/api/allure',
      '/api/ml/*',
      '/api/ai-enhancement/*',
      '/api/ai-analysis/*',
      '/api/workflow/*',
      '/api/pipeline/*',
      '/api/testing-strategies/*',
      '/api/visual-regression/*',
      '/api/database-testing/*',
      '/api/organizations/*',
      '/api/queue/*',
      '/api/data-driven-runs/*',
      '/api/bdd/*',
      '/api/screenplay/*',
      '/api/mcp/*',
      '/api/python-api/*',
      '/api/data-driven-pipeline/*',
      '/api-docs',
      '/api-docs.json'
    ]
  });
});

app.get('/api-docs.json', (_req, res) => { res.json(swaggerSpec); });
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/allure-reports', express.static(path.join(process.cwd(), 'allure-reports')));
app.use('/playwright-crx-reports', express.static(path.join(process.cwd(), 'playwright-crx-reports')));

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/scripts', scriptRoutes);
app.use('/api/test-runs', testRunRoutes);
app.use('/api/extensions', extensionRoutes);
app.use('/api/allure', allureRoutes);
app.use('/api/api-testing', apiTestingRoutes);
app.use('/api/api-requests', apiRequestRoutes);
app.use('/api/ml', mlEnhancementRoutes);
app.use('/api/testdata', testDataManagementRoutes);
app.use('/api/external-api', externalApiRoutes);
app.use('/api/ai-enhancement', aiEnhancementRoutes);
app.use('/api/ai-analysis', aiAnalysisRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/testing-strategies', testingStrategiesRoutes);
app.use('/api/visual-regression', visualRegressionRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/queue', queueRoutes);
// DISABLED: app.use('/api/data-driven-runs', dataDrivenRoutes);
app.use('/api/bdd', bddRoutes);
app.use('/api/screenplay', screenplayRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/python-api', pythonApiRoutes);
app.use('/api/epic-pipeline', epicPipelineRoutes);
// DISABLED: app.use('/api/data-driven-pipeline', dataDrivenPipelineRoutes);

(async () => {
  if (NODE_ENV === 'test') return;
  const databaseTestingRoutes = (await import('./routes/database-testing.routes')).default;
  app.use('/api/database-testing', databaseTestingRoutes);
})();

app.use((_req, res) => { res.status(404).json({ error: 'Route not found' }); });
app.use(errorHandler);

if (NODE_ENV !== 'test') {
  httpServer.listen(PORT, async () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📡 Environment: ${NODE_ENV}`);
    logger.info(`🏥 Health check: http://localhost:${PORT}/health`);

    
    // Initialize Queue Service
    if (process.env.ENABLE_QUEUE === 'true') {
      try {
        await queueService.initialize();
        logger.info(`📦 Queue Service: Enabled`);
      } catch (error: any) {
        logger.error(`📦 Queue Service: Failed to initialize - ${error.message}`);
      }
    } else {
      logger.info(`📦 Queue Service: Disabled - Set ENABLE_QUEUE=true to enable`);
    }
    
    // Initialize Worker Pool
    if (process.env.ENABLE_WORKER_POOL === 'true') {
      try {
        await workerPoolService.initialize();
        logger.info(`👷 Worker Pool: Enabled`);
      } catch (error: any) {
        logger.error(`👷 Worker Pool: Failed to initialize - ${error.message}`);
      }
    } else {
      logger.info(`👷 Worker Pool: Disabled - Set ENABLE_WORKER_POOL=true to enable`);
    }

    // Pre-warm BDD/Cucumber environment in background (non-blocking)
    bddService.warmup().catch((err: any) => {
      logger.warn(`BDD warmup failed (non-fatal): ${err?.message || err}`);
    });

    // Initialize BDD scheduled runs
    bddService.initializeSchedules().catch((err: any) => {
      logger.warn(`BDD schedule initialization failed (non-fatal): ${err?.message || err}`);
    });
  });
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} signal received: starting graceful shutdown`);
  
  // Shutdown worker pool first
  if (workerPoolService.isReady()) {
    await workerPoolService.shutdown();
  }
  
  // Then shutdown queue
  if (queueService.isReady()) {
    await queueService.shutdown();
  }
  
  // Finally close HTTP server
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, httpServer };
