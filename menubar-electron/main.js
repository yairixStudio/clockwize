const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const https = require('http');

// Hide dock icon
app.dock?.hide();

let tray = null;
let authWindow = null;
let token = null;
let workspaceId = null;
let activeTimers = [];
let pollInterval = null;
let displayInterval = null;

// קובץ סשן משותף עם הדפדפן
const LOCAL_SESSION_FILE = path.join(__dirname, '..', '.local-session');

// טעינת הסשן מהקובץ המשותף (נכתב על ידי השרת אחרי התחברות בדפדפן)
function loadLocalSession() {
  try {
    if (fs.existsSync(LOCAL_SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOCAL_SESSION_FILE, 'utf8'));
      token = data.token;
      workspaceId = data.workspaceId;
      console.log('Loaded session from shared file');
      return true;
    }
  } catch (e) {
    console.error('Error loading local session:', e);
  }
  return false;
}

// בדיקה אם הסשן עדיין תקף
async function validateSession() {
  if (!token) return false;
  
  try {
    await apiRequest('GET', '/auth/me');
    return true;
  } catch (e) {
    console.log('Session invalid, clearing...');
    token = null;
    workspaceId = null;
    return false;
  }
}

function clearSession() {
  token = null;
  workspaceId = null;
}

// API Functions - קריאת הפורט מהקובץ המסונכרן
let API_PORT = 3000;
let API_BASE = `http://localhost:${API_PORT}/api`;

function getServerPort() {
  // קריאת הפורט מקובץ .server-port
  const portFile = path.join(__dirname, '..', '.server-port');
  try {
    if (fs.existsSync(portFile)) {
      return parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
    }
  } catch (e) {
    console.log('Port file not found, using default');
  }
  return 3000;
}

async function initAPI() {
  API_PORT = getServerPort();
  API_BASE = `http://localhost:${API_PORT}/api`;
  console.log(`Using API at port ${API_PORT}`);
}

function apiRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + endpoint);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...(workspaceId && { 'X-Workspace-Id': workspaceId })
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error || 'API Error'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function fetchActiveTimers() {
  if (!token || !workspaceId) return;
  
  try {
    activeTimers = await apiRequest('GET', '/timer/active');
    updateTrayMenu();
    updateTrayTitle();
  } catch (e) {
    console.error('Error fetching timers:', e);
  }
}

async function pauseTimer(timerId) {
  try {
    await apiRequest('POST', `/timer/pause/${timerId}`);
    await fetchActiveTimers();
  } catch (e) {
    console.error('Error pausing timer:', e);
  }
}

async function resumeTimer(timerId) {
  try {
    await apiRequest('POST', `/timer/resume/${timerId}`);
    await fetchActiveTimers();
  } catch (e) {
    console.error('Error resuming timer:', e);
  }
}

async function stopTimer(timerId) {
  try {
    await apiRequest('POST', `/timer/stop/${timerId}`, { notes: '' });
    await fetchActiveTimers();
    showNotification('Clockwize', 'הטיימר נשמר בהצלחה');
  } catch (e) {
    console.error('Error stopping timer:', e);
  }
}

// Tray Functions
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function calculateElapsed(timer) {
  let elapsed = timer.accumulated_seconds || 0;
  
  if (timer.is_running && timer.start_time) {
    const startTime = new Date(timer.start_time).getTime();
    const now = Date.now();
    elapsed += Math.floor((now - startTime) / 1000);
  }
  
  return elapsed;
}

function updateTrayTitle() {
  if (!tray) return;
  
  const primaryTimer = activeTimers[0];
  
  if (primaryTimer) {
    const elapsed = calculateElapsed(primaryTimer);
    const timeStr = formatTime(elapsed);
    const icon = primaryTimer.is_running ? '🟢' : '🟡';
    tray.setTitle(`${icon} ${timeStr}`);
  } else {
    tray.setTitle('⏱️');
  }
}

function updateTrayMenu() {
  if (!tray) return;
  
  const menuItems = [
    { label: '🕐 Clockwize', enabled: false },
    { type: 'separator' }
  ];
  
  if (!token || !workspaceId) {
    menuItems.push({ label: '🔐 התחבר בדפדפן', click: () => shell.openExternal(`http://localhost:5001/login`) });
    menuItems.push({ label: '(מסונכרן אוטומטית)', enabled: false });
  } else {
    const primaryTimer = activeTimers[0];
    
    if (primaryTimer) {
      const projectName = primaryTimer.project_name || 'פרויקט';
      const taskName = primaryTimer.task_name;
      let label = primaryTimer.is_running ? '▶️ ' : '⏸️ ';
      label += projectName;
      if (taskName) label += ` - ${taskName}`;
      
      menuItems.push({ label, enabled: false });
      
      if (primaryTimer.is_running) {
        menuItems.push({ 
          label: '⏸️ השהה', 
          click: () => pauseTimer(primaryTimer.id) 
        });
      } else {
        menuItems.push({ 
          label: '▶️ המשך', 
          click: () => resumeTimer(primaryTimer.id) 
        });
      }
      
      menuItems.push({ 
        label: '⏹️ עצור ושמור', 
        click: () => stopTimer(primaryTimer.id) 
      });
    } else {
      menuItems.push({ label: 'אין טיימר פעיל', enabled: false });
    }
    
    menuItems.push({ type: 'separator' });
    menuItems.push({ label: '🚪 התנתק', click: logout });
  }
  
  menuItems.push({ type: 'separator' });
  menuItems.push({ 
    label: '📱 פתח Clockwize', 
    click: () => shell.openExternal('http://localhost:5173'),
    accelerator: 'CmdOrCtrl+O'
  });
  menuItems.push({ type: 'separator' });
  menuItems.push({ label: 'יציאה', click: () => app.quit(), accelerator: 'CmdOrCtrl+Q' });
  
  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

function showNotification(title, body) {
  new Notification({ title, body }).show();
}

// Auth Window
function showAuthWindow() {
  if (authWindow) {
    authWindow.focus();
    return;
  }
  
  authWindow = new BrowserWindow({
    width: 400,
    height: 350,
    resizable: false,
    title: 'Clockwize - התחברות',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  authWindow.loadFile('index.html');
  
  authWindow.on('closed', () => {
    authWindow = null;
  });
}

function logout() {
  clearSession();
  activeTimers = [];
  updateTrayTitle();
  updateTrayMenu();
  showNotification('Clockwize', 'התנתקת - התחבר מחדש בדפדפן');
}

// App Initialization
app.whenReady().then(async () => {
  // Find active API port
  await initAPI();
  
  // Create tray
  const iconPath = path.join(__dirname, 'assets', 'iconTemplate.png');
  let icon;
  
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    // Create a simple icon if file doesn't exist
    icon = nativeImage.createEmpty();
  }
  
  tray = new Tray(icon);
  tray.setTitle('⏱️');
  
  // Load session from shared file (synced with browser)
  loadLocalSession();
  
  // Validate session
  if (token) {
    const valid = await validateSession();
    if (!valid) {
      token = null;
      workspaceId = null;
    }
  }
  
  // Initial fetch and menu
  updateTrayMenu();
  
  if (token && workspaceId) {
    fetchActiveTimers();
  }
  
  // Start polling for timers
  pollInterval = setInterval(fetchActiveTimers, 10000);
  displayInterval = setInterval(updateTrayTitle, 1000);
  
  // Check for session updates every 5 seconds (in case user logs in via browser)
  setInterval(async () => {
    const hadSession = !!token;
    loadLocalSession();
    
    if (!hadSession && token) {
      // New session detected
      console.log('New session detected from browser');
      const valid = await validateSession();
      if (valid) {
        fetchActiveTimers();
        updateTrayMenu();
        showNotification('Clockwize', 'מחובר!');
      }
    }
  }, 5000);
});

app.on('window-all-closed', (e) => {
  // Don't quit when all windows closed - we're a menu bar app
  e.preventDefault();
});

// IPC handlers for auth window
const { ipcMain } = require('electron');

ipcMain.handle('login', async (event, email, password) => {
  try {
    const response = await apiRequest('POST', '/auth/login', { email, password });
    token = response.token;
    
    // Get workspaces
    const workspaces = await apiRequest('GET', '/workspaces');
    if (workspaces.length > 0) {
      workspaceId = workspaces[0].id;
      saveConfig();
      fetchActiveTimers();
      updateTrayMenu();
      
      if (authWindow) {
        authWindow.close();
      }
      
      return { success: true };
    } else {
      throw new Error('לא נמצאו workspaces');
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
});
