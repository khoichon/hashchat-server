require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const uploadRoutes   = require('./src/routes/upload');
const adminRoutes    = require('./src/routes/admin');
const messagesRoutes = require('./src/routes/messages');
const pushRoutes     = require('./src/routes/push');
const invitesRoutes  = require('./src/routes/invites');
const roomsRoutes    = require('./src/routes/rooms');
const { globalLimiter } = require('./src/middleware/rateLimit');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Lock CORS to your domain in production
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no origin header) and allowed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('not allowed by CORS'));
  },
  methods: ['GET','POST','PATCH','DELETE'],
  credentials: true,
}));

app.use(express.json({ limit: '50kb' })); // prevent giant request bodies
app.use(globalLimiter);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/upload',       uploadRoutes);
app.use('/admin',        adminRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/push',     pushRoutes);
app.use('/api/invites',  invitesRoutes);
app.use('/api/rooms',    roomsRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'internal server error' });
});

app.listen(PORT, () => console.log('HashChat server on :' + PORT));
