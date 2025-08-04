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
  
  // Initialize tables and sample data
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_plate TEXT UNIQUE,
      current_lat REAL,
      current_lng REAL,
      status TEXT DEFAULT 'In Transit',
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
    
    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT,
      origin TEXT,
      destination TEXT,
      service_type TEXT,
      volume INTEGER,
      urgency TEXT,
      value REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Insert sample data
  db.run(`INSERT OR IGNORE INTO vehicles (license_plate, current_lat, current_lng, status) VALUES 
    ('TRK-1000', 41.8781, -87.6298, 'In Transit'),
    ('TRK-1001', 32.7767, -96.7970, 'Loading'),
    ('TRK-1002', 33.4484, -112.0740, 'Delivered')`);
    
  db.run(`INSERT OR IGNORE INTO geofences (name, lat, lng, radius, alert_message) VALUES 
    ('Chicago DC', 41.8781, -87.6298, 8000, 'Distribution center zone'),
    ('Dallas Hub', 32.7767, -96.7970, 8000, 'Major logistics hub'),
    ('Phoenix Terminal', 33.4484, -112.0740, 8000, 'Southwest terminal')`);
    
  db.run(`INSERT OR IGNORE INTO opportunities (user_id, type, origin, destination, service_type, volume, urgency, value) VALUES 
    (1, 'lane_need', 'Chicago, IL', 'Dallas, TX', 'FTL', 26000, 'standard', 2500.00),
    (2, 'capacity_offer', 'Los Angeles, CA', 'Phoenix, AZ', 'LTL', 15000, 'hot', 1800.00),
    (3, 'lane_need', 'Atlanta, GA', 'Miami, FL', 'Reefer', 22000, 'standard', 3200.00),
    (4, 'capacity_offer', 'Dallas, TX', 'Chicago, IL', 'FTL', 26000, 'hot', 2400.00)`);
});

// ========================
// GPS SIMULATION & GEOFENCING
// ========================
function simulateGPSTracking() {
  setInterval(() => {
    db.all('SELECT * FROM vehicles', [], (err, vehicles) => {
      if (err) return console.error('GPS sim error:', err);
      
      vehicles.forEach(vehicle => {
        // Random position change (0.01° ≈ 1.1km)
        const latChange = (Math.random() - 0.5) * 0.01;
        const lngChange = (Math.random() - 0.5) * 0.01;
        
        const newLat = vehicle.current_lat + latChange;
        const newLng = vehicle.current_lng + lngChange;
        
        db.run(
          `UPDATE vehicles SET 
           current_lat = ?, 
           current_lng = ?,
           last_updated = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [newLat, newLng, vehicle.id],
          function(err) {
            if (err) console.error('GPS update failed:', err);
            else checkGeofences(vehicle.id, newLat, newLng);
          }
        );
      });
      console.log(`GPS Simulation: Updated ${vehicles.length} trucks at ${new Date().toLocaleTimeString()}`);
    });
  }, 10000); // Update every 10 seconds
}

function checkGeofences(vehicleId, lat, lng) {
  db.all('SELECT * FROM geofences', [], (err, geofences) => {
    if (err) return console.error('Geofence check failed:', err);
    
    geofences.forEach(geofence => {
      const distance = geolib.getDistance(
        { latitude: lat, longitude: lng },
        { latitude: geofence.lat, longitude: geofence.lng }
      );
      
      const distanceInMiles = distance * 0.000621371; // Convert to miles
      
      if (distance <= geofence.radius) {
        db.get(
          `SELECT id FROM alerts WHERE vehicle_id = ? AND geofence_id = ? AND timestamp > datetime('now', '-5 minutes')`,
          [vehicleId, geofence.id],
          (err, existing) => {
            if (!err && !existing) {
              db.run(
                `INSERT INTO alerts (vehicle_id, geofence_id, message) VALUES (?, ?, ?)`,
                [vehicleId, geofence.id, `Vehicle entered ${geofence.name} (${distanceInMiles.toFixed(2)} mi from center)`],
                (err) => {
                  if (!err) {
                    db.get('SELECT license_plate FROM vehicles WHERE id = ?', [vehicleId], (err, vehicle) => {
                      if (!err && vehicle) {
                        console.log(`🚨 ${vehicle.license_plate} has entered ${geofence.name} (${distanceInMiles.toFixed(2)} mi from center)`);
                      }
                    });
                  }
                }
              );
            }
          }
        );
      }
    });
  });
}

// Start GPS simulation
simulateGPSTracking();

// ========================
// ROUTES
// ========================

// Professional Homepage
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>PWLoGiCon - Logistics Intelligence Platform</title>
      <style>
        body { 
          font-family: 'Segoe UI', system-ui; 
          max-width: 1200px; 
          margin: 0 auto; 
          padding: 20px; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        .header { text-align: center; margin-bottom: 40px; }
        .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 30px 0; }
        .feature { 
          background: rgba(255,255,255,0.1); 
          padding: 20px; 
          border-radius: 10px; 
          backdrop-filter: blur(10px);
        }
        .api-section { 
          background: rgba(0,0,0,0.3); 
          padding: 30px; 
          border-radius: 15px; 
          margin: 30px 0; 
        }
        .api-link { 
          color: #61dafb; 
          text-decoration: none; 
          font-weight: bold; 
        }
        .security-badge {
          background: #2ecc71;
          padding: 5px 15px;
          border-radius: 20px;
          font-size: 12px;
          margin: 5px;
          display: inline-block;
        }
        .database-badge {
          background: #e74c3c;
          padding: 5px 15px;
          border-radius: 20px;
          font-size: 12px;
          margin: 5px;
          display: inline-block;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🚀 PWLoGiCon Platform v1.0.1</h1>
        <p>AI-Powered Logistics Intelligence Platform with Persistent Database</p>
        <div>
          <span class="security-badge">🔒 Helmet Security</span>
          <span class="security-badge">🌐 CORS Protected</span>
          <span class="security-badge">⚡ Rate Limited</span>
          <span class="database-badge">💾 SQLite Database</span>
          <span class="database-badge">📍 GPS Tracking</span>
        </div>
      </div>

      <div class="features">
        <div class="feature">✅ Real-time GPS tracking with SQLite persistence</div>
        <div class="feature">✅ Advanced geofencing with alert system</div>
        <div class="feature">✅ AI-powered partnership matching</div>
        <div class="feature">✅ Interactive geospatial analytics</div>
        <div class="feature">✅ Predictive ETA intelligence</div>
        <div class="feature">✅ Multi-carrier integration</div>
        <div class="feature">✅ Enterprise security & monitoring</div>
        <div class="feature">✅ Persistent data storage</div>
      </div>

      <div class="api-section">
        <h3>🔗 API Endpoints</h3>
        <p><a href="/api/health" class="api-link">/api/health</a> - Platform health check</p>
        <p><a href="/api/vehicles" class="api-link">/api/vehicles</a> - Real-time vehicle tracking</p>
        <p><a href="/api/geofences" class="api-link">/api/geofences</a> - Geofencing zones</p>
        <p><a href="/api/alerts" class="api-link">/api/alerts</a> - Real-time geofencing alerts</p>
        <p><a href="/api/opportunities" class="api-link">/api/opportunities</a> - Load opportunities</p>
        <p><a href="/api/analytics/revenue" class="api-link">/api/analytics/revenue</a> - Revenue analytics</p>
      </div>

      <div style="text-align: center; margin-top: 40px;">
        <p>Enterprise-grade platform with persistent database storage and advanced geofencing capabilities.</p>
        <p><strong>PWLoGiCon Group - Ian G James MBA, CEO</strong></p>
      </div>
    </body>
    </html>
  `);
});

// ========================
// API ROUTES
// ========================

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    version: '1.0.1',
    environment: process.env.NODE_ENV || 'development',
    security: {
      helmet: true,
      cors: true,
      rateLimiting: true
    },
    features: [
      'gps-tracking',
      'geofencing',
      'real-time-alerts',
      'partnership-matching',
      'geospatial-analytics',
      'predictive-eta',
      'enterprise-security',
      'sqlite-database'
    ],
    timestamp: new Date().toISOString()
  });
});

// Vehicle endpoints
app.get('/api/vehicles', (req, res) => {
  db.all('SELECT * FROM vehicles ORDER BY last_updated DESC', [], (err, rows) => {
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

// Opportunities endpoint
app.get('/api/opportunities', (req, res) => {
  db.all('SELECT * FROM opportunities ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Revenue analytics endpoint
app.get('/api/analytics/revenue', (req, res) => {
  db.all('SELECT * FROM opportunities', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const totalRevenue = rows.reduce((sum, opp) => sum + opp.value, 0);
    const summary = {
      total_revenue: totalRevenue,
      total_opportunities: rows.length,
      breakdown: rows
    };
    res.json(summary);
  });
});

// User endpoint for compatibility
app.get('/api/auth/user', (req, res) => {
  res.json({
    id: 4,
    email: 'ian@pwlogicon.com',
    role: '3pl',
    company: 'PA Logistics'
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
  🚀 PWLoGiCon Platform v1.0.1 (Enhanced Database)
  ----------------------------
  ✅ Environment: ${process.env.NODE_ENV || 'development'}
  ✅ Listening on port ${PORT}
  🔒 Security: Helmet + CORS + Rate Limiting
  💾 Database: SQLite with GPS tracking
  📍 GPS simulation & geofencing enabled
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

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
