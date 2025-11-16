require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const path = require('path');

const User = require('./models/User');
const Pixel = require('./models/Pixel');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

// Environment variables
const MONGO = process.env.MONGO || 'mongodb://localhost:27017/kromaverse';
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret_key';
const COOLDOWN_MS = 3000; // 3 seconds cooldown

// Connect to MongoDB
mongoose.connect(MONGO)
  .then(() => console.log('✓ Connected to MongoDB'))
  .catch(err => console.error('✗ MongoDB connection error:', err));

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for simplicity
}));
app.use(cookieParser());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
// Trust the first proxy (needed for secure cookies on Railway/Heroku)
app.set('trust proxy', 1);

// Session configuration
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: MONGO,
    touchAfter: 24 * 3600 // Lazy session update
  }),
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);

// Serve static files from new frontend path
app.use(express.static(path.join(__dirname, 'frontend')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

// Expose session to Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// ==================== AUTH APIs ====================
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Minimal validation: only require presence; allow any values
    if (!username || !password) {
      return res.status(400).json({ error: 'missing', message: 'Username and password required' });
    }
    
    // Check if user exists
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: 'exists', message: 'Username already taken' });
    }
    
    // Create user
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash: hash });
    
    req.session.userId = user._id;
    
    res.json({ 
      ok: true, 
      user: { 
        id: user._id, 
        username: user.username 
      } 
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'server', message: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Minimal validation: just require presence
    if (!username || !password) {
      return res.status(400).json({ error: 'missing', message: 'Username and password required' });
    }
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'invalid', message: 'Invalid credentials' });
    }
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(400).json({ error: 'invalid', message: 'Invalid credentials' });
    }
    
    req.session.userId = user._id;
    
    res.json({ 
      ok: true, 
      user: { 
        id: user._id, 
        username: user.username 
      } 
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'server', message: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'server', message: 'Logout failed' });
    }
    res.json({ ok: true });
  });
});

app.get('/api/me', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.json({ user: null });
    }
    
    const user = await User.findById(req.session.userId).select('_id username lastPlacedAt');
    
    if (!user) {
      return res.json({ user: null });
    }
    
    res.json({ user });
    
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'server', message: 'Failed to fetch user' });
  }
});

// ==================== PIXELS API ====================
app.get('/api/pixels', async (req, res) => {
  try {
    const pixels = await Pixel.find({}, 'x y color updatedAt')
      .sort({ updatedAt: -1 })
      .lean();
    
    res.json({ pixels });
    
  } catch (error) {
    console.error('Pixels fetch error:', error);
    res.status(500).json({ error: 'server', message: 'Failed to fetch pixels' });
  }
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  const logUserId = () => {
    const currentId = socket.request.session?.userId?.toString() || null;
    console.log(`User connected: ${currentId || 'anonymous'}`);
  };
  logUserId();
  
  socket.on('place_pixel', async ({ x, y, color }) => {
    try {
      // Reload session to pick up latest login state
      const freshUserId = await new Promise((resolve) => {
        const sess = socket.request.session;
        if (sess && typeof sess.reload === 'function') {
          sess.reload(() => resolve(sess?.userId?.toString() || null));
        } else {
          resolve(sess?.userId?.toString() || null);
        }
      });
      
      if (!freshUserId) return socket.emit('err', 'not-auth');
      
      // Validate coordinates
      if (typeof x !== 'number' || typeof y !== 'number') {
        return socket.emit('err', 'invalid-coords');
      }
      
      if (x < 0 || x >= 64 || y < 0 || y >= 64) {
        return socket.emit('err', 'out-of-bounds');
      }
      
      // Validate color (basic hex check)
      if (!color || typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return socket.emit('err', 'invalid-color');
      }
      
      // Get user
      const user = await User.findById(freshUserId);
      if (!user) {
        return socket.emit('err', 'user-not-found');
      }
      
      // Check cooldown
      const now = Date.now();
      if (user.lastPlacedAt && (now - user.lastPlacedAt.getTime()) < COOLDOWN_MS) {
        const remaining = COOLDOWN_MS - (now - user.lastPlacedAt.getTime());
        return socket.emit('cooldown', { left: remaining });
      }
      
      // Update or create pixel
      const pixel = await Pixel.findOneAndUpdate(
        { x, y },
        { 
          color: color.toUpperCase(), 
          user: user._id, 
          updatedAt: new Date() 
        },
        { upsert: true, new: true }
      );
      
      // Update user's last placed time
      user.lastPlacedAt = new Date();
      await user.save();
      
      // Broadcast to all clients
      io.emit('pixel_update', {
        x,
        y,
        color: pixel.color,
        user: user.username,
        updatedAt: pixel.updatedAt
      });
      
    } catch (error) {
      console.error('Place pixel error:', error);
      socket.emit('err', 'server');
    }
  });
  
  socket.on('disconnect', () => {
    const currentId = socket.request.session?.userId?.toString() || null;
    console.log(`User disconnected: ${currentId || 'anonymous'}`);
  });
});

// ==================== START SERVER ====================
// Helpful error for common startup issues
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n✗ Port ${PORT} is already in use.`);
    console.error('Fix options:');
    console.error(`  - Stop the existing process using: lsof -i :${PORT} -sTCP:LISTEN -n -P`);
    console.error('    then kill the PID shown: kill -TERM <PID>');
    console.error(`  - Or run on another port: PORT=${PORT + 1} node .`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`🎨 KromaVerse server running on http://localhost:${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});

