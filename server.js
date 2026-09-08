require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { checkConnection } = require('./config/database');
const { startCleanupService } = require('./services/cleanupService');
const { generalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const { runMigration } = require('./database/migrations/001_create_notifications');
const { runMigration: runConnectionsMigration } = require('./database/migrations/002_create_connections');
const { runMigration: runSafetyMigration } = require('./database/migrations/003_create_safety');
const { runMigration: runLiveMigration } = require('./database/migrations/004_create_live_and_comment_media');
const { runMigration: runPostAudienceMigration } = require('./database/migrations/005_add_post_audience_collaborators');
const { runMigration: runPlatformMigration } = require('./database/migrations/006_create_platform_features');
const { runMigration: runPresenceMigration } = require('./database/migrations/007_add_presence');
const { attachSocketServer } = require('./services/socketService');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(generalLimiter);

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/posts', require('./routes/postRoutes'));
app.use('/api/posts', require('./routes/likeRoutes'));
app.use('/api/posts', require('./routes/commentRoutes'));
app.use('/api/comments', require('./routes/commentDeleteRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/status', require('./routes/statusRoutes'));
app.use('/api/follows', require('./routes/followRoutes'));
app.use('/api/connections', require('./routes/connectionRoutes'));
app.use('/api/safety', require('./routes/safetyRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/live', require('./routes/liveRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/privacy', require('./routes/privacyRoutes'));

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Rubavu Connect API is running',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/db', async (req, res) => {
  try {
    await checkConnection();
    res.json({
      success: true,
      message: 'Database connection is healthy',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

app.use(errorHandler);

async function startServer() {
  try {
    const dbConnected = await checkConnection();
    if (!dbConnected) {
      console.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    await runMigration();
    await runConnectionsMigration();
    await runSafetyMigration();
    await runLiveMigration();
    await runPostAudienceMigration();
    await runPlatformMigration();
    await runPresenceMigration();
    startCleanupService();

    const { server } = attachSocketServer(app);
    server.listen(PORT, () => {
      console.log(`Rubavu Connect API server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
