const express = require('express');
const app = express();

// Use PORT from Render
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('PWLoGiCon Platform is live!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});