require('dotenv').config();
const express = require('express');
const app = express();

// Middleware
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.send('🚀 PWLoGiCon Platform is Running');
});

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', version: '1.0.1' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
