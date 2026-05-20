import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { authRouter } from './routes/auth.js';
import syncRouter from './routes/sync.js';
import dashboardRouter from './routes/dashboard.js';
import entitiesRouter from './routes/entities.js';
import transactionsRouter from './routes/transactions.js';
import projectionsRouter from './routes/projections.js';
import { requireAuth } from './middleware/requireAuth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { migrateDatabase } from './db/migrate.js';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

app.locals.db = pool;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize authentication middleware
const auth = requireAuth();

// Routes
app.use('/api/auth', authRouter());
app.use('/api/sync', auth, syncRouter);
app.use('/api/dashboard', auth, dashboardRouter);
app.use('/api/entities', auth, entitiesRouter);
app.use('/api/transactions', auth, transactionsRouter);
app.use('/api/projections', auth, projectionsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('\nShutting down gracefully...');
  try {
    await pool.end();
    console.log('Database pool closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Startup
(async () => {
  try {
    console.log('BudgetBladeReports Backend - Starting up...');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Test database connection
    const client = await pool.connect();
    console.log('✓ Database connection established');
    client.release();

    // Run migrations
    await migrateDatabase(pool);

    // Start server
    app.listen(port, () => {
      console.log(`\n✓ Server running on http://localhost:${port}`);
      console.log(`✓ API available at http://localhost:${port}/api`);
      console.log(`✓ Health check: http://localhost:${port}/health\n`);
    });
  } catch (error) {
    console.error('✗ Failed to start server:', error.message);
    process.exit(1);
  }
})();

export default app;
