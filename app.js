require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const geolib = require('geolib');

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
  
  // Initialize tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_plate TEXT UNIQUE,
      current_lat REAL,
      current_lng REAL,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS geofences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      lat REAL,
      lng REAL,
      radius INTEGER, -- meters
      alert_message TEXT
    );
    
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER,
      geofence_id INTEGER,
      message TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY(geofence_id) REFERENCES geofences(id)
    );
  `);
});

// ========================
// GPS SIMULATION & GEOFENCING
// ========================
function simulateGPSTracking() {
  // Update vehicle positions every 30 seconds
  setInterval(() => {
    db.all('SELECT id FROM vehicles', [], (err, vehicles) => {
      if (err) return console.error('GPS sim error:', err);
      
      vehicles.forEach(vehicle => {
        // Random position change (0.001° ≈ 111m)
        const latChange = (Math.random() - 0.5) * 0.01;
        const lngChange = (Math.random() - 0.5) * 0.01;
        
        db.run(
          `UPDATE vehicles SET 
           current_lat = COALESCE(current_lat, ?) + ?, 
           current_lng = COALESCE(current_lng, ?) + ?,
           last_updated = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [process.env.BASE_LAT || 51.5074, latChange, 
           process.env.BASE_LNG || -0.1278, lngChange, 
           vehicle.id],
          
          function(err) {
            if (err) console.error('GPS update failed:', err);
            else checkGeofences(vehicle.id);
          }
        );
      });
    });
  }, 30000);
}

function checkGeofences(vehicleId) {
  db.get(
    `SELECT id, current_lat, current_lng FROM vehicles WHERE id = ?`,
    [vehicleId],
    (err, vehicle) => {
      if (err || !vehicle) return;
      
      db.all(
        `SELECT * FROM geofences`,
        [],
        (err, geofences) => {
          if (err) return console.error('Geofence check failed:', err);
          
          geofences.forEach(geofence => {
            const distance = geolib.getDistance(
              { latitude: vehicle.current_lat, longitude: vehicle.current_lng },
              { latitude: geofence.lat, longitude: geofence.lng }
            );
            
            if (distance <= geofence.radius) {
              db.run(
                `INSERT INTO alerts (vehicle_id, geofence_id, message)
                 VALUES (?, ?, ?)`,
                [vehicle.id, geofence.id, 
                 `Vehicle entered ${geofence.name}: ${geofence.alert_message}`],
                (err) => {
                  if (!err) console.log(`🚨 Geofence alert for vehicle ${vehicle.id}`);
                }
              );
            }
          });
        }
      );
    }
  );
}

// Start GPS simulation
simulateGPSTracking();

// ========================
// ROUTES
// ========================

// Professional Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    version: process.env.npm_package_version,
    features: ['gps-tracking', 'geofencing', 'real-time-alerts']
  });
});

// Vehicle endpoints
app.get('/api/vehicles', (req, res) => {
  db.all('SELECT * FROM vehicles', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Geofence endpoints
app.get('/api/geofences', (req, res) => {
  db.all('SELECT * FROM geofences', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Alert endpoints
app.get('/api/alerts', (req, res) => {
  db.all(`
    SELECT a.*, v.license_plate, g.name as geofence_name 
    FROM alerts a
    LEFT JOIN vehicles v ON a.vehicle_id = v.id
    LEFT JOIN geofences g ON a.geofence_id = g.id
    ORDER BY a.timestamp DESC
    LIMIT 50
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ========================
// SERVER INITIALIZATION
// ========================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 PWLoGiCon Logistics Intelligence Platform
  ----------------------------
  ✅ Version: ${process.env.npm_package_version}
  ✅ Environment: ${process.env.NODE_ENV || 'development'}
  ✅ Server: http://localhost:${PORT}
  ✅ Database: ${DB_PATH}
  📅 ${new Date().toISOString()}
  `);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  db.close();
  server.close(() => {
    console.log('Server terminated');
    process.exit(0);
  });
});
