require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Initialize app
const app = express();

// ======================
// SECURITY CONFIGURATION
// ======================
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*'
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many requests from this IP'
}));

// =================
// DATABASE SETUP
// =================
const dbPath = process.env.NODE_ENV === 'production'
  ? '/opt/render/project/src/db/logistics.db'
  : './db/logistics.db';

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to logistics database');
});

// Initialize tables (if not exists)
db.exec(`
  CREATE TABLE IF NOT EXISTS trucks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_plate TEXT UNIQUE,
    current_lat REAL,
    current_lng REAL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT,
    destination TEXT,
    payload TEXT,
    revenue REAL,
    expiry TIMESTAMP
  );
`);

// ===================
// CORE API ENDPOINTS
// ===================

// 1. Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    version: '1.0.0',
    features: [
      'gps-tracking',
      'partnership-matching',
      'geospatial-analytics',
      'predictive-eta',
      'multi-carrier-integration'
    ]
  });
});

// 2. Real-time Truck Tracking
app.get('/api/gps/trucks', (req, res) => {
  db.all(`
    SELECT id, license_plate, 
           current_lat AS lat, 
           current_lng AS lng,
           strftime('%s', last_updated) AS timestamp
    FROM trucks
    WHERE last_updated > datetime('now', '-5 minutes')
    ORDER BY last_updated DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 3. Load Opportunities
app.get('/api/opportunities', (req, res) => {
  const { max_distance = 100 } = req.query;
  
  db.all(`
    SELECT id, origin, destination, payload, revenue,
           (6371 * acos(
             cos(radians(?)) * cos(radians(origin_lat)) *
             cos(radians(origin_lng) - radians(?)) +
             sin(radians(?)) * sin(radians(origin_lat))
           )) AS distance
    FROM opportunities
    WHERE distance < ?
    AND expiry > datetime('now')
    ORDER BY revenue DESC
    LIMIT 50
  `, [req.query.lat, req.query.lng, req.query.lat, max_distance], 
  (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 4. Revenue Analytics
app.get('/api/analytics/revenue', (req, res) => {
  const { period = 'month' } = req.query;
  
  db.all(`
    SELECT 
      strftime('%Y-%m', timestamp) AS timeframe,
      SUM(revenue) AS total,
      COUNT(*) AS shipments
    FROM shipments
    WHERE timestamp > datetime('now', ?)
    GROUP BY timeframe
    ORDER BY timeframe
  `, [`-1 ${period}`], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ====================
// SERVER INITIALIZATION
// ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 PWLoGiCon Platform v1.0.0
  ----------------------------
  ✅ Live on port ${PORT}
  📊 Endpoints:
     - /api/health
     - /api/gps/trucks
     - /api/opportunities
     - /api/analytics/revenue
  📅 ${new Date().toISOString()}
  `);
});

// Error handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
