const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/auth');
const assetRoutes = require('./routes/assets');
const traceRoutes = require('./routes/trace');
const dataRoutes = require('./routes/data');

const app = express();
const PORT = process.env.PORT || 5004;

// Enable CORS & Body Parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets from public/ folder
app.use(express.static(path.join(__dirname, 'public')));

// Register API Routes
app.use('/api/auth', authRoutes);
app.use('/api/gis', assetRoutes);
app.use('/api/trace', traceRoutes);
app.use('/api/data', dataRoutes);

// Catch-all route to serve public/index.html for any frontend SPA navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express server and initialize database tables
app.listen(PORT, async () => {
  console.log(`==================================================`);
  console.log(`Telecom Web GIS Platform Server is running on port ${PORT}`);
  console.log(`==================================================`);

  // Attempt to initialize database tables using schema.sql
  try {
    const schemaPath = path.join(__dirname, 'models', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      console.log('Attempting to initialize PostGIS database schema...');
      await db.query(sql);
      console.log('PostgreSQL + PostGIS database schema initialized successfully');
    } else {
      console.warn('Warning: schema.sql file not found. Database table creation skipped.');
    }

    // Seed default test user if not exists (runs after schema init)
    try {
      const testEmail = 'sujinsurendran97@outlook.com';
      const testUsername = 'sujin';
      const testPassword = '123';
      const userCheck = await db.query('SELECT id FROM users WHERE email = $1', [testEmail]);
      if (userCheck.rows.length === 0) {
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(testPassword, salt);
        await db.query('INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)', [testUsername, testEmail, password_hash, 'planner']);
        console.log('Default test user created.');
      }
    } catch (seedErr) {
      console.error('Error creating default test user:', seedErr.message);
    }
  } catch (err) {
    console.error('Database connection / initialization failed!');
    console.error('Reason:', err.message);
    console.error('Please configure database credentials in .env and ensure PostgreSQL + PostGIS are running.');
  }
});
