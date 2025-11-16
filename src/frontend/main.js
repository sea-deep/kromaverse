// KromaVerse - Client JavaScript
const socket = io();
const GRID_SIZE = 64;
const CELL_SIZE = 10;

// 12 beautiful color choices
const PALETTE_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#FFA07A', // Light Salmon
  '#98D8C8', // Mint
  '#F7DC6F', // Yellow
  '#BB8FCE', // Purple
  '#F8B739', // Orange
  '#52B788', // Green
  '#E91E63', // Pink
  '#546E7A', // Blue Gray
  '#FFFFFF'  // White
];

let selectedColor = PALETTE_COLORS[0];
let user = null;
let cooldownLeft = 0;
let cooldownTimer = null;
let pixelCount = 0;

// Pan & Zoom state
let scale = 1;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let startX = 0;
let startY = 0;
let dragDistance = 0;

// DOM Elements
const gridEl = document.getElementById('grid');
const paletteEl = document.getElementById('palette');
const colorPreview = document.getElementById('colorPreview');
const selectedColorLabel = document.getElementById('selectedColorLabel');
const cooldownEl = document.getElementById('cooldown');
const pixelCountEl = document.getElementById('pixelCount');
const viewport = document.getElementById('viewport');

const usernameInp = document.getElementById('username');
const passwordInp = document.getElementById('password');
const btnLogin = document.getElementById('btnLogin');
const btnReg = document.getElementById('btnReg');
const btnLogout = document.getElementById('btnLogout');
const userInfo = document.getElementById('userInfo');
const authForms = document.getElementById('authForms');

const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const resetViewBtn = document.getElementById('resetView');
const zoomLevelEl = document.getElementById('zoomLevel');
const notificationEl = document.getElementById('notification');
const mobileAuth = document.getElementById('mobileAuth');
const mobileTimer = document.getElementById('mobileTimer');

// ===== NOTIFICATION SYSTEM =====
function showNotification(message, type = 'info') {
  notificationEl.textContent = message;
  notificationEl.className = `notification ${type}`;
  notificationEl.classList.add('show');
  
  setTimeout(() => {
    notificationEl.classList.remove('show');
  }, 3000);
}

// ===== BUILD COLOR PALETTE =====
PALETTE_COLORS.forEach((color, index) => {
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.style.background = color;
  swatch.dataset.color = color;
  
  if (index === 0) {
    swatch.classList.add('selected');
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

// Initialize color display
colorPreview.style.background = selectedColor;
selectedColorLabel.textContent = selectedColor;

// ===== BUILD GRID (64×64) =====
for (let y = 0; y < GRID_SIZE; y++) {
  for (let x = 0; x < GRID_SIZE; x++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.x = x;
    cell.dataset.y = y;
    
    // Add both click and touch events
    cell.addEventListener('click', onCellClick);
    cell.addEventListener('touchend', onCellClick);
    
    gridEl.appendChild(cell);
  }
}

// ===== ZOOM & PAN CONTROLS =====
function updateTransform() {
  gridEl.style.transform = `translate(-50%, -50%) translate(${translateX}px, ${translateY}px) scale(${scale})`;
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
    userInfo.textContent = `👤 ${user.username}`;
    userInfo.style.display = 'block';
    btnLogout.style.display = 'block';
    authForms.style.display = 'none';
    // Update compact mobile auth indicator
    if (mobileAuth) mobileAuth.innerHTML = `<span class="icon">👤</span><span class="text">${user.username}</span>`;
  } else {
    userInfo.style.display = 'none';
    btnLogout.style.display = 'none';
    authForms.style.display = 'flex';
    if (mobileAuth) mobileAuth.innerHTML = `<span class="icon">🔐</span><span class="text">Login</span>`;
  }
}

// Toggle auth overlay when tapping compact auth
if (mobileAuth) {
  mobileAuth.addEventListener('click', () => {
    const authSection = document.querySelector('.auth-section');
    if (!authSection) return;
    authSection.classList.toggle('show');
  });
}

// ===== LOAD USER SESSION =====
async function loadMe() {
  try {
    const response = await fetch('/api/me');
    const data = await response.json();
    user = data.user;
    renderUser();
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
  const index = y * GRID_SIZE + x;
  const cell = gridEl.children[index];
  if (cell) {
    cell.style.background = color;
    cell.style.borderColor = 'transparent';
  }
}

function updatePixelCount() {
  pixelCountEl.textContent = `${pixelCount.toLocaleString()} pixels placed`;
}

// ===== HANDLE CELL CLICKS =====
function onCellClick(e) {
  // Prevent default to avoid double-firing on touch devices
  if (e.type === 'touchend') {
    e.preventDefault();
  }
  
  // Ignore clicks that were actually drags (mouse or touch)
  if (dragDistance > 5 || touchDragDistance > 20) { // touch accumulates faster, use larger threshold
    return;
  }
  
  if (!user) {
    showNotification('Please login to place pixels 🎨', 'warning');
    return;
  }
  
  if (cooldownLeft > 0) {
    showNotification(`Wait ${cooldownLeft}s before placing another pixel ⏱️`, 'warning');
    return;
  }
  
  const x = parseInt(this.dataset.x);
  const y = parseInt(this.dataset.y);
  
  // Optimistic UI update
  this.classList.add('placing');
  setTimeout(() => this.classList.remove('placing'), 300);
  
  // Emit socket event
  socket.emit('place_pixel', { x, y, color: selectedColor });
}

// ===== SOCKET EVENT HANDLERS =====
socket.on('pixel_update', ({ x, y, color, user: username }) => {
  paintCell(x, y, color);
  pixelCount++;
  updatePixelCount();
  
  // Show notification for own pixels
  if (user && username === user.username) {
    showNotification('Pixel placed! 🎨', 'success');
  }
});

socket.on('cooldown', ({ left }) => {
  startCooldown(left);
});

socket.on('err', (message) => {
  if (message === 'not-auth') {
    showNotification('Please login to place pixels', 'error');
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

// ===== COOLDOWN SYSTEM =====
function startCooldown(ms) {
  cooldownLeft = Math.ceil(ms / 1000);
  updateCooldownDisplay();
  
  if (cooldownTimer) clearInterval(cooldownTimer);
  
  cooldownTimer = setInterval(() => {
    cooldownLeft--;
    updateCooldownDisplay();
    
    if (cooldownLeft <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 1000);
}

function updateCooldownDisplay() {
  if (cooldownLeft > 0) {
    cooldownEl.textContent = `Wait ${cooldownLeft}s`;
    cooldownEl.className = 'status-text cooldown';
    if (mobileTimer) mobileTimer.textContent = `⏱️ ${cooldownLeft}s`;
  } else {
    cooldownEl.textContent = 'Ready to place! ✓';
    cooldownEl.className = 'status-text ready';
    if (mobileTimer) mobileTimer.textContent = '✓ Ready';
  }
}

// ===== INITIALIZE APP =====
async function init() {
  await loadMe();
  await fetchAndPaint();
  updateCooldownDisplay();
  
  // Welcome message
  if (user) {
    showNotification(`Welcome back, ${user.username}! 🎨`, 'success');
  } else {
    showNotification('Welcome to KromaVerse! 🎨', 'info');
  }
}

// Start the app
init();
