require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { checkConnection } = require('./config/database');
const { startCleanupService } = require('./services/cleanupService');
const errorHandler = require('./middleware/errorHandler');
const { runMigrations } = require('./database/runMigrations');
const { maintenanceGuard } = require('./middleware/maintenance');
const { attachSocketServer } = require('./services/socketService');
const { buildCorsOptions } = require('./utils/corsOrigins');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors(buildCorsOptions()));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(maintenanceGuard);

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
app.use('/api/admin', require('./routes/adminRoutes'));

const adminSettingsController = require('./controllers/adminSettingsController');
app.get('/api/settings', adminSettingsController.getPublicSettings);

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

    await runMigrations();
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
