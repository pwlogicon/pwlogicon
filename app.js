require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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
app.use(express.static(path.join(__dirname, 'public')));

// ========================
// DATABASE CONNECTION
// ========================
const DB_PATH = process.env.DB_PATH || './db/logistics.db';
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to SQLite database at', DB_PATH);
  
  // Initialize tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_plate TEXT UNIQUE,
      current_lat REAL,
      current_lng REAL,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT,
      destination TEXT,
      status TEXT,
      vehicle_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
    );
  `);
});

// ========================
// API ROUTES
// ========================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    version: process.env.npm_package_version,
    database: 'connected'
  });
});

// Vehicle Tracking
app.get('/api/vehicles', (req, res) => {
  db.all('SELECT * FROM vehicles', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Shipment Management
app.get('/api/shipments', (req, res) => {
  db.all(`
    SELECT s.*, v.license_plate 
    FROM shipments s
    LEFT JOIN vehicles v ON s.vehicle_id = v.id
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ========================
// ERROR HANDLING
// ========================
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ========================
// SERVER INITIALIZATION
// ========================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 PWLoGiCon Platform v${process.env.npm_package_version}
  ----------------------------
  ✅ Environment: ${process.env.NODE_ENV || 'development'}
  ✅ Server: http://localhost:${PORT}
  ✅ Database: ${DB_PATH}
  📅 ${new Date().toISOString()}
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server...');
  db.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
