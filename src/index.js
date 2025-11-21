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

// Environment configuration
const MONGO = process.env.MONGO || 'mongodb://localhost:27017/kromaverse';
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret_key';
const DB_NAME = process.env.MONGO_DB || 'kromaverse';

// Game configuration
const MAX_GRID = 128;
const MAX_CUSTOM_COLORS = 6;
const MAX_TURNS = 64;
const TURN_REFILL_MS = 10000;
const ADMIN_USERNAME = 'admin';
mongoose.connect(MONGO, { dbName: DB_NAME })
  .then(() => console.log(`✓ Connected to MongoDB (db: ${DB_NAME})`))
  .catch(err => console.error('✗ MongoDB connection error:', err));

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cookieParser());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.set('trust proxy', 1);

// Session configuration
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: MONGO,
    dbName: DB_NAME,
    touchAfter: 24 * 3600
  }),
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);

// Serve static files
app.use(express.static(path.join(__dirname, 'frontend')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

// Info page route
app.get('/info', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/info.html'));
});

// Docs page route
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/docs.html'));
});

// Expose session to Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Authentication endpoints
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
    let user;
    try {
      user = await User.create({ username, passwordHash: hash });
    } catch (e) {
      console.error('Mongo create user error:', e);
      return res.status(500).json({ error: 'db', message: 'Database user create error' });
    }
    
    req.session.userId = user._id;
    // Force immediate persistence so Socket.IO can see it without refresh
    req.session.save((err) => {
      if (err) {
        console.error('Session save error (register):', err);
        return res.status(500).json({ error: 'session', message: 'Registration session error' });
      }
      res.json({ 
        ok: true, 
        user: { 
          id: user._id, 
          username: user.username,
          customColors: user.customColors || []
        } 
      });
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
    
    let user;
    try {
      user = await User.findOne({ username });
    } catch (e) {
      console.error('Mongo find user error:', e);
      return res.status(500).json({ error: 'db', message: 'Database lookup error' });
    }
    if (!user) {
      return res.status(400).json({ error: 'invalid', message: 'Invalid credentials' });
    }
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(400).json({ error: 'invalid', message: 'Invalid credentials' });
    }
    
    req.session.userId = user._id;
    req.session.save((err) => {
      if (err) {
        console.error('Session save error (login):', err);
        return res.status(500).json({ error: 'session', message: 'Login session error' });
      }
      res.json({ 
        ok: true, 
        user: { 
          id: user._id, 
          username: user.username,
          customColors: user.customColors || []
        } 
      });
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
    
    const user = await User.findById(req.session.userId).select('_id username pixelsPlaced lastPlacedAt customColors turnsRemaining lastTurnRefill');
    
    if (!user) {
      return res.json({ user: null });
    }
    
    // Refill turns continuously if refill timer is active
    if (user.lastTurnRefill && user.turnsRemaining < MAX_TURNS) {
      const now = Date.now();
      const msSinceRefill = now - user.lastTurnRefill.getTime();
      const turnsToRefill = Math.floor(msSinceRefill / TURN_REFILL_MS);
      
      if (turnsToRefill > 0) {
        // Calculate new turn count (cap at MAX_TURNS)
        const newTurns = Math.min(MAX_TURNS, user.turnsRemaining + turnsToRefill);
        user.turnsRemaining = newTurns;
        
        // Update refill timestamp by the number of turns actually refilled
        const actualRefilled = newTurns - user.turnsRemaining + turnsToRefill;
        user.lastTurnRefill = new Date(user.lastTurnRefill.getTime() + (actualRefilled * TURN_REFILL_MS));
        
        // If maxed out, clear refill timer
        if (user.turnsRemaining >= MAX_TURNS) {
          user.lastTurnRefill = null;
        }
        
        await user.save();
      }
    }
    
    const userData = {
      _id: user._id,
      username: user.username,
      pixelsPlaced: user.pixelsPlaced,
      turnsRemaining: user.turnsRemaining,
      lastTurnRefill: user.lastTurnRefill ? user.lastTurnRefill.getTime() : null,
      maxTurns: MAX_TURNS,
      refillMs: TURN_REFILL_MS,
      customColors: user.customColors || []
    };
    
    res.json({ user: userData });
    
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'server', message: 'Failed to fetch user' });
  }
});

// Pixel and color endpoints
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

// Save a newly picked custom color
app.post('/api/color', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'not-auth' });
    }
    const { color } = req.body;
    if (!color || typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return res.status(400).json({ error: 'invalid-color' });
    }
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'user-not-found' });
    // Normalize color to uppercase
    const upper = color.toUpperCase();
    // If already present move it to front (most recent)
    user.customColors = user.customColors.filter(c => c !== upper);
    user.customColors.unshift(upper);
    // Trim to max
    if (user.customColors.length > MAX_CUSTOM_COLORS) {
      user.customColors = user.customColors.slice(0, MAX_CUSTOM_COLORS);
    }
    await user.save();
    res.json({ ok: true, customColors: user.customColors });
  } catch (err) {
    console.error('Save color error:', err);
    res.status(500).json({ error: 'server' });
  }
});

// WebSocket handlers
io.on('connection', (socket) => {
  const userId = socket.request.session?.userId?.toString() || null;
  console.log(`User connected: ${userId || 'anonymous'}`);

  // Allow client to check auth status
  socket.on('auth_probe', (cb) => {
    const id = socket.request.session?.userId?.toString() || null;
    if (typeof cb === 'function') {
      cb({ authenticated: !!id, userId: id });
    } else {
      socket.emit('auth_status', { authenticated: !!id, userId: id });
    }
  });
  
  socket.on('place_pixel', async ({ x, y, color }) => {
    try {
      // Reload session for latest state
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
      
      if (x < 0 || x >= MAX_GRID || y < 0 || y >= MAX_GRID) {
        return socket.emit('err', 'out-of-bounds');
      }
      
      // Validate color format
      if (!color || typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return socket.emit('err', 'invalid-color');
      }
      
      // Get user
      const user = await User.findById(freshUserId);
      if (!user) {
        return socket.emit('err', 'user-not-found');
      }

      // Rate limiting
      if (user.username !== ADMIN_USERNAME) {
        const now = Date.now();
        
        // Check if we need to refill turns
        if (user.lastTurnRefill && user.turnsRemaining < MAX_TURNS) {
          const msSinceRefill = now - user.lastTurnRefill.getTime();
          const turnsToRefill = Math.floor(msSinceRefill / TURN_REFILL_MS);
          
          if (turnsToRefill > 0) {
            const newTurns = Math.min(MAX_TURNS, user.turnsRemaining + turnsToRefill);
            user.turnsRemaining = newTurns;
            
            const actualRefilled = newTurns - user.turnsRemaining + turnsToRefill;
            user.lastTurnRefill = new Date(user.lastTurnRefill.getTime() + (actualRefilled * TURN_REFILL_MS));
            
            // Clear refill timer if maxed out
            if (user.turnsRemaining >= MAX_TURNS) {
              user.lastTurnRefill = null;
            }
          }
        }
        
        // Check if user has turns available
        if (user.turnsRemaining <= 0) {
          return socket.emit('err', 'no-turns');
        }
        
        // Consume one turn
        user.turnsRemaining--;
        
        // Start refill timer if turns depleted
        if (user.turnsRemaining === 0) {
          user.lastTurnRefill = new Date(now);
        }
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
      
      // Update user stats and save
      user.lastPlacedAt = new Date();
      user.pixelsPlaced = (user.pixelsPlaced || 0) + 1;
      await user.save();
      
      // Broadcast to all clients
      io.emit('pixel_update', {
        x,
        y,
        color: pixel.color,
        user: user.username,
        updatedAt: pixel.updatedAt
      });
      
      // Send turns update to this user
      if (user.username !== ADMIN_USERNAME) {
        const refillInfo = {
          turnsRemaining: user.turnsRemaining,
          lastTurnRefill: user.lastTurnRefill ? user.lastTurnRefill.getTime() : null,
          maxTurns: MAX_TURNS,
          refillMs: TURN_REFILL_MS
        };
        socket.emit('turns_update', refillInfo);
      }
      
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

// Server startup
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

