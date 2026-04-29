const DEFAULT_PORT = 5001;
const CHECK_INTERVAL = 3000;

let currentPort = DEFAULT_PORT;
let checkTimer = null;

const statusScreen = document.getElementById('status-screen');
const statusMessage = document.getElementById('status-message');
const errorMessage = document.getElementById('error-message');
const clockwizeFrame = document.getElementById('clockwize-frame');
const retryBtn = document.getElementById('retry-btn');
const portInput = document.getElementById('port-input');
const savePortBtn = document.getElementById('save-port-btn');

// Domain bar elements
const domainBar = document.getElementById('domain-bar');
const domainUrl = document.getElementById('domain-url');
const domainClient = document.getElementById('domain-client');

// Auth state
let authToken = null;
let workspaceId = null;
let currentDomain = null;
let abortController = null;

function getAppUrl() {
  return `http://localhost:${currentPort}`;
}

function getApiUrl() {
  return `http://localhost:${currentPort}/api`;
}

async function checkConnection() {
  try {
    const response = await fetch(getAppUrl(), {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-cache'
    });
    // no-cors returns opaque response, status 0 means it reached the server
    return true;
  } catch {
    return false;
  }
}

function showConnecting() {
  statusScreen.style.display = 'flex';
  clockwizeFrame.style.display = 'none';
  domainBar.style.display = 'none';
  statusMessage.style.display = 'flex';
  errorMessage.style.display = 'none';
}

function showError() {
  statusScreen.style.display = 'flex';
  clockwizeFrame.style.display = 'none';
  domainBar.style.display = 'none';
  statusMessage.style.display = 'none';
  errorMessage.style.display = 'flex';
}

function showApp() {
  statusScreen.style.display = 'none';
  clockwizeFrame.style.display = 'block';
  clockwizeFrame.src = getAppUrl();
}

async function tryConnect() {
  showConnecting();

  const connected = await checkConnection();
  if (connected) {
    showApp();
    startHealthCheck();
  } else {
    showError();
  }
}

function startHealthCheck() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(async () => {
    const connected = await checkConnection();
    if (!connected) {
      clearInterval(checkTimer);
      checkTimer = null;
      showError();
    }
  }, CHECK_INTERVAL);
}

// === Auth Bridge ===
function requestAuthToken() {
  if (clockwizeFrame.contentWindow) {
    clockwizeFrame.contentWindow.postMessage({ type: 'GET_AUTH_TOKEN' }, '*');
  }
}

window.addEventListener('message', (event) => {
  if (event.data?.type === 'AUTH_TOKEN_RESPONSE') {
    authToken = event.data.token;
    workspaceId = event.data.workspaceId;
    // Once we have auth, check the current tab
    requestCurrentTabUrl();
  }
});

clockwizeFrame.addEventListener('load', () => {
  // Give the app a moment to initialize, then request auth
  setTimeout(requestAuthToken, 1000);
});

// === Domain Detection ===
function isSkippedUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || parsed.protocol === 'chrome:' || parsed.protocol === 'chrome-extension:' || parsed.protocol === 'about:') {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function lookupDomain(domain) {
  if (!authToken || !workspaceId) return null;

  // Cancel any pending request
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  try {
    const response = await fetch(
      `${getApiUrl()}/clients/lookup/domain?domain=${encodeURIComponent(domain)}`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'X-Workspace-Id': workspaceId,
          'Content-Type': 'application/json'
        },
        signal: abortController.signal
      }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    if (e.name === 'AbortError') return null;
    console.error('Domain lookup failed:', e);
    return null;
  }
}

function updateDomainBar(domain, clients) {
  domainUrl.textContent = domain;

  if (!clients || clients.length === 0) {
    domainClient.textContent = 'לא ידוע';
    domainClient.className = 'domain-client';
  } else if (clients.length === 1) {
    domainClient.textContent = clients[0].name;
    domainClient.className = 'domain-client matched';
  } else {
    domainClient.textContent = clients.map(c => c.name).join(' | ');
    domainClient.className = 'domain-client multi';
  }

  domainBar.style.display = 'flex';
}

async function handleUrlChange(url) {
  if (isSkippedUrl(url)) {
    domainBar.style.display = 'none';
    currentDomain = null;
    return;
  }

  const domain = extractDomain(url);
  if (!domain) {
    domainBar.style.display = 'none';
    currentDomain = null;
    return;
  }

  // Skip if domain hasn't changed
  if (domain === currentDomain) return;
  currentDomain = domain;

  // Show domain immediately, loading client
  domainUrl.textContent = domain;
  domainClient.textContent = '...';
  domainClient.className = 'domain-client';
  domainBar.style.display = 'flex';

  const result = await lookupDomain(domain);
  // Verify domain hasn't changed while we were fetching
  if (domain !== currentDomain) return;

  if (result) {
    updateDomainBar(domain, result.clients);
  } else {
    updateDomainBar(domain, []);
  }
}

// Listen for tab changes from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TAB_URL_CHANGED') {
    handleUrlChange(message.url);
  }
});

// Request current tab URL on initialization
async function requestCurrentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      handleUrlChange(tab.url);
    }
  } catch (e) {
    // Might not have tab permission yet
  }
}

// Event listeners
retryBtn.addEventListener('click', tryConnect);

savePortBtn.addEventListener('click', () => {
  const newPort = parseInt(portInput.value, 10);
  if (newPort >= 1000 && newPort <= 65535) {
    currentPort = newPort;
    chrome.storage.local.set({ clockwizePort: newPort });
    tryConnect();
  }
});

portInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') savePortBtn.click();
});

// Initialize
async function init() {
  const stored = await chrome.storage.local.get('clockwizePort');
  if (stored.clockwizePort) {
    currentPort = stored.clockwizePort;
    portInput.value = currentPort;
  }
  tryConnect();
}

init();
