# 🎨 KromaVerse

A collaborative pixel art canvas where users paint together in real-time.

## What is it?

KromaVerse is a 128×128 pixel canvas where anyone can place colored pixels. Think r/place, but simpler. Each user gets turns to place pixels, which refill over time. All changes sync instantly across all connected clients.

## Features

- **Real-time collaboration** via WebSocket
- **Turn-based rate limiting** (64 max turns, refills 1 per 10 seconds)
- **Custom color palette** with color picker
- **Pan & zoom controls** for easy navigation
- **User accounts** with session persistence
- **Mobile-friendly** touch controls

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO, MongoDB
- **Frontend**: Vanilla JavaScript, HTML5 Canvas
- **Auth**: bcrypt, express-session

## Setup

### Prerequisites

- Node.js (v16+)
- MongoDB (local or remote)

### Installation

```bash
# Clone the repo
git clone https://github.com/sea-deep/kromaverse.git
cd kromaverse

# Install dependencies
cd src
npm install

# Set up environment variables
# Create a .env file in the src/ directory:
# MONGO=mongodb://localhost:27017/kromaverse
# PORT=3000
# SESSION_SECRET=your-secret-key
# NODE_ENV=development

# Start MongoDB (if running locally)
mongod

# Run the server
npm start
```

The app will be available at `http://localhost:3000`

## Usage

1. **Register/Login** - Click the login button in the top-right
2. **Pick a color** - Select from the palette or use the color picker
3. **Place pixels** - Click on the canvas to place pixels
4. **Pan & zoom** - Drag to pan, scroll to zoom, or use the zoom controls

## Configuration

Edit these constants in `index.js`:

- `MAX_GRID` - Canvas size (default: 128)
- `MAX_TURNS` - Maximum accumulated turns (default: 64)
- `TURN_REFILL_MS` - Time per turn refill in milliseconds (default: 10000)
- `MAX_CUSTOM_COLORS` - Custom colors stored per user (default: 6)
- `ADMIN_USERNAME` - Username exempt from rate limits (default: 'admin')

## Project Structure

```
src/
├── index.js          # Express server & Socket.IO handlers
├── package.json      # Dependencies
├── models/
│   ├── User.js       # User schema (MongoDB)
│   └── Pixel.js      # Pixel schema (MongoDB)
└── frontend/
    ├── index.html    # Main canvas page
    ├── info.html     # Info page
    ├── docs.html     # Documentation page
    ├── main.css      # Styles
    └── main.js       # Client-side logic
```

## License

ISC
