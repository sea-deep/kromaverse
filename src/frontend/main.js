// KromaVerse - Client JavaScript
const socket = io();
const GRID_SIZE = 128; // Expanded grid size
const CELL_SIZE = 10;

// Base palette: 24 preset colors (broad spectrum & neutrals)
const BASE_PALETTE = [
  '#FF0000','#FF7F00','#FFB300','#FFFF00',
  '#A8FF00','#00FF00','#00FF7F','#00FFC8',
  '#00FFFF','#00BFFF','#008CFF','#0000FF',
  '#4B0082','#8B00FF','#FF00FF','#FF69B4',
  '#FF1493','#8B4513','#D2B48C','#FFFFFF',
  '#D3D3D3','#808080','#000000','#4ECDC4'
]; // Last color (#4ECDC4 accent) can be replaced by custom colors

let PALETTE_COLORS = [...BASE_PALETTE];

let selectedColor = PALETTE_COLORS[0];
let customColors = []; // From user account
let user = null;
let turnsRemaining = 64;
let lastTurnRefill = null;
let maxTurns = 64;
let refillMs = 10000;
let refillTimerInterval = null;
let pixelCount = 0;
let pickerDebounceTimer = null; // Debounce color picker saves

// Pan & Zoom state
let scale = 1;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;
let dragDistance = 0;

// DOM Elements
const gridCanvas = document.getElementById('gridCanvas');
const gridCtx = gridCanvas ? gridCanvas.getContext('2d', { alpha: false }) : null;
const paletteEl = document.getElementById('palette');
const colorPreview = document.getElementById('colorPreview');
const selectedColorLabel = document.getElementById('selectedColorLabel');
const turnsCountEl = document.getElementById('turnsCount');
const pixelCountEl = document.getElementById('pixelsCount'); // Fixed: was 'pixelCount', should be 'pixelsCount'
const viewport = document.getElementById('viewport');

const usernameInp = document.getElementById('usernameModal');
const passwordInp = document.getElementById('passwordModal');
const btnLogin = document.getElementById('btnLoginModal');
const btnReg = document.getElementById('btnRegModal');
const btnLogout = document.getElementById('btnLogoutModal');
const userInfo = document.getElementById('authModalUserInfo');
const authForms = document.getElementById('authModalForms');

const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const resetViewBtn = document.getElementById('resetView');
const zoomLevelEl = document.getElementById('zoomLevel');
const notificationEl = document.getElementById('notification');
const authMenuBtn = document.getElementById('authMenuBtn');
const authMenuLabel = document.getElementById('authMenuLabel');
const authModal = document.getElementById('authModal');
const authModalClose = document.getElementById('authModalClose');
const authModalTitle = document.getElementById('authModalTitle');
const paletteToggle = document.getElementById('paletteToggle');

// ===== NOTIFICATION SYSTEM =====
function showNotification(message, type = 'info') {
  notificationEl.textContent = message;
  notificationEl.className = `notification ${type}`;
  notificationEl.classList.add('show');
  
  setTimeout(() => {
    notificationEl.classList.remove('show');
  }, 3000);
}

// ===== BUILD / REBUILD COLOR PALETTE =====
function rebuildPalette() {
  paletteEl.innerHTML = '';
  // Clone base palette
  PALETTE_COLORS = [...BASE_PALETTE];
  // Replace tail colors with custom colors (up to MAX_CUSTOM_COLORS from server)
  if (customColors.length) {
    const replaceCount = Math.min(customColors.length, 6);
    for (let i = 0; i < replaceCount; i++) {
      // Replace from end backwards (keep early spectrum stable)
      const idx = PALETTE_COLORS.length - 1 - i;
      PALETTE_COLORS[idx] = customColors[i];
    }
  }
  PALETTE_COLORS.forEach((color, index) => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.background = color;
    swatch.dataset.color = color;
    if (index === 0 && !selectedColor) {
      swatch.classList.add('selected');
      selectedColor = color;
    }
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = color;
      selectedColorLabel.textContent = color;
      colorPreview.style.background = color;
    });
    paletteEl.appendChild(swatch);
  });
  // Add color picker swatch
  const pickerSwatch = document.createElement('div');
  pickerSwatch.className = 'color-swatch color-picker-swatch';
  pickerSwatch.innerHTML = '<input type="color" id="colorPicker" class="color-picker-input" value="#FF1493" />';
  paletteEl.appendChild(pickerSwatch);
  const colorPicker = document.getElementById('colorPicker');
  colorPicker.addEventListener('input', (e) => {
    const picked = e.target.value.toUpperCase();
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    pickerSwatch.classList.add('selected');
    selectedColor = picked;
    selectedColorLabel.textContent = picked;
    colorPreview.style.background = picked;
    // Debounce save: only persist after 500ms of no changes
    if (pickerDebounceTimer) clearTimeout(pickerDebounceTimer);
    pickerDebounceTimer = setTimeout(() => {
      if (user && !customColors.includes(picked)) {
        saveCustomColor(picked);
      }
    }, 500);
  });
  colorPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    pickerSwatch.classList.add('selected');
  });
  // Initialize display values
  colorPreview.style.background = selectedColor;
  selectedColorLabel.textContent = selectedColor;
}

async function saveCustomColor(color) {
  try {
    const resp = await fetch('/api/color', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color })
    });
    const data = await resp.json();
    if (data.ok) {
      customColors = data.customColors;
      rebuildPalette();
    }
  } catch (err) {
    console.error('Failed to save custom color:', err);
  }
}

// ===== INITIAL PALETTE BUILD =====
rebuildPalette();

// ===== BUILD CANVAS GRID (128×128) =====
if (gridCanvas && gridCtx) {
  gridCanvas.width = GRID_SIZE * CELL_SIZE;
  gridCanvas.height = GRID_SIZE * CELL_SIZE;
  // Disable image smoothing for crisp pixels
  gridCtx.imageSmoothingEnabled = false;
  // Fill with white background
  gridCtx.fillStyle = '#FFFFFF';
  gridCtx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);
  // Draw grid lines
  gridCtx.strokeStyle = 'rgba(203, 213, 224, 0.4)';
  gridCtx.lineWidth = 0.5;
  for (let i = 0; i <= GRID_SIZE; i++) {
    // Vertical lines
    gridCtx.beginPath();
    gridCtx.moveTo(i * CELL_SIZE, 0);
    gridCtx.lineTo(i * CELL_SIZE, gridCanvas.height);
    gridCtx.stroke();
    // Horizontal lines
    gridCtx.beginPath();
    gridCtx.moveTo(0, i * CELL_SIZE);
    gridCtx.lineTo(gridCanvas.width, i * CELL_SIZE);
    gridCtx.stroke();
  }
}

// ===== CANVAS CLICK HANDLER =====
if (gridCanvas) {
  gridCanvas.addEventListener('click', onCanvasClick);
  gridCanvas.addEventListener('touchend', onCanvasClick);
}

// ===== ZOOM & PAN CONTROLS =====
function updateTransform() {
  if (gridCanvas) {
    // Calculate pan limits based on scale (allow some overflow for comfort)
    const canvasSize = GRID_SIZE * CELL_SIZE * scale;
    const maxPan = canvasSize * 0.75; // Allow panning up to 75% beyond edges
    
    // Clamp translate values
    translateX = Math.max(-maxPan, Math.min(maxPan, translateX));
    translateY = Math.max(-maxPan, Math.min(maxPan, translateY));
    
    gridCanvas.style.transform = `translate(-50%, -50%) translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }
  zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
}

function resetView() {
  scale = 1;
  translateX = 0;
  translateY = 0;
  updateTransform();
}

// Initialize position
updateTransform();

// Zoom buttons
zoomInBtn.addEventListener('click', () => {
  scale = Math.min(scale * 1.2, 8);
  updateTransform();
});

zoomOutBtn.addEventListener('click', () => {
  scale = Math.max(scale / 1.2, 0.5);
  updateTransform();
});

resetViewBtn.addEventListener('click', resetView);

// Mouse wheel zoom
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = -e.deltaY;
  const zoomFactor = delta > 0 ? 1.1 : 0.9;
  
  scale = Math.max(0.5, Math.min(8, scale * zoomFactor));
  updateTransform();
}, { passive: false });

// Panning
viewport.addEventListener('mousedown', (e) => {
  isPanning = true;
  dragDistance = 0;
  startX = e.clientX - translateX;
  startY = e.clientY - translateY;
  viewport.style.cursor = 'grabbing';
});

window.addEventListener('mouseup', () => {
  isPanning = false;
  viewport.style.cursor = 'grab';
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  const newX = e.clientX - startX;
  const newY = e.clientY - startY;
  const deltaX = newX - translateX;
  const deltaY = newY - translateY;
  dragDistance += Math.abs(deltaX) + Math.abs(deltaY);
  translateX = newX;
  translateY = newY;
  updateTransform();
});

// Touch support for mobile
let lastTouchDistance = 0;
let lastTouchX = 0;
let lastTouchY = 0;
let touchDragDistance = 0;

viewport.addEventListener('touchstart', (e) => {
  touchDragDistance = 0;
  if (e.touches.length === 1) {
    // Always allow panning start with single finger
    isPanning = true;
    startX = e.touches[0].clientX - translateX;
    startY = e.touches[0].clientY - translateY;
    lastTouchX = e.touches[0].clientX;
    lastTouchY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    // Two finger touch - zoom
    isPanning = false;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
  }
}, { passive: false });

viewport.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1 && isPanning) {
    // Pan
    e.preventDefault();
    const newX = e.touches[0].clientX - startX;
    const newY = e.touches[0].clientY - startY;
    touchDragDistance += Math.abs(newX - translateX) + Math.abs(newY - translateY);
    translateX = newX;
    translateY = newY;
    updateTransform();
  } else if (e.touches.length === 2) {
    // Pinch zoom
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (lastTouchDistance > 0) {
      const delta = distance - lastTouchDistance;
      const zoomFactor = 1 + (delta * 0.01);
      scale = Math.max(0.5, Math.min(8, scale * zoomFactor));
      updateTransform();
    }
    
    lastTouchDistance = distance;
  }
}, { passive: false });

viewport.addEventListener('touchend', (e) => {
  isPanning = false;
  if (e.touches.length < 2) {
    lastTouchDistance = 0;
  }
});

// ===== AUTH HANDLERS =====
btnReg.addEventListener('click', async () => {
  const username = usernameInp.value.trim();
  const password = passwordInp.value.trim();
  
  if (!username || !password) {
    showNotification('Please enter username and password', 'error');
    return;
  }
  
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      // Refresh so session is active everywhere immediately
      window.location.reload();
    } else {
      showNotification(data.error === 'exists' ? 'Username already taken' : 'Registration failed', 'error');
    }
  } catch (error) {
    showNotification('Connection error', 'error');
  }
});

btnLogin.addEventListener('click', async () => {
  const username = usernameInp.value.trim();
  const password = passwordInp.value.trim();
  
  if (!username || !password) {
    showNotification('Please enter username and password', 'error');
    return;
  }
  
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      // Refresh so session is active everywhere immediately
      window.location.reload();
    } else {
      showNotification('Invalid username or password', 'error');
    }
  } catch (error) {
    showNotification('Connection error', 'error');
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
    // Refresh to clear state fully
    window.location.reload();
  } catch (error) {
    showNotification('Logout failed', 'error');
  }
});

// Enter key to login
passwordInp.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnLogin.click();
  }
});

function renderUser() {
  if (user) {
    authModalTitle.textContent = 'Account';
    userInfo.textContent = `👤 ${user.username}`;
    userInfo.style.display = 'block';
    btnLogout.style.display = 'block';
    authForms.style.display = 'none';
    authMenuLabel.textContent = user.username;
    // Show stats
    document.getElementById('turnsDisplay').style.display = 'block';
    document.getElementById('pixelsDisplay').style.display = 'block';
    if (typeof user.pixelsPlaced === 'number') {
      document.getElementById('pixelsCount').textContent = user.pixelsPlaced;
    }
  } else {
    authModalTitle.textContent = 'Login / Register';
    userInfo.style.display = 'none';
    btnLogout.style.display = 'none';
    authForms.style.display = 'flex';
    authMenuLabel.textContent = 'Login';
    // Hide stats when not logged in
    document.getElementById('turnsDisplay').style.display = 'none';
    document.getElementById('refillTimer').style.display = 'none';
    document.getElementById('pixelsDisplay').style.display = 'none';
  }
}

// Auth modal toggle
if (authMenuBtn) {
  authMenuBtn.addEventListener('click', () => {
    authModal.classList.add('show');
  });
}
if (authModalClose) {
  authModalClose.addEventListener('click', () => {
    authModal.classList.remove('show');
  });
}
// Close modal on backdrop click
if (authModal) {
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) {
      authModal.classList.remove('show');
    }
  });
}

// Palette collapse/expand toggle
if (paletteToggle) {
  const paletteSection = document.querySelector('.palette-section');
  const updateToggleLabel = (collapsed) => {
    paletteToggle.textContent = collapsed ? 'Show Palette' : 'Hide Palette';
    paletteToggle.setAttribute('aria-expanded', (!collapsed).toString());
  };
  paletteToggle.addEventListener('click', () => {
    const collapsed = paletteSection.classList.toggle('collapsed');
    document.body.classList.toggle('palette-collapsed', collapsed);
    updateToggleLabel(collapsed);
  });
  // Initialize label state
  updateToggleLabel(false);
}

// ===== LOAD USER SESSION =====
async function loadMe() {
  try {
    const response = await fetch('/api/me');
    const data = await response.json();
    user = data.user;
    if (user && Array.isArray(user.customColors)) {
      customColors = user.customColors;
    }
    if (user && typeof user.turnsRemaining === 'number') {
      turnsRemaining = user.turnsRemaining;
      lastTurnRefill = user.lastTurnRefill;
      maxTurns = user.maxTurns || 64;
      refillMs = user.refillMs || 10000;
    }
    renderUser();
    rebuildPalette();
    
    if (user) {
      updateTurnsDisplay();
      startRefillTimer();
    }
  } catch (error) {
    console.error('Failed to load user session:', error);
  }
}

// ===== FETCH & PAINT PIXELS =====
async function fetchAndPaint() {
  try {
    const response = await fetch('/api/pixels');
    const data = await response.json();
    
    if (data.pixels) {
      pixelCount = data.pixels.length;
      updatePixelCount();
      
      data.pixels.forEach(p => {
        paintCell(p.x, p.y, p.color);
      });
    }
  } catch (error) {
    console.error('Failed to fetch pixels:', error);
  }
}

function paintCell(x, y, color) {
  if (!gridCtx) return;
  gridCtx.fillStyle = color;
  gridCtx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  // Redraw grid line borders for this cell
  gridCtx.strokeStyle = 'rgba(203, 213, 224, 0.4)';
  gridCtx.lineWidth = 0.5;
  gridCtx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
}

function updatePixelCount() {
  pixelCountEl.textContent = `${pixelCount.toLocaleString()}`;
}

function updateTurnsDisplay() {
  const turnsCountEl = document.getElementById('turnsCount');
  if (turnsCountEl) {
    turnsCountEl.textContent = `${turnsRemaining}/${maxTurns}`;
  }
}

function startRefillTimer() {
  // Clear existing timer
  if (refillTimerInterval) {
    clearInterval(refillTimerInterval);
    refillTimerInterval = null;
  }
  
  const refillTimerEl = document.getElementById('refillTimer');
  if (!refillTimerEl) return;
  
  // Show timer if refill is active (turns < MAX and timer started)
  if (lastTurnRefill && turnsRemaining < maxTurns) {
    refillTimerEl.style.display = 'block';
    
    refillTimerInterval = setInterval(async () => {
      const now = Date.now();
      const msSinceRefill = now - lastTurnRefill;
      const secondsUntilNext = Math.ceil((refillMs - (msSinceRefill % refillMs)) / 1000);
      
      document.getElementById('refillSeconds').textContent = secondsUntilNext;
      
      // Check if we should have refilled by now
      const turnsToRefill = Math.floor(msSinceRefill / refillMs);
      if (turnsToRefill > 0) {
        // Fetch updated turn count from server
        try {
          const response = await fetch('/api/me');
          const data = await response.json();
          if (data.user && data.user.turnsRemaining !== undefined) {
            turnsRemaining = data.user.turnsRemaining;
            lastTurnRefill = data.user.lastTurnRefill;
            updateTurnsDisplay();
            
            // Stop timer only if reached max turns or timer cleared
            if (turnsRemaining >= maxTurns || !lastTurnRefill) {
              clearInterval(refillTimerInterval);
              refillTimerInterval = null;
              refillTimerEl.style.display = 'none';
            }
          }
        } catch (error) {
          console.error('Failed to check turn refill:', error);
        }
      }
    }, 1000); // Check every second
  } else {
    // Hide timer if maxed out or no refill active
    refillTimerEl.style.display = 'none';
  }
}

// ===== HANDLE CANVAS CLICKS =====
function onCanvasClick(e) {
  // Prevent default to avoid double-firing on touch devices
  if (e.type === 'touchend') {
    e.preventDefault();
  }
  
  // Ignore clicks that were actually drags
  if (dragDistance > 5 || touchDragDistance > 20) {
    return;
  }
  
  if (!user) {
    showNotification('Please login to place pixels 🎨', 'warning');
    return;
  }
  
  // Check turns (admin has unlimited)
  if (user.username !== 'admin' && turnsRemaining <= 0) {
    showNotification('No turns remaining! Wait for refill ⏱️', 'warning');
    return;
  }
  
  // Get canvas-relative coordinates
  const rect = gridCanvas.getBoundingClientRect();
  const clientX = e.type === 'touchend' ? e.changedTouches[0].clientX : e.clientX;
  const clientY = e.type === 'touchend' ? e.changedTouches[0].clientY : e.clientY;
  const canvasX = (clientX - rect.left) / (rect.width / GRID_SIZE);
  const canvasY = (clientY - rect.top) / (rect.height / GRID_SIZE);
  
  const x = Math.floor(canvasX);
  const y = Math.floor(canvasY);
  
  // Validate bounds
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
  
  // Optimistic UI update (instant feedback)
  paintCell(x, y, selectedColor);
  
  // Optimistically decrement turns for non-admin
  if (user.username !== 'admin') {
    turnsRemaining--;
    updateTurnsDisplay();
  }
  
  // Emit socket event
  socket.emit('place_pixel', { x, y, color: selectedColor });
}

// ===== SOCKET EVENT HANDLERS =====
socket.on('pixel_update', ({ x, y, color, user: username }) => {
  paintCell(x, y, color);
  pixelCount++;
  updatePixelCount();
  // If this is our pixel, update our count
  if (username === user?.username && typeof user.pixelsPlaced === 'number') {
    user.pixelsPlaced++;
    document.getElementById('pixelsCount').textContent = user.pixelsPlaced;
  }
});

socket.on('turns_update', (data) => {
  if (typeof data === 'object') {
    turnsRemaining = data.turnsRemaining;
    lastTurnRefill = data.lastTurnRefill;
    maxTurns = data.maxTurns || 64;
    refillMs = data.refillMs || 10000;
  } else {
    // Fallback for old format
    turnsRemaining = data;
  }
  updateTurnsDisplay();
  startRefillTimer();
});

socket.on('err', (message) => {
  if (message === 'not-auth') {
    showNotification('Please login to place pixels', 'error');
  } else if (message === 'no-turns') {
    showNotification('No turns remaining! Refills 1 per 10s ⏱️', 'warning');
    turnsRemaining = 0;
    updateTurnsDisplay();
  } else {
    showNotification('An error occurred', 'error');
  }
});

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', () => {
  showNotification('Connection lost. Reconnecting...', 'warning');
});

socket.on('connect_error', () => {
  showNotification('Connection error', 'error');
});

// ===== INITIALIZE APP =====
async function init() {
  await loadMe(); // rebuildPalette called inside
  await fetchAndPaint();
  updateTurnsDisplay();
  
  // Welcome message
  if (user) {
    showNotification(`Welcome back, ${user.username}! 🎨`, 'success');
  } else {
    showNotification('Welcome to KromaVerse! 🎨', 'info');
  }
}

// Start the app
init();
