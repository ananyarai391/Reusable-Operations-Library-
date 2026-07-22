// Save as: server.js (project root)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const authRoutes = require('./routes/auth');
const elementRoutes = require('./routes/elements');
const styleRoutes = require('./routes/styles');
const operationRoutes = require('./routes/operations');

const app = express();

app.use(cors());
app.use(express.json());

// Serves uploaded videos statically, e.g. http://localhost:3000/uploads/xyz.mp4
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serves the supervisor UI and shared frontend assets (login.html, index.html,
// builder.html, shared.js, taxonomy.js, style.css). GET / resolves to index.html.
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/elements', elementRoutes);
app.use('/api/styles', styleRoutes);
app.use('/api/operations', operationRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// PUBLIC viewer page — what a QR code scan opens. No login, mobile-only.
// Same page is served for every operation id; the page's own JS reads
// the id from the URL and fetches /api/operations/:id/view.
app.get('/view/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'view.html'));
});

const PORT = process.env.PORT || 3000;

// If a mkcert-generated certificate is present (certs/cert.pem + certs/key.pem),
// serve HTTPS so phones get a secure context — camera access (getUserMedia)
// is blocked by browsers on plain http except on localhost. Falls back to
// plain http if no certificate is present, so this still runs unmodified
// on a machine that hasn't generated one.
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');
const hasCert = fs.existsSync(certPath) && fs.existsSync(keyPath);

const server = hasCert
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
  : http.createServer(app);

// Bind to 0.0.0.0 (not just localhost) so phones on the same Wi-Fi/LAN can reach this server.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at ${process.env.API_BASE_URL || 'http://localhost:' + PORT}`);
  console.log(`Serving over ${hasCert ? 'HTTPS (mkcert)' : 'plain HTTP — camera access will be blocked on phones'}`);
  console.log(`Listening on all network interfaces, port ${PORT}`);
});
