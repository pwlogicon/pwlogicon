// Ensure db directory exists with proper permissions
try {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { 
      recursive: true,
      mode: 0o755  // Ensure proper permissions
    });
  }
} catch (err) {
  console.error('❌ Failed to create db directory:', err);
}

// Database connection with robust error handling
let db;
try {
  db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      // Production fallback to in-memory database
      if (process.env.NODE_ENV === 'production') {
        console.log('⚠️ Using in-memory database as fallback');
        db = new sqlite3.Database(':memory:');
        initializeDatabase(db);
        return;
      }
    }
    initializeDatabase(db);
  });
} catch (err) {
  console.error('❌ Database initialization failed:', err);
}
