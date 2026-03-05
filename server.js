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
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', methods: ['GET','POST','PATCH','DELETE'] }));
app.use(express.json());
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
