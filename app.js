require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

// Initialize Express
const app = express();

// ========================
// SECURITY MIDDLEWARE
// ========================
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per window
  standardHeaders: true,
  legacyHeaders: false
}));

// ========================
// APPLICATION MIDDLEWARE
// ========================
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined')); // HTTP request logging

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ========================
// DATABASE CONNECTION
// ========================
const connectDB = require('./config/database');
connectDB(); // Implement your DB connection logic

// ========================
// ROUTES
// ========================
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');

app.use('/api', apiRoutes);
app.use('/auth', authRoutes);

// ========================
// ERROR HANDLING
// ========================
app.use((req, res, next) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ========================
// SERVER START
// ========================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`
  🚀 PWLoGiCon Platform v${process.env.npm_package_version}
  ----------------------------
  ✅ Environment: ${process.env.NODE_ENV || 'development'}
  ✅ Listening on port ${PORT}
  ✅ Database: ${process.env.DB_CONNECTED || 'Not connected'}
  📅 ${new Date().toISOString()}
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});
