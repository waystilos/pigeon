// Tauri API - will be set when ready
let invoke = null;
let dialogApi = null;

// State
let history = JSON.parse(localStorage.getItem('bolt_history') || '[]');
let collections = JSON.parse(localStorage.getItem('bolt_collections') || '[]');
let environments = JSON.parse(localStorage.getItem('bolt_environments') || '[{"name":"Default","variables":{}}]');
let activeEnvIndex = parseInt(localStorage.getItem('bolt_active_env') || '0');
let cookies = JSON.parse(localStorage.getItem('bolt_cookies') || '{}');
let responseData = null; // Store last response for chaining
let currentPreviewMode = localStorage.getItem('bolt_preview_mode') || 'pretty'; // Remember last mode
let rawResponseBody = ''; // Store raw response for mode switching
let consoleLogs = []; // Store console output from scripts
let formDataFields = []; // Store form data fields with file info

// Collection Runner State
let runnerState = {
  running: false,
  aborted: false,
  collectionIndex: null,
  results: [],
  passed: 0,
  failed: 0,
  skipped: 0
};

// Cookie utility functions
function parseCookieDomain(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    return null;
  }
}

function parseSetCookieHeader(setCookieHeader, requestUrl) {
  const cookie = {
    name: '',
    value: '',
    domain: parseCookieDomain(requestUrl) || '',
    path: '/',
    expires: null,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax'
  };

  // Parse the cookie string
  const parts = setCookieHeader.split(';').map(p => p.trim());
  
  // First part is name=value
  const [nameValue, ...attributes] = parts;
  const eqIndex = nameValue.indexOf('=');
  if (eqIndex > 0) {
    cookie.name = nameValue.substring(0, eqIndex).trim();
    cookie.value = nameValue.substring(eqIndex + 1).trim();
  }

  // Parse attributes
  attributes.forEach(attr => {
    const [key, ...valueParts] = attr.split('=');
    const attrName = key.trim().toLowerCase();
    const attrValue = valueParts.join('=').trim();

    switch (attrName) {
      case 'domain':
        cookie.domain = attrValue.replace(/^\./, '');
        break;
      case 'path':
        cookie.path = attrValue || '/';
        break;
      case 'expires':
        try {
          cookie.expires = new Date(attrValue).toISOString();
        } catch {}
        break;
      case 'max-age':
        const maxAge = parseInt(attrValue);
        if (!isNaN(maxAge)) {
          cookie.expires = new Date(Date.now() + maxAge * 1000).toISOString();
        }
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'samesite':
        cookie.sameSite = attrValue;
        break;
    }
  });

  return cookie;
}

function storeCookie(cookie) {
  if (!cookie.name || !cookie.domain) return;
  
  if (!cookies[cookie.domain]) {
    cookies[cookie.domain] = {};
  }
  
  cookies[cookie.domain][cookie.name] = cookie;
  saveCookies();
}

function deleteCookie(domain, name) {
  if (cookies[domain]) {
    delete cookies[domain][name];
    if (Object.keys(cookies[domain]).length === 0) {
      delete cookies[domain];
    }
    saveCookies();
  }
}

function deleteDomainCookies(domain) {
  delete cookies[domain];
  saveCookies();
}

function deleteAllCookies() {
  cookies = {};
  saveCookies();
}

function saveCookies() {
  localStorage.setItem('bolt_cookies', JSON.stringify(cookies));
}

function getCookiesForUrl(urlString) {
  const domain = parseCookieDomain(urlString);
  if (!domain) return {};

  const matchingCookies = {};
  
  // Match cookies for this domain and parent domains
  Object.keys(cookies).forEach(cookieDomain => {
    if (domain === cookieDomain || domain.endsWith('.' + cookieDomain)) {
      Object.values(cookies[cookieDomain]).forEach(cookie => {
        // Check if cookie is expired
        if (cookie.expires && new Date(cookie.expires) < new Date()) {
          return;
        }
        matchingCookies[cookie.name] = cookie.value;
      });
    }
  });

  return matchingCookies;
}

function buildCookieHeader(urlString) {
  const matchingCookies = getCookiesForUrl(urlString);
  return Object.entries(matchingCookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function isCookieExpired(cookie) {
  if (!cookie.expires) return false;
  return new Date(cookie.expires) < new Date();
}

function formatCookieExpiry(expiresStr) {
  if (!expiresStr) return 'Session';
  try {
    const date = new Date(expiresStr);
    return date.toLocaleString();
  } catch {
    return expiresStr;
  }
}

// Tab State Management
let tabs = [];
let activeTabId = null;
let tabIdCounter = 1;

function createDefaultTabState() {
  return {
    id: tabIdCounter++,
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    params: [],
    headers: [{ enabled: true, key: 'Content-Type', value: 'application/json' }],
    bodyType: 'none',
    body: '',
    authType: 'none',
    authData: {},
    preScript: '',
    testScript: '',
    response: null,
    unsaved: false
  };
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
}

function markTabUnsaved() {
  const tab = getActiveTab();
  if (tab && !tab.unsaved) {
    tab.unsaved = true;
    renderTabs();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (window.__TAURI__ && window.__TAURI__.core) {
      invoke = window.__TAURI__.core.invoke;
      console.log('Tauri API loaded successfully');
    } else if (window.__TAURI__) {
      invoke = window.__TAURI__.invoke;
      console.log('Tauri API loaded (alternate path)');
    } else {
      console.warn('Tauri API not found');
    }
    
    // Load dialog API
    if (window.__TAURI__?.dialog) {
      dialogApi = window.__TAURI__.dialog;
      console.log('Tauri Dialog API loaded');
    }
    
    initApp();
  }, 100);
});

function initApp() {
  // DOM Elements
  const methodSelect = document.getElementById('methodSelect');
  const urlInput = document.getElementById('urlInput');
  const sendBtn = document.getElementById('sendBtn');
  const paramsRows = document.getElementById('paramsRows');
  const headersRows = document.getElementById('headersRows');
  const bodyInput = document.getElementById('bodyInput');
  const authType = document.getElementById('authType');
  const authFields = document.getElementById('authFields');
  const responseBody = document.getElementById('responseBody');
  const responseHeaders = document.getElementById('responseHeaders');
  const responseStatus = document.getElementById('responseStatus');
  const responseTime = document.getElementById('responseTime');
  const responseSize = document.getElementById('responseSize');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const historyList = document.getElementById('historyList');
  const collectionsList = document.getElementById('collectionsList');
  const toastContainer = document.getElementById('toastContainer');
  const envSelect = document.getElementById('envSelect');
  const preScriptInput = document.getElementById('preScriptInput');
  const testScriptInput = document.getElementById('testScriptInput');
  const requestTabsContainer = document.getElementById('requestTabs');
  const newTabBtn = document.getElementById('newTabBtn');

  // ==================== TAB MANAGEMENT ====================
  
  function createNewTab() {
    const newTab = createDefaultTabState();
    tabs.push(newTab);
    activeTabId = newTab.id;
    renderTabs();
    loadTabIntoUI(newTab);
    return newTab;
  }

  function closeTab(tabId) {
    const tabIndex = tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    
    // Don't close the last tab - create a new one instead
    if (tabs.length === 1) {
      tabs = [];
      createNewTab();
      return;
    }
    
    tabs.splice(tabIndex, 1);
    
    // If we closed the active tab, activate another one
    if (activeTabId === tabId) {
      // Prefer the next tab, or the previous if at end
      const newActiveIndex = Math.min(tabIndex, tabs.length - 1);
      activeTabId = tabs[newActiveIndex].id;
      loadTabIntoUI(tabs[newActiveIndex]);
    }
    
    renderTabs();
  }

  function switchToTab(tabId) {
    if (activeTabId === tabId) return;
    
    // Save current tab state before switching
    saveCurrentTabState();
    
    activeTabId = tabId;
    const tab = getActiveTab();
    if (tab) {
      loadTabIntoUI(tab);
    }
    renderTabs();
  }

  function saveCurrentTabState() {
    const tab = getActiveTab();
    if (!tab) return;
    
    tab.method = methodSelect.value;
    tab.url = urlInput.value;
    tab.bodyType = document.querySelector('input[name="bodyType"]:checked')?.value || 'none';
    tab.body = bodyInput.value;
    tab.authType = authType?.value || 'none';
    tab.preScript = preScriptInput?.value || '';
    tab.testScript = testScriptInput?.value || '';
    
    // Save params
    tab.params = [];
    paramsRows.querySelectorAll('.kv-row').forEach(row => {
      tab.params.push({
        enabled: row.querySelector('.kv-enabled')?.checked !== false,
        key: row.querySelector('.kv-key').value,
        value: row.querySelector('.kv-value').value
      });
    });
    
    // Save headers
    tab.headers = [];
    headersRows.querySelectorAll('.kv-row').forEach(row => {
      tab.headers.push({
        enabled: row.querySelector('.kv-enabled')?.checked !== false,
        key: row.querySelector('.kv-key').value,
        value: row.querySelector('.kv-value').value
      });
    });
    
    // Save auth data
    tab.authData = {};
    if (tab.authType === 'bearer') {
      tab.authData.token = document.getElementById('bearerToken')?.value || '';
    } else if (tab.authType === 'basic') {
      tab.authData.username = document.getElementById('basicUser')?.value || '';
      tab.authData.password = document.getElementById('basicPass')?.value || '';
    } else if (tab.authType === 'apikey') {
      tab.authData.location = document.getElementById('apiKeyLocation')?.value || 'header';
      tab.authData.name = document.getElementById('apiKeyName')?.value || '';
      tab.authData.value = document.getElementById('apiKeyValue')?.value || '';
    } else if (tab.authType === 'oauth2') {
      tab.authData.token = document.getElementById('oauth2Token')?.value || '';
      tab.authData.prefix = document.getElementById('oauth2Prefix')?.value || 'Bearer';
    }
  }

  function loadTabIntoUI(tab) {
    // Load method and URL
    methodSelect.value = tab.method;
    urlInput.value = tab.url;
    updateMethodColor();
    
    // Load params
    paramsRows.innerHTML = '';
    if (tab.params && tab.params.length > 0) {
      tab.params.forEach(p => createKVRow(paramsRows, p.key, p.value, p.enabled));
    }
    
    // Load headers
    headersRows.innerHTML = '';
    if (tab.headers && tab.headers.length > 0) {
      tab.headers.forEach(h => createKVRow(headersRows, h.key, h.value, h.enabled));
    } else {
      createKVRow(headersRows, 'Content-Type', 'application/json');
    }
    
    // Load body
    const bodyTypeRadio = document.querySelector(`input[name="bodyType"][value="${tab.bodyType}"]`);
    if (bodyTypeRadio) bodyTypeRadio.checked = true;
    bodyInput.value = tab.body || '';
    
    // Load auth
    if (authType) {
      authType.value = tab.authType || 'none';
      authType.dispatchEvent(new Event('change'));
      
      // Populate auth fields after they're rendered
      setTimeout(() => {
        if (tab.authType === 'bearer' && tab.authData?.token) {
          const tokenInput = document.getElementById('bearerToken');
          if (tokenInput) tokenInput.value = tab.authData.token;
        } else if (tab.authType === 'basic') {
          const userInput = document.getElementById('basicUser');
          const passInput = document.getElementById('basicPass');
          if (userInput) userInput.value = tab.authData?.username || '';
          if (passInput) passInput.value = tab.authData?.password || '';
        } else if (tab.authType === 'apikey') {
          const locInput = document.getElementById('apiKeyLocation');
          const nameInput = document.getElementById('apiKeyName');
          const valueInput = document.getElementById('apiKeyValue');
          if (locInput) locInput.value = tab.authData?.location || 'header';
          if (nameInput) nameInput.value = tab.authData?.name || '';
          if (valueInput) valueInput.value = tab.authData?.value || '';
        } else if (tab.authType === 'oauth2') {
          const tokenInput = document.getElementById('oauth2Token');
          const prefixInput = document.getElementById('oauth2Prefix');
          if (tokenInput) tokenInput.value = tab.authData?.token || '';
          if (prefixInput) prefixInput.value = tab.authData?.prefix || 'Bearer';
        }
      }, 0);
    }
    
    // Load scripts
    if (preScriptInput) preScriptInput.value = tab.preScript || '';
    if (testScriptInput) testScriptInput.value = tab.testScript || '';
    
    // Load response if exists
    if (tab.response) {
      displayResponse(tab.response);
    } else {
      clearResponse();
    }
  }

  function getTabDisplayText(tab) {
    if (!tab.url || tab.url.trim() === '') {
      return 'New Request';
    }
    try {
      const url = new URL(tab.url);
      let path = url.pathname;
      if (path.length > 20) {
        path = '...' + path.slice(-17);
      }
      return path || '/';
    } catch {
      // Not a valid URL yet, show truncated
      let display = tab.url;
      if (display.length > 20) {
        display = display.slice(0, 17) + '...';
      }
      return display;
    }
  }

  function renderTabs() {
    if (!requestTabsContainer) return;
    
    requestTabsContainer.innerHTML = tabs.map(tab => {
      const isActive = tab.id === activeTabId;
      const displayText = getTabDisplayText(tab);
      return `
        <div class="request-tab ${isActive ? 'active' : ''}" data-tab-id="${tab.id}">
          <span class="tab-method ${tab.method.toLowerCase()}">${tab.method}</span>
          <span class="tab-url">${escapeHtml(displayText)}</span>
          <span class="tab-unsaved ${tab.unsaved ? 'visible' : ''}"></span>
          <button class="tab-close" data-tab-id="${tab.id}" title="Close Tab (Ctrl/Cmd+W)">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
    }).join('');
    
    // Add click listeners for tabs
    requestTabsContainer.querySelectorAll('.request-tab').forEach(tabEl => {
      tabEl.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) return;
        const tabId = parseInt(tabEl.dataset.tabId);
        switchToTab(tabId);
      });
    });
    
    // Add click listeners for close buttons
    requestTabsContainer.querySelectorAll('.tab-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabId = parseInt(btn.dataset.tabId);
        closeTab(tabId);
      });
    });
  }

  function clearResponse() {
    responseBody.innerHTML = '<span class="placeholder">Send a request to see the response</span>';
    responseHeaders.innerHTML = '';
    responseStatus.textContent = '';
    responseTime.textContent = '';
    responseSize.textContent = '';
    document.getElementById('testResults')?.remove();
  }

  function displayResponse(data) {
    if (!data) {
      clearResponse();
      return;
    }
    
    if (data.error) {
      responseBody.innerHTML = `<span style="color: var(--error);">Error: ${escapeHtml(data.error)}</span>`;
      responseStatus.textContent = 'Error';
      responseStatus.className = 'status error';
      renderTimingBreakdown(data.timing);
    } else {
      responseStatus.textContent = `${data.status} ${data.status_text}`;
      responseStatus.className = `status ${data.status < 300 ? 'success' : data.status < 400 ? 'redirect' : 'error'}`;
      responseTime.textContent = `${data.duration}ms`;
      responseSize.textContent = formatBytes(data.size);
      
      // Format response body
      try {
        const parsed = JSON.parse(data.body);
        responseBody.innerHTML = syntaxHighlight(parsed);
      } catch {
        responseBody.textContent = data.body;
      }
      
      // Response headers
      if (data.headers) {
        responseHeaders.innerHTML = Object.entries(data.headers)
          .map(([key, value]) => `
            <div class="header-row">
              <span class="header-key">${escapeHtml(key)}</span>
              <span class="header-value">${escapeHtml(value)}</span>
            </div>
          `).join('');
      }
      
      // Render timing breakdown
      renderTimingBreakdown(data.timing);
    }
  }
  
  // Render timing breakdown visualization
  function renderTimingBreakdown(timing) {
    const timingChart = document.getElementById('timingChart');
    const timingDetails = document.getElementById('timingDetails');
    const timingTotal = document.getElementById('timingTotal');
    
    if (!timingChart || !timingDetails || !timing) {
      if (timingChart) {
        timingChart.innerHTML = '<div class="empty-state"><i class="fas fa-stopwatch"></i><p>No timing data available</p></div>';
      }
      if (timingDetails) {
        timingDetails.innerHTML = '';
      }
      return;
    }
    
    const { connect = 0, ttfb = 0, download = 0, total = 0 } = timing;
    
    // Update total display
    if (timingTotal) {
      timingTotal.textContent = `Total: ${total}ms`;
    }
    
    // Calculate percentages for the bar widths
    const maxTime = total || 1; // Avoid division by zero
    const connectPct = (connect / maxTime) * 100;
    const ttfbPct = (ttfb / maxTime) * 100;
    const downloadPct = (download / maxTime) * 100;
    
    // Phases data
    const phases = [
      { 
        id: 'connect', 
        name: 'Connection', 
        desc: 'DNS lookup + TCP + TLS handshake', 
        time: connect, 
        pct: connectPct,
        icon: 'fa-plug' 
      },
      { 
        id: 'ttfb', 
        name: 'Waiting (TTFB)', 
        desc: 'Time to first byte from server', 
        time: ttfb, 
        pct: ttfbPct,
        icon: 'fa-hourglass-half' 
      },
      { 
        id: 'download', 
        name: 'Content Download', 
        desc: 'Receiving response body', 
        time: download, 
        pct: downloadPct,
        icon: 'fa-download' 
      }
    ];
    
    // Render stacked bar (Postman-style)
    let stackedHtml = `
      <div class="timing-stacked">
        <div class="timing-stacked-label">Timing Waterfall</div>
        <div class="timing-stacked-bar">
    `;
    
    phases.forEach(phase => {
      if (phase.time > 0 || phase.pct > 0) {
        const displayPct = Math.max(phase.pct, 3); // Minimum 3% width for visibility
        stackedHtml += `
          <div class="timing-stacked-segment" data-phase="${phase.id}" style="width: ${displayPct}%;">
            <span class="segment-label">${phase.time > 10 ? phase.time + 'ms' : ''}</span>
            <div class="timing-tooltip">${phase.name}: ${phase.time}ms</div>
          </div>
        `;
      }
    });
    
    stackedHtml += `
        </div>
        <div class="timing-legend">
          <div class="timing-legend-item"><div class="timing-legend-dot connect"></div>Connection</div>
          <div class="timing-legend-item"><div class="timing-legend-dot ttfb"></div>Waiting (TTFB)</div>
          <div class="timing-legend-item"><div class="timing-legend-dot download"></div>Download</div>
        </div>
      </div>
    `;
    
    // Render individual phase bars
    let barsHtml = '';
    phases.forEach(phase => {
      barsHtml += `
        <div class="timing-bar-container timing-${phase.id}">
          <div class="timing-bar-label">
            <span class="phase-name">
              <span class="phase-icon"><i class="fas ${phase.icon}"></i></span>
              ${phase.name}
            </span>
            <span class="phase-time">${phase.time}ms</span>
          </div>
          <div class="timing-bar-track">
            <div class="timing-bar-fill" style="width: ${Math.max(phase.pct, 1)}%;"></div>
          </div>
        </div>
      `;
    });
    
    timingChart.innerHTML = stackedHtml + barsHtml;
    
    // Render details table
    let detailsHtml = '';
    phases.forEach(phase => {
      detailsHtml += `
        <div class="timing-detail-row">
          <div class="detail-phase">
            <i class="fas ${phase.icon}" style="color: var(--${phase.id === 'connect' ? 'info' : phase.id === 'ttfb' ? 'warning' : 'success'});"></i>
            ${phase.name}
          </div>
          <div class="detail-desc">${phase.desc}</div>
          <div class="detail-time ${phase.id}">${phase.time}ms</div>
        </div>
      `;
    });
    
    // Add total row
    detailsHtml += `
      <div class="timing-detail-row" style="background: var(--bg-hover);">
        <div class="detail-phase">
          <i class="fas fa-clock" style="color: var(--accent);"></i>
          Total
        </div>
        <div class="detail-desc">Complete request/response cycle</div>
        <div class="detail-time total">${total}ms</div>
      </div>
    `;
    
    timingDetails.innerHTML = detailsHtml;
  }

  // New tab button click
  newTabBtn?.addEventListener('click', () => {
    saveCurrentTabState();
    createNewTab();
  });

  // Keyboard shortcuts for tabs
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    
    if (modKey && e.key === 't') {
      e.preventDefault();
      saveCurrentTabState();
      createNewTab();
    }
    
    if (modKey && e.key === 'w') {
      e.preventDefault();
      closeTab(activeTabId);
    }
    
    // Ctrl/Cmd + Tab to switch between tabs
    if (modKey && e.key === 'Tab') {
      e.preventDefault();
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      const nextIndex = e.shiftKey 
        ? (currentIndex - 1 + tabs.length) % tabs.length 
        : (currentIndex + 1) % tabs.length;
      saveCurrentTabState();
      switchToTab(tabs[nextIndex].id);
    }
  });

  // Track changes for unsaved indicator
  function setupChangeTracking() {
    // Track URL changes
    urlInput?.addEventListener('input', () => {
      markTabUnsaved();
      // Also update the tab display
      const tab = getActiveTab();
      if (tab) {
        tab.url = urlInput.value;
        tab.method = methodSelect.value;
        renderTabs();
      }
    });
    
    // Track method changes
    methodSelect?.addEventListener('change', () => {
      markTabUnsaved();
      const tab = getActiveTab();
      if (tab) {
        tab.method = methodSelect.value;
        renderTabs();
      }
    });
    
    // Track body changes
    bodyInput?.addEventListener('input', markTabUnsaved);
    
    // Track script changes
    preScriptInput?.addEventListener('input', markTabUnsaved);
    testScriptInput?.addEventListener('input', markTabUnsaved);
    
    // Track auth changes
    authType?.addEventListener('change', markTabUnsaved);
    
    // Track body type changes
    document.querySelectorAll('input[name="bodyType"]').forEach(radio => {
      radio.addEventListener('change', () => {
        markTabUnsaved();
        toggleBodyEditor(radio.value);
      });
    });
  }

  // Toggle between text body editor and form data editor
  function toggleBodyEditor(bodyType) {
    const textEditor = document.getElementById('bodyEditorText');
    const formDataEditor = document.getElementById('bodyEditorFormData');
    
    if (bodyType === 'formdata') {
      if (textEditor) textEditor.style.display = 'none';
      if (formDataEditor) formDataEditor.style.display = 'block';
    } else {
      if (textEditor) textEditor.style.display = 'block';
      if (formDataEditor) formDataEditor.style.display = 'none';
    }
  }

  // Initialize first tab
  function initializeTabs() {
    if (tabs.length === 0) {
      createNewTab();
    } else {
      renderTabs();
      const tab = getActiveTab();
      if (tab) loadTabIntoUI(tab);
    }
  }

  // ==================== END TAB MANAGEMENT ====================

  // Tab switching - Request tabs
  document.querySelectorAll('.tabs').forEach(tabGroup => {
    tabGroup.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = tab.dataset.tab || tab.dataset.responseTab;
        const isResponseTab = !!tab.dataset.responseTab;
        
        tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        if (isResponseTab) {
          document.querySelectorAll('.response-tab-content').forEach(c => c.classList.remove('active'));
          const target = document.getElementById(`response-${tabName}-tab`);
          if (target) target.classList.add('active');
        } else {
          const container = tab.closest('.tabs-container');
          if (container) {
            container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const target = container.querySelector(`#${tabName}-tab`);
            if (target) target.classList.add('active');
          }
        }
      });
    });
  });

  // Utility functions
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Console capture functions
  function createScriptConsole(source) {
    const addLog = (level, args) => {
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
      
      consoleLogs.push({
        level,
        message,
        source,
        timestamp: new Date()
      });
      
      renderConsole();
    };
    
    return {
      log: (...args) => addLog('log', args),
      info: (...args) => addLog('info', args),
      warn: (...args) => addLog('warn', args),
      error: (...args) => addLog('error', args),
      debug: (...args) => addLog('log', args),
      dir: (obj) => addLog('log', [obj]),
      table: (data) => addLog('log', [data]),
      clear: () => {
        consoleLogs = consoleLogs.filter(l => l.source !== source);
        renderConsole();
      }
    };
  }

  function addConsoleError(source, error) {
    const stack = error.stack || '';
    consoleLogs.push({
      level: 'error',
      message: error.message,
      source,
      timestamp: new Date(),
      stack: stack.split('\n').slice(1).join('\n').trim() || null
    });
    renderConsole();
  }

  function clearConsole() {
    consoleLogs = [];
    renderConsole();
  }

  function renderConsole() {
    const consoleOutput = document.getElementById('consoleOutput');
    const consoleBadge = document.getElementById('consoleBadge');
    const consoleStats = document.getElementById('consoleStats');
    
    if (!consoleOutput) return;
    
    // Count by level
    const counts = { log: 0, info: 0, warn: 0, error: 0 };
    consoleLogs.forEach(log => {
      counts[log.level] = (counts[log.level] || 0) + 1;
    });
    
    // Update badge
    const errorCount = counts.error;
    const warnCount = counts.warn;
    if (errorCount > 0) {
      consoleBadge.textContent = errorCount;
      consoleBadge.className = 'console-badge';
      consoleBadge.style.display = 'inline-flex';
    } else if (warnCount > 0) {
      consoleBadge.textContent = warnCount;
      consoleBadge.className = 'console-badge warn-only';
      consoleBadge.style.display = 'inline-flex';
    } else {
      consoleBadge.style.display = 'none';
    }
    
    // Update stats
    const total = consoleLogs.length;
    if (total > 0) {
      const parts = [];
      if (counts.error) parts.push(`${counts.error} error${counts.error > 1 ? 's' : ''}`);
      if (counts.warn) parts.push(`${counts.warn} warning${counts.warn > 1 ? 's' : ''}`);
      if (counts.log + counts.info) parts.push(`${counts.log + counts.info} log${counts.log + counts.info > 1 ? 's' : ''}`);
      consoleStats.textContent = parts.join(', ');
    } else {
      consoleStats.textContent = '';
    }
    
    // Render logs
    if (consoleLogs.length === 0) {
      consoleOutput.innerHTML = '<div class="empty-state"><i class="fas fa-terminal"></i><p>No console output yet</p><p class="hint">Use console.log(), console.warn(), or console.error() in your scripts</p></div>';
      return;
    }
    
    consoleOutput.innerHTML = consoleLogs.map(log => {
      const icons = {
        log: 'fa-chevron-right',
        info: 'fa-info-circle',
        warn: 'fa-exclamation-triangle',
        error: 'fa-times-circle'
      };
      const time = log.timestamp.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        fractionalSecondDigits: 3 
      });
      
      return `
        <div class="console-entry ${log.level}">
          <span class="console-icon"><i class="fas ${icons[log.level] || icons.log}"></i></span>
          <span class="console-timestamp">${time}</span>
          <span class="console-source">${escapeHtml(log.source)}</span>
          <div class="console-message-wrapper">
            <span class="console-message">${escapeHtml(log.message)}</span>
            ${log.stack ? `<div class="console-stack">${escapeHtml(log.stack)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
    
    // Scroll to bottom
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function switchToConsoleTab() {
    const consoleTab = document.querySelector('[data-response-tab="console"]');
    if (consoleTab) {
      document.querySelectorAll('.response-tabs .tab').forEach(t => t.classList.remove('active'));
      consoleTab.classList.add('active');
      document.querySelectorAll('.response-tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('response-console-tab')?.classList.add('active');
    }
  }

  // Environment variable substitution
  function substituteEnvVars(str) {
    if (!str) return str;
    const env = environments[activeEnvIndex]?.variables || {};
    return str.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return env[varName] !== undefined ? env[varName] : match;
    });
  }

  // Key-Value Row Management
  function createKVRow(container, key = '', value = '', enabled = true) {
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
      <input type="checkbox" class="kv-enabled" ${enabled ? 'checked' : ''}>
      <input type="text" class="kv-key" placeholder="Key" value="${escapeHtml(key)}">
      <input type="text" class="kv-value" placeholder="Value" value="${escapeHtml(value)}">
      <button class="delete-btn" type="button"><i class="fas fa-times"></i></button>
    `;
    
    row.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.preventDefault();
      row.remove();
    });
    container.appendChild(row);
    return row;
  }

  document.getElementById('addParamBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    createKVRow(paramsRows);
  });
  
  document.getElementById('addHeaderBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    createKVRow(headersRows);
  });

  // Form Data Editor
  const formDataRows = document.getElementById('formDataRows');
  
  document.getElementById('addFormDataBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    createFormDataRow(formDataRows);
  });

  function createFormDataRow(container, key = '', value = '', fieldType = 'text', enabled = true) {
    const rowId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const row = document.createElement('div');
    row.className = 'formdata-row';
    row.dataset.rowId = rowId;
    row.innerHTML = `
      <input type="checkbox" class="formdata-enabled" ${enabled ? 'checked' : ''}>
      <input type="text" class="formdata-key" placeholder="Key" value="${escapeHtml(key)}">
      <div class="formdata-value-container ${fieldType === 'file' ? 'file-mode' : ''}">
        <input type="text" class="formdata-value" placeholder="Value" value="${fieldType === 'text' ? escapeHtml(value) : ''}">
        <button class="formdata-file-btn ${fieldType === 'file' && value ? 'has-file' : ''}" type="button" title="Select File">
          <i class="fas fa-file"></i>
        </button>
        <span class="formdata-filename">${fieldType === 'file' && value ? escapeHtml(value.split(/[\\/]/).pop()) : ''}</span>
      </div>
      <select class="formdata-type">
        <option value="text" ${fieldType === 'text' ? 'selected' : ''}>Text</option>
        <option value="file" ${fieldType === 'file' ? 'selected' : ''}>File</option>
      </select>
      <button class="delete-btn" type="button"><i class="fas fa-times"></i></button>
    `;
    
    // Store file path data
    if (fieldType === 'file' && value) {
      row.dataset.filePath = value;
    }
    
    // Type change handler
    const typeSelect = row.querySelector('.formdata-type');
    const valueContainer = row.querySelector('.formdata-value-container');
    const valueInput = row.querySelector('.formdata-value');
    const fileBtn = row.querySelector('.formdata-file-btn');
    const filenameSpan = row.querySelector('.formdata-filename');
    
    typeSelect.addEventListener('change', () => {
      const isFile = typeSelect.value === 'file';
      valueContainer.classList.toggle('file-mode', isFile);
      if (isFile) {
        valueInput.value = '';
        row.dataset.filePath = '';
        fileBtn.classList.remove('has-file');
        filenameSpan.textContent = '';
      }
    });
    
    // File picker handler
    fileBtn.addEventListener('click', async () => {
      if (typeSelect.value !== 'file') return;
      
      try {
        // Use Tauri dialog API
        if (dialogApi?.open) {
          const selected = await dialogApi.open({
            multiple: false,
            directory: false
          });
          
          if (selected) {
            const filePath = typeof selected === 'string' ? selected : selected.path || selected;
            row.dataset.filePath = filePath;
            const filename = filePath.split(/[\\/]/).pop();
            filenameSpan.textContent = filename;
            fileBtn.classList.add('has-file');
            showToast(`Selected: ${filename}`, 'success');
          }
        } else {
          showToast('File dialog not available', 'error');
        }
      } catch (err) {
        console.error('File dialog error:', err);
        showToast(`File dialog error: ${err.message}`, 'error');
      }
    });
    
    // Delete handler
    row.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.preventDefault();
      row.remove();
    });
    
    container.appendChild(row);
    return row;
  }

  // Get form data fields for multipart request
  function getFormDataFields() {
    const fields = [];
    const rows = document.querySelectorAll('#formDataRows .formdata-row');
    
    rows.forEach(row => {
      const enabled = row.querySelector('.formdata-enabled')?.checked !== false;
      if (!enabled) return;
      
      const key = row.querySelector('.formdata-key')?.value?.trim();
      if (!key) return;
      
      const fieldType = row.querySelector('.formdata-type')?.value || 'text';
      let value = '';
      let filename = null;
      
      if (fieldType === 'file') {
        value = row.dataset.filePath || '';
        if (value) {
          filename = value.split(/[\\/]/).pop();
        }
      } else {
        value = row.querySelector('.formdata-value')?.value || '';
      }
      
      fields.push({
        key: substituteEnvVars(key),
        value: fieldType === 'file' ? value : substituteEnvVars(value),
        field_type: fieldType,
        filename: filename
      });
    });
    
    return fields;
  }

  // Bulk edit toggle
  document.getElementById('bulkEditParamsBtn')?.addEventListener('click', () => toggleBulkEdit('params'));
  document.getElementById('bulkEditHeadersBtn')?.addEventListener('click', () => toggleBulkEdit('headers'));

  function toggleBulkEdit(type) {
    const container = type === 'params' ? document.getElementById('paramsEditor') : document.getElementById('headersEditor');
    const rows = type === 'params' ? paramsRows : headersRows;
    const existing = container.querySelector('.bulk-edit-area');
    
    if (existing) {
      // Parse bulk edit back to rows
      const lines = existing.value.split('\n').filter(l => l.trim());
      rows.innerHTML = '';
      lines.forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key) {
          createKVRow(rows, key.trim(), valueParts.join(':').trim());
        }
      });
      existing.remove();
      rows.style.display = '';
      container.querySelector('.add-row-btn').style.display = '';
    } else {
      // Convert rows to bulk edit
      const kvPairs = [];
      rows.querySelectorAll('.kv-row').forEach(row => {
        const key = row.querySelector('.kv-key').value;
        const value = row.querySelector('.kv-value').value;
        if (key) kvPairs.push(`${key}: ${value}`);
      });
      
      const textarea = document.createElement('textarea');
      textarea.className = 'bulk-edit-area';
      textarea.placeholder = 'key: value\nkey2: value2';
      textarea.value = kvPairs.join('\n');
      container.insertBefore(textarea, rows);
      rows.style.display = 'none';
      container.querySelector('.add-row-btn').style.display = 'none';
    }
  }

  // Auth type change
  authType?.addEventListener('change', () => {
    const type = authType.value;
    authFields.innerHTML = '';
    
    switch (type) {
      case 'bearer':
        authFields.innerHTML = '<input type="text" id="bearerToken" placeholder="Token (use {{variable}} for env vars)">';
        break;
      case 'basic':
        authFields.innerHTML = `
          <input type="text" id="basicUser" placeholder="Username">
          <input type="password" id="basicPass" placeholder="Password">
        `;
        break;
      case 'apikey':
        authFields.innerHTML = `
          <select id="apiKeyLocation">
            <option value="header">Header</option>
            <option value="query">Query Param</option>
          </select>
          <input type="text" id="apiKeyName" placeholder="Key Name (e.g., X-API-Key)">
          <input type="text" id="apiKeyValue" placeholder="API Key Value">
        `;
        break;
      case 'oauth2':
        authFields.innerHTML = `
          <input type="text" id="oauth2Token" placeholder="Access Token">
          <input type="text" id="oauth2Prefix" placeholder="Prefix (default: Bearer)" value="Bearer">
        `;
        break;
    }
  });

  // Environment management
  function renderEnvSelect() {
    if (!envSelect) return;
    envSelect.innerHTML = environments.map((env, i) => 
      `<option value="${i}" ${i === activeEnvIndex ? 'selected' : ''}>${escapeHtml(env.name)}</option>`
    ).join('');
  }

  envSelect?.addEventListener('change', () => {
    activeEnvIndex = parseInt(envSelect.value);
    localStorage.setItem('bolt_active_env', activeEnvIndex);
    showToast(`Switched to ${environments[activeEnvIndex].name}`, 'info');
  });

  document.getElementById('manageEnvBtn')?.addEventListener('click', showEnvModal);
  document.getElementById('cookieManagerBtn')?.addEventListener('click', showCookieManagerModal);

  function showCookieManagerModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    const totalCookies = Object.values(cookies).reduce((acc, domain) => acc + Object.keys(domain).length, 0);
    const domainCount = Object.keys(cookies).length;
    
    modal.innerHTML = `
      <div class="modal cookie-manager-modal">
        <div class="modal-header">
          <h3><i class="fas fa-cookie-bite"></i> Cookie Manager</h3>
          <button class="btn-icon close-modal"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="cookie-actions">
            <button class="btn-sm add-cookie-btn"><i class="fas fa-plus"></i> Add Cookie</button>
            <button class="btn-sm delete-all-cookies-btn" ${totalCookies === 0 ? 'disabled' : ''}>
              <i class="fas fa-trash"></i> Delete All (${totalCookies})
            </button>
          </div>
          
          <div class="add-cookie-form" style="display: none;">
            <h4><i class="fas fa-cookie"></i> Add New Cookie</h4>
            <div class="add-cookie-grid">
              <div class="add-cookie-field">
                <label>Name *</label>
                <input type="text" id="newCookieName" placeholder="cookie_name">
              </div>
              <div class="add-cookie-field">
                <label>Domain *</label>
                <input type="text" id="newCookieDomain" placeholder="example.com">
              </div>
              <div class="add-cookie-field full-width">
                <label>Value</label>
                <input type="text" id="newCookieValue" placeholder="cookie_value">
              </div>
              <div class="add-cookie-field">
                <label>Path</label>
                <input type="text" id="newCookiePath" placeholder="/" value="/">
              </div>
              <div class="add-cookie-field">
                <label>Expires</label>
                <input type="datetime-local" id="newCookieExpires">
              </div>
              <div class="add-cookie-field full-width">
                <div class="add-cookie-checkboxes">
                  <label><input type="checkbox" id="newCookieSecure"> Secure</label>
                  <label><input type="checkbox" id="newCookieHttpOnly"> HttpOnly</label>
                </div>
              </div>
            </div>
            <div class="add-cookie-actions">
              <button class="btn-sm cancel-add-cookie">Cancel</button>
              <button class="btn-sm save-new-cookie" style="background: var(--accent); border-color: var(--accent);">
                <i class="fas fa-save"></i> Save Cookie
              </button>
            </div>
          </div>
          
          <div class="cookie-domains-list">
            ${renderCookieDomains()}
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close modal
    modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    // Show/hide add cookie form
    const addCookieForm = modal.querySelector('.add-cookie-form');
    modal.querySelector('.add-cookie-btn').addEventListener('click', () => {
      addCookieForm.style.display = addCookieForm.style.display === 'none' ? 'block' : 'none';
    });
    
    modal.querySelector('.cancel-add-cookie').addEventListener('click', () => {
      addCookieForm.style.display = 'none';
    });
    
    // Save new cookie
    modal.querySelector('.save-new-cookie').addEventListener('click', () => {
      const name = modal.querySelector('#newCookieName').value.trim();
      const domain = modal.querySelector('#newCookieDomain').value.trim();
      const value = modal.querySelector('#newCookieValue').value;
      const path = modal.querySelector('#newCookiePath').value || '/';
      const expiresInput = modal.querySelector('#newCookieExpires').value;
      const secure = modal.querySelector('#newCookieSecure').checked;
      const httpOnly = modal.querySelector('#newCookieHttpOnly').checked;
      
      if (!name || !domain) {
        showToast('Name and Domain are required', 'error');
        return;
      }
      
      const newCookie = {
        name,
        value,
        domain,
        path,
        expires: expiresInput ? new Date(expiresInput).toISOString() : null,
        secure,
        httpOnly,
        sameSite: 'Lax'
      };
      
      storeCookie(newCookie);
      showToast(`Cookie "${name}" added`, 'success');
      modal.remove();
      showCookieManagerModal();
    });
    
    // Delete all cookies
    modal.querySelector('.delete-all-cookies-btn').addEventListener('click', () => {
      if (confirm('Delete all cookies?')) {
        deleteAllCookies();
        showToast('All cookies deleted', 'success');
        modal.remove();
        showCookieManagerModal();
      }
    });
    
    // Domain expand/collapse
    modal.querySelectorAll('.cookie-domain-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.cookie-domain-actions')) return;
        const group = header.closest('.cookie-domain-group');
        group.classList.toggle('expanded');
      });
    });
    
    // Delete domain cookies
    modal.querySelectorAll('.delete-domain-cookies').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const domain = btn.dataset.domain;
        if (confirm(`Delete all cookies for ${domain}?`)) {
          deleteDomainCookies(domain);
          showToast(`Cookies for ${domain} deleted`, 'success');
          modal.remove();
          showCookieManagerModal();
        }
      });
    });
    
    // Edit cookie value
    modal.querySelectorAll('.cookie-value-input').forEach(input => {
      input.addEventListener('change', () => {
        const domain = input.dataset.domain;
        const name = input.dataset.name;
        if (cookies[domain] && cookies[domain][name]) {
          cookies[domain][name].value = input.value;
          saveCookies();
          showToast('Cookie value updated', 'success');
        }
      });
    });
    
    // Delete individual cookie
    modal.querySelectorAll('.delete-cookie-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const domain = btn.dataset.domain;
        const name = btn.dataset.name;
        deleteCookie(domain, name);
        showToast(`Cookie "${name}" deleted`, 'success');
        modal.remove();
        showCookieManagerModal();
      });
    });
  }

  function renderCookieDomains() {
    const domains = Object.keys(cookies);
    
    if (domains.length === 0) {
      return `
        <div class="no-cookies-message">
          <i class="fas fa-cookie-bite"></i>
          <p>No cookies stored</p>
          <small>Cookies from responses will appear here, or add them manually</small>
        </div>
      `;
    }
    
    return domains.map(domain => {
      const domainCookies = Object.values(cookies[domain]);
      return `
        <div class="cookie-domain-group expanded">
          <div class="cookie-domain-header">
            <i class="fas fa-chevron-right domain-toggle"></i>
            <span class="domain-name">${escapeHtml(domain)}</span>
            <span class="cookie-count">${domainCookies.length} cookie${domainCookies.length !== 1 ? 's' : ''}</span>
            <div class="cookie-domain-actions">
              <button class="btn-icon delete-domain-cookies" data-domain="${escapeHtml(domain)}" title="Delete all cookies for this domain">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
          <div class="cookie-list">
            ${domainCookies.map(cookie => renderCookieItem(cookie, domain)).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderCookieItem(cookie, domain) {
    const expired = isCookieExpired(cookie);
    return `
      <div class="cookie-item ${expired ? 'expired' : ''}">
        <div class="cookie-item-header">
          <span class="cookie-name">${escapeHtml(cookie.name)}</span>
          <div class="cookie-badges">
            ${cookie.secure ? '<span class="cookie-badge secure">Secure</span>' : ''}
            ${cookie.httpOnly ? '<span class="cookie-badge http-only">HttpOnly</span>' : ''}
            ${expired ? '<span class="cookie-badge expired">Expired</span>' : ''}
          </div>
        </div>
        <div class="cookie-details">
          <div class="cookie-detail">
            <span class="label">Path:</span>
            <span class="value">${escapeHtml(cookie.path || '/')}</span>
          </div>
          <div class="cookie-detail">
            <span class="label">Expires:</span>
            <span class="value">${formatCookieExpiry(cookie.expires)}</span>
          </div>
        </div>
        <div class="cookie-value-row">
          <div class="label">Value:</div>
          <input type="text" class="cookie-value-input" 
                 value="${escapeHtml(cookie.value)}" 
                 data-domain="${escapeHtml(domain)}"
                 data-name="${escapeHtml(cookie.name)}"
                 placeholder="(empty)">
        </div>
        <div class="cookie-item-actions">
          <button class="btn-xs delete-cookie-btn" data-domain="${escapeHtml(domain)}" data-name="${escapeHtml(cookie.name)}">
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    `;
  }

  function showEnvModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Manage Environments</h3>
          <button class="btn-icon close-modal"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="env-list">
            ${environments.map((env, i) => `
              <div class="env-item" data-index="${i}">
                <input type="text" class="env-name" value="${escapeHtml(env.name)}">
                <button class="btn-icon edit-env-vars" title="Edit Variables"><i class="fas fa-edit"></i></button>
                <button class="btn-icon delete-env" title="Delete"><i class="fas fa-trash"></i></button>
              </div>
            `).join('')}
          </div>
          <button class="btn add-env-btn"><i class="fas fa-plus"></i> Add Environment</button>
          <div class="env-vars-editor" style="display:none;">
            <h4>Variables <span class="editing-env-name"></span></h4>
            <textarea class="env-vars-textarea" placeholder="KEY=value&#10;API_URL=https://api.example.com"></textarea>
            <button class="btn save-env-vars">Save Variables</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    // Add environment
    modal.querySelector('.add-env-btn').addEventListener('click', () => {
      environments.push({ name: 'New Environment', variables: {} });
      saveEnvironments();
      modal.remove();
      showEnvModal();
    });
    
    // Edit env vars
    modal.querySelectorAll('.edit-env-vars').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.closest('.env-item').dataset.index);
        const env = environments[index];
        const editor = modal.querySelector('.env-vars-editor');
        const textarea = modal.querySelector('.env-vars-textarea');
        
        editor.style.display = 'block';
        editor.dataset.index = index;
        modal.querySelector('.editing-env-name').textContent = `(${env.name})`;
        textarea.value = Object.entries(env.variables).map(([k, v]) => `${k}=${v}`).join('\n');
      });
    });
    
    // Save env vars
    modal.querySelector('.save-env-vars').addEventListener('click', () => {
      const editor = modal.querySelector('.env-vars-editor');
      const index = parseInt(editor.dataset.index);
      const textarea = modal.querySelector('.env-vars-textarea');
      const vars = {};
      
      textarea.value.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key?.trim()) {
          vars[key.trim()] = valueParts.join('=').trim();
        }
      });
      
      environments[index].variables = vars;
      saveEnvironments();
      showToast('Variables saved', 'success');
    });
    
    // Delete environment
    modal.querySelectorAll('.delete-env').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.closest('.env-item').dataset.index);
        if (environments.length === 1) {
          showToast('Cannot delete the last environment', 'error');
          return;
        }
        environments.splice(index, 1);
        if (activeEnvIndex >= environments.length) activeEnvIndex = 0;
        saveEnvironments();
        modal.remove();
        showEnvModal();
      });
    });
    
    // Update env names on blur
    modal.querySelectorAll('.env-name').forEach(input => {
      input.addEventListener('blur', () => {
        const index = parseInt(input.closest('.env-item').dataset.index);
        environments[index].name = input.value;
        saveEnvironments();
        renderEnvSelect();
      });
    });
  }

  function saveEnvironments() {
    localStorage.setItem('bolt_environments', JSON.stringify(environments));
    renderEnvSelect();
  }

  // Get request data
  function getRequestData() {
    const method = methodSelect.value;
    let url = substituteEnvVars(urlInput.value.trim());
    
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Build headers
    const headers = {};
    headersRows.querySelectorAll('.kv-row').forEach(row => {
      const enabled = row.querySelector('.kv-enabled')?.checked !== false;
      if (!enabled) return;
      const key = substituteEnvVars(row.querySelector('.kv-key').value.trim());
      const value = substituteEnvVars(row.querySelector('.kv-value').value.trim());
      if (key) headers[key] = value;
    });
    
    // Add auth headers
    const auth = authType?.value || 'none';
    if (auth === 'bearer') {
      const token = substituteEnvVars(document.getElementById('bearerToken')?.value?.trim());
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } else if (auth === 'basic') {
      const user = substituteEnvVars(document.getElementById('basicUser')?.value?.trim());
      const pass = document.getElementById('basicPass')?.value || '';
      if (user) headers['Authorization'] = `Basic ${btoa(`${user}:${pass}`)}`;
    } else if (auth === 'apikey') {
      const location = document.getElementById('apiKeyLocation')?.value || 'header';
      const name = substituteEnvVars(document.getElementById('apiKeyName')?.value?.trim());
      const value = substituteEnvVars(document.getElementById('apiKeyValue')?.value?.trim());
      if (name && value) {
        if (location === 'header') {
          headers[name] = value;
        }
        // Query param handled below
      }
    } else if (auth === 'oauth2') {
      const token = substituteEnvVars(document.getElementById('oauth2Token')?.value?.trim());
      const prefix = document.getElementById('oauth2Prefix')?.value?.trim() || 'Bearer';
      if (token) headers['Authorization'] = `${prefix} ${token}`;
    }
    
    // Add cookies for this URL (only if no Cookie header already set)
    if (!headers['Cookie'] && !headers['cookie']) {
      const cookieHeader = buildCookieHeader(url);
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }
    }
    
    // Build query params
    const params = [];
    paramsRows.querySelectorAll('.kv-row').forEach(row => {
      const enabled = row.querySelector('.kv-enabled')?.checked !== false;
      if (!enabled) return;
      const key = substituteEnvVars(row.querySelector('.kv-key').value.trim());
      const value = substituteEnvVars(row.querySelector('.kv-value').value.trim());
      if (key) params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    });
    
    // Add API key as query param if configured
    if (auth === 'apikey' && document.getElementById('apiKeyLocation')?.value === 'query') {
      const name = substituteEnvVars(document.getElementById('apiKeyName')?.value?.trim());
      const value = substituteEnvVars(document.getElementById('apiKeyValue')?.value?.trim());
      if (name && value) params.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
    }
    
    if (params.length > 0) {
      const separator = url.includes('?') ? '&' : '?';
      url += separator + params.join('&');
    }
    
    // Get body type and content
    let body = null;
    let formDataFieldsData = null;
    const bodyTypeEl = document.querySelector('input[name="bodyType"]:checked');
    const bodyType = bodyTypeEl ? bodyTypeEl.value : 'none';
    
    if (bodyType === 'formdata' && !['GET', 'HEAD'].includes(method)) {
      formDataFieldsData = getFormDataFields();
    } else if (bodyType !== 'none' && !['GET', 'HEAD'].includes(method)) {
      body = substituteEnvVars(bodyInput.value);
    }
    
    // Get scripts
    const preScript = preScriptInput?.value || '';
    const testScript = testScriptInput?.value || '';
    
    return { method, url, headers, body, bodyType, formDataFields: formDataFieldsData, preScript, testScript };
  }

  // Pre-request script execution
  function executePreScript(script) {
    if (!script.trim()) return true;
    
    // Create mock console that captures output
    const scriptConsole = createScriptConsole('pre-request');
    
    const context = {
      env: { ...environments[activeEnvIndex].variables },
      setEnv: (key, value) => {
        environments[activeEnvIndex].variables[key] = value;
        saveEnvironments();
      },
      timestamp: () => Date.now(),
      uuid: () => crypto.randomUUID ? crypto.randomUUID() : generateId(),
      randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
      btoa: (str) => btoa(str),
      atob: (str) => atob(str),
    };
    
    try {
      const fn = new Function('bx', 'console', script);
      fn(context, scriptConsole);
      return true;
    } catch (error) {
      addConsoleError('pre-request', error);
      showToast(`Pre-script error: ${error.message}`, 'error');
      switchToConsoleTab();
      return false;
    }
  }

  // Test script execution
  function executeTestScript(script, response) {
    if (!script.trim()) return { passed: 0, failed: 0, results: [] };
    
    // Create mock console that captures output
    const scriptConsole = createScriptConsole('test');
    
    const results = [];
    const context = {
      response: {
        status: response.status,
        statusText: response.status_text,
        body: response.body,
        json: () => { try { return JSON.parse(response.body); } catch { return null; } },
        headers: response.headers,
        time: response.duration,
      },
      env: { ...environments[activeEnvIndex].variables },
      setEnv: (key, value) => {
        environments[activeEnvIndex].variables[key] = value;
        saveEnvironments();
      },
      test: (name, fn) => {
        try {
          fn();
          results.push({ name, passed: true });
        } catch (error) {
          results.push({ name, passed: false, error: error.message });
        }
      },
      expect: (actual) => ({
        toBe: (expected) => { if (actual !== expected) throw new Error(`Expected ${expected} but got ${actual}`); },
        toEqual: (expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`); },
        toContain: (expected) => { if (!actual?.includes?.(expected)) throw new Error(`Expected to contain ${expected}`); },
        toBeTruthy: () => { if (!actual) throw new Error(`Expected truthy value but got ${actual}`); },
        toBeFalsy: () => { if (actual) throw new Error(`Expected falsy value but got ${actual}`); },
        toBeGreaterThan: (expected) => { if (actual <= expected) throw new Error(`Expected ${actual} to be greater than ${expected}`); },
        toBeLessThan: (expected) => { if (actual >= expected) throw new Error(`Expected ${actual} to be less than ${expected}`); },
      }),
    };
    
    try {
      const fn = new Function('bx', 'console', script);
      fn(context, scriptConsole);
    } catch (error) {
      addConsoleError('test', error);
      results.push({ name: 'Script execution', passed: false, error: error.message });
      switchToConsoleTab();
    }
    
    return {
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      results
    };
  }

  // Syntax highlight JSON
  function syntaxHighlight(json) {
    if (typeof json !== 'string') {
      json = JSON.stringify(json, null, 2);
    }
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'key' : 'string';
      } else if (/true|false/.test(match)) {
        cls = 'boolean';
      } else if (/null/.test(match)) {
        cls = 'null';
      }
      return `<span class="${cls}">${match}</span>`;
    });
  }

  // Toast notifications
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // History functions
  function addToHistory(request, response) {
    history.unshift({
      id: generateId(),
      method: request.method,
      url: request.url,
      status: response?.status,
      duration: response?.duration,
      timestamp: Date.now()
    });
    history = history.slice(0, 100);
    localStorage.setItem('bolt_history', JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    if (history.length === 0) {
      historyList.innerHTML = '<div class="empty-state"><i class="fas fa-clock"></i><p>No history yet</p></div>';
      return;
    }
    
    historyList.innerHTML = history.map((item, index) => {
      let pathname;
      try { pathname = new URL(item.url).pathname; } catch { pathname = item.url; }
      const statusClass = item.status ? (item.status < 300 ? 'success' : item.status < 400 ? 'redirect' : 'error') : '';
      return `
        <div class="history-item" data-index="${index}">
          <span class="method ${item.method.toLowerCase()}">${item.method}</span>
          <span class="url">${escapeHtml(pathname)}</span>
          ${item.status ? `<span class="status-badge ${statusClass}">${item.status}</span>` : ''}
          <div class="history-actions">
            <button class="btn-icon save-to-collection-btn" title="Save to Collection"><i class="fas fa-folder-plus"></i></button>
          </div>
        </div>
      `;
    }).join('');
    
    // Load request on click
    historyList.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.history-actions')) return;
        const historyItem = history[parseInt(item.dataset.index)];
        urlInput.value = historyItem.url;
        methodSelect.value = historyItem.method;
        updateMethodColor();
      });
    });
    
    // Save to collection
    historyList.querySelectorAll('.save-to-collection-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.closest('.history-item').dataset.index);
        const historyItem = history[index];
        showSaveToCollectionModal(historyItem);
      });
    });
  }
  
  function showSaveToCollectionModal(request) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal save-modal">
        <div class="modal-header">
          <h3>Save to Collection</h3>
          <button class="btn-icon close-modal"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="save-request-preview">
            <span class="method ${request.method.toLowerCase()}">${request.method}</span>
            <span class="url">${escapeHtml(request.url)}</span>
          </div>
          <label class="input-label">Request Name</label>
          <input type="text" class="save-request-name" placeholder="My Request" value="${escapeHtml(request.url)}">
          
          <label class="input-label">Collection</label>
          ${collections.length > 0 ? `
            <select class="save-collection-select">
              ${collections.map((col, i) => `<option value="${i}">${escapeHtml(col.name)}</option>`).join('')}
              <option value="new">+ New Collection</option>
            </select>
            <input type="text" class="new-collection-name" placeholder="New collection name" style="display:none;">
          ` : `
            <input type="text" class="new-collection-name" placeholder="New collection name">
          `}
          
          <button class="btn save-request-btn"><i class="fas fa-save"></i> Save</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const nameInput = modal.querySelector('.save-request-name');
    const collectionSelect = modal.querySelector('.save-collection-select');
    const newCollectionInput = modal.querySelector('.new-collection-name');
    
    // Show/hide new collection input
    collectionSelect?.addEventListener('change', () => {
      if (collectionSelect.value === 'new') {
        newCollectionInput.style.display = 'block';
        newCollectionInput.focus();
      } else {
        newCollectionInput.style.display = 'none';
      }
    });
    
    // Save button
    modal.querySelector('.save-request-btn').addEventListener('click', () => {
      const name = nameInput.value.trim() || request.url;
      let colIndex;
      
      if (!collectionSelect || collectionSelect.value === 'new') {
        const newColName = newCollectionInput.value.trim();
        if (!newColName) {
          showToast('Enter a collection name', 'error');
          return;
        }
        collections.push({ name: newColName, requests: [], expanded: true });
        colIndex = collections.length - 1;
      } else {
        colIndex = parseInt(collectionSelect.value);
      }
      
      collections[colIndex].requests = collections[colIndex].requests || [];
      collections[colIndex].requests.push({
        id: generateId(),
        name,
        method: request.method,
        url: request.url,
        headers: request.headers || { 'Content-Type': 'application/json' },
        body: request.body || ''
      });
      
      saveCollections();
      renderCollections();
      modal.remove();
      showToast(`Saved to ${collections[colIndex].name}`, 'success');
    });
    
    // Close modal
    modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    nameInput.focus();
    nameInput.select();
  }

  // Collection functions
  function renderCollections() {
    if (collections.length === 0) {
      collectionsList.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No collections yet</p></div>';
      return;
    }
    
    collectionsList.innerHTML = collections.map((col, colIndex) => `
      <div class="collection ${col.expanded ? 'expanded' : ''}" data-index="${colIndex}">
        <div class="collection-header">
          <i class="fas fa-chevron-right collection-toggle"></i>
          <i class="fas fa-folder"></i>
          <span class="collection-name">${escapeHtml(col.name)}</span>
          <div class="collection-actions">
            <button class="btn-icon run-collection-btn" title="Run Collection"><i class="fas fa-play"></i></button>
            <button class="btn-icon add-request-btn" title="Save Current Request"><i class="fas fa-plus"></i></button>
            <button class="btn-icon export-collection-btn" title="Export"><i class="fas fa-download"></i></button>
            <button class="btn-icon delete-collection-btn" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="collection-requests">
          ${(col.requests || []).map((req, reqIndex) => `
            <div class="collection-request" data-col="${colIndex}" data-req="${reqIndex}">
              <span class="method ${req.method.toLowerCase()}">${req.method}</span>
              <span class="request-name">${escapeHtml(req.name || req.url)}</span>
              <div class="request-actions">
                <button class="btn-icon duplicate-request-btn" title="Duplicate"><i class="fas fa-copy"></i></button>
                <button class="btn-icon delete-request-btn" title="Delete"><i class="fas fa-times"></i></button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
    
    // Toggle collection expand/collapse
    collectionsList.querySelectorAll('.collection-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.collection-actions')) return;
        const collection = header.closest('.collection');
        const index = parseInt(collection.dataset.index);
        collection.classList.toggle('expanded');
        collections[index].expanded = collection.classList.contains('expanded');
        saveCollections();
      });
    });
    
    // Load request
    collectionsList.querySelectorAll('.collection-request').forEach(reqEl => {
      reqEl.addEventListener('click', (e) => {
        if (e.target.closest('.request-actions')) return;
        const colIndex = parseInt(reqEl.dataset.col);
        const reqIndex = parseInt(reqEl.dataset.req);
        loadRequest(collections[colIndex].requests[reqIndex]);
      });
    });
    
    // Duplicate request
    collectionsList.querySelectorAll('.duplicate-request-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const reqEl = btn.closest('.collection-request');
        const colIndex = parseInt(reqEl.dataset.col);
        const reqIndex = parseInt(reqEl.dataset.req);
        const req = { ...collections[colIndex].requests[reqIndex], name: collections[colIndex].requests[reqIndex].name + ' (copy)' };
        collections[colIndex].requests.splice(reqIndex + 1, 0, req);
        saveCollections();
        renderCollections();
        showToast('Request duplicated', 'success');
      });
    });
    
    // Delete request
    collectionsList.querySelectorAll('.delete-request-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const reqEl = btn.closest('.collection-request');
        const colIndex = parseInt(reqEl.dataset.col);
        const reqIndex = parseInt(reqEl.dataset.req);
        collections[colIndex].requests.splice(reqIndex, 1);
        saveCollections();
        renderCollections();
        showToast('Request deleted', 'success');
      });
    });
    
    // Add request to collection
    collectionsList.querySelectorAll('.add-request-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const colIndex = parseInt(btn.closest('.collection').dataset.index);
        const { method, url, headers, body, preScript, testScript } = getRequestData();
        if (!url) {
          showToast('Enter a URL first', 'error');
          return;
        }
        const name = prompt('Request name:', url);
        if (name) {
          collections[colIndex].requests = collections[colIndex].requests || [];
          collections[colIndex].requests.push({ 
            id: generateId(),
            method, url, headers, body, name,
            preScript, testScript
          });
          saveCollections();
          renderCollections();
          showToast('Request saved', 'success');
        }
      });
    });
    
    // Export collection
    collectionsList.querySelectorAll('.export-collection-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const colIndex = parseInt(btn.closest('.collection').dataset.index);
        exportCollection(colIndex);
      });
    });
    
    // Delete collection
    collectionsList.querySelectorAll('.delete-collection-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const colIndex = parseInt(btn.closest('.collection').dataset.index);
        if (confirm(`Delete collection "${collections[colIndex].name}"?`)) {
          collections.splice(colIndex, 1);
          saveCollections();
          renderCollections();
          showToast('Collection deleted', 'success');
        }
      });
    });
    
    // Run collection
    collectionsList.querySelectorAll('.run-collection-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const colIndex = parseInt(btn.closest('.collection').dataset.index);
        openCollectionRunner(colIndex);
      });
    });
  }

  function loadRequest(req) {
    methodSelect.value = req.method || 'GET';
    urlInput.value = req.url || '';
    updateMethodColor();
    
    // Clear and set headers
    headersRows.innerHTML = '';
    if (req.headers) {
      Object.entries(req.headers).forEach(([key, value]) => {
        createKVRow(headersRows, key, value);
      });
    } else {
      createKVRow(headersRows, 'Content-Type', 'application/json');
    }
    
    // Clear params
    paramsRows.innerHTML = '';
    if (req.params) {
      Object.entries(req.params).forEach(([key, value]) => {
        createKVRow(paramsRows, key, value);
      });
    }
    
    // Set body
    if (req.body) {
      bodyInput.value = req.body;
      const jsonRadio = document.querySelector('input[name="bodyType"][value="json"]');
      if (jsonRadio) jsonRadio.checked = true;
    } else {
      bodyInput.value = '';
      const noneRadio = document.querySelector('input[name="bodyType"][value="none"]');
      if (noneRadio) noneRadio.checked = true;
    }
    
    // Set scripts
    if (preScriptInput) preScriptInput.value = req.preScript || '';
    if (testScriptInput) testScriptInput.value = req.testScript || '';
    
    showToast('Request loaded', 'info');
  }

  function saveCollections() {
    localStorage.setItem('bolt_collections', JSON.stringify(collections));
  }

  // Export collection as Postman format
  function exportCollection(colIndex) {
    const col = collections[colIndex];
    const postmanCollection = {
      info: {
        name: col.name,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      item: (col.requests || []).map(req => ({
        name: req.name,
        request: {
          method: req.method,
          header: Object.entries(req.headers || {}).map(([key, value]) => ({ key, value })),
          url: { raw: req.url },
          body: req.body ? { mode: "raw", raw: req.body } : undefined
        }
      }))
    };
    
    const blob = new Blob([JSON.stringify(postmanCollection, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${col.name.replace(/[^a-z0-9]/gi, '_')}.postman_collection.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Collection exported', 'success');
  }

  // Import collection
  document.getElementById('importBtn')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        // Detect format (Postman, Insomnia, OpenAPI, or Bolt native)
        if (data.info?.schema?.includes('postman')) {
          importPostmanCollection(data);
        } else if (data._type === 'export' && data.__export_format) {
          importInsomniaCollection(data);
        } else if (data.openapi || data.swagger) {
          importOpenAPI(data);
        } else if (data.name && data.requests) {
          // Bolt native format
          collections.push(data);
          saveCollections();
          renderCollections();
          showToast('Collection imported', 'success');
        } else {
          showToast('Unknown format', 'error');
        }
      } catch (error) {
        showToast(`Import failed: ${error.message}`, 'error');
      }
    };
    input.click();
  });

  function importPostmanCollection(data) {
    const col = {
      name: data.info?.name || 'Imported Collection',
      requests: []
    };
    
    function processItems(items) {
      items.forEach(item => {
        if (item.item) {
          processItems(item.item); // Folder
        } else if (item.request) {
          const req = item.request;
          col.requests.push({
            id: generateId(),
            name: item.name,
            method: req.method || 'GET',
            url: typeof req.url === 'string' ? req.url : req.url?.raw || '',
            headers: (req.header || []).reduce((acc, h) => { acc[h.key] = h.value; return acc; }, {}),
            body: req.body?.raw || ''
          });
        }
      });
    }
    
    processItems(data.item || []);
    collections.push(col);
    saveCollections();
    renderCollections();
    showToast(`Imported ${col.requests.length} requests`, 'success');
  }

  function importInsomniaCollection(data) {
    const col = {
      name: 'Insomnia Import',
      requests: []
    };
    
    const requests = data.resources?.filter(r => r._type === 'request') || [];
    requests.forEach(req => {
      col.requests.push({
        id: generateId(),
        name: req.name,
        method: req.method || 'GET',
        url: req.url || '',
        headers: (req.headers || []).reduce((acc, h) => { acc[h.name] = h.value; return acc; }, {}),
        body: req.body?.text || ''
      });
    });
    
    collections.push(col);
    saveCollections();
    renderCollections();
    showToast(`Imported ${col.requests.length} requests`, 'success');
  }

  function importOpenAPI(data) {
    const col = {
      name: data.info?.title || 'OpenAPI Import',
      requests: []
    };
    
    const baseUrl = data.servers?.[0]?.url || '';
    const paths = data.paths || {};
    
    Object.entries(paths).forEach(([path, methods]) => {
      Object.entries(methods).forEach(([method, spec]) => {
        if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) {
          col.requests.push({
            id: generateId(),
            name: spec.summary || spec.operationId || `${method.toUpperCase()} ${path}`,
            method: method.toUpperCase(),
            url: baseUrl + path,
            headers: { 'Content-Type': 'application/json' },
            body: ''
          });
        }
      });
    });
    
    collections.push(col);
    saveCollections();
    renderCollections();
    showToast(`Imported ${col.requests.length} endpoints`, 'success');
  }

  // Code generation
  document.getElementById('generateCodeBtn')?.addEventListener('click', showCodeGenModal);

  function showCodeGenModal() {
    const { method, url, headers, body } = getRequestData();
    if (!url) {
      showToast('Enter a URL first', 'error');
      return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal code-gen-modal">
        <div class="modal-header">
          <h3>Generate Code</h3>
          <button class="btn-icon close-modal"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <select id="codeLanguage" class="code-lang-select">
            <option value="curl">cURL</option>
            <option value="javascript">JavaScript (fetch)</option>
            <option value="node">Node.js (axios)</option>
            <option value="python">Python (requests)</option>
            <option value="go">Go</option>
            <option value="rust">Rust (reqwest)</option>
            <option value="php">PHP (cURL)</option>
            <option value="ruby">Ruby</option>
          </select>
          <pre class="code-output" id="codeOutput"></pre>
          <button class="btn copy-code-btn"><i class="fas fa-copy"></i> Copy Code</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const langSelect = modal.querySelector('#codeLanguage');
    const codeOutput = modal.querySelector('#codeOutput');
    
    function generateCode() {
      const lang = langSelect.value;
      let code = '';
      
      switch (lang) {
        case 'curl':
          code = generateCurl(method, url, headers, body);
          break;
        case 'javascript':
          code = generateJavaScript(method, url, headers, body);
          break;
        case 'node':
          code = generateNode(method, url, headers, body);
          break;
        case 'python':
          code = generatePython(method, url, headers, body);
          break;
        case 'go':
          code = generateGo(method, url, headers, body);
          break;
        case 'rust':
          code = generateRust(method, url, headers, body);
          break;
        case 'php':
          code = generatePHP(method, url, headers, body);
          break;
        case 'ruby':
          code = generateRuby(method, url, headers, body);
          break;
      }
      
      codeOutput.textContent = code;
    }
    
    langSelect.addEventListener('change', generateCode);
    generateCode();
    
    modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    modal.querySelector('.copy-code-btn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(codeOutput.textContent);
      showToast('Code copied', 'success');
    });
  }

  function generateCurl(method, url, headers, body) {
    let cmd = `curl -X ${method} '${url}'`;
    Object.entries(headers).forEach(([key, value]) => {
      cmd += ` \\\n  -H '${key}: ${value}'`;
    });
    if (body) {
      cmd += ` \\\n  -d '${body.replace(/'/g, "\\'")}'`;
    }
    return cmd;
  }

  function generateJavaScript(method, url, headers, body) {
    return `fetch('${url}', {
  method: '${method}',
  headers: ${JSON.stringify(headers, null, 4)},${body ? `
  body: ${JSON.stringify(body)},` : ''}
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`;
  }

  function generateNode(method, url, headers, body) {
    return `const axios = require('axios');

axios({
  method: '${method.toLowerCase()}',
  url: '${url}',
  headers: ${JSON.stringify(headers, null, 4)},${body ? `
  data: ${body},` : ''}
})
  .then(response => console.log(response.data))
  .catch(error => console.error(error));`;
  }

  function generatePython(method, url, headers, body) {
    return `import requests

response = requests.${method.toLowerCase()}(
    '${url}',
    headers=${JSON.stringify(headers).replace(/"/g, "'")},${body ? `
    json=${body},` : ''}
)

print(response.json())`;
  }

  function generateGo(method, url, headers, body) {
    let code = `package main

import (
    "fmt"
    "net/http"
    "io/ioutil"${body ? `
    "strings"` : ''}
)

func main() {
    client := &http.Client{}
    ${body ? `body := strings.NewReader(\`${body}\`)
    req, _ := http.NewRequest("${method}", "${url}", body)` : `req, _ := http.NewRequest("${method}", "${url}", nil)`}
`;
    Object.entries(headers).forEach(([key, value]) => {
      code += `    req.Header.Set("${key}", "${value}")\n`;
    });
    code += `
    resp, _ := client.Do(req)
    defer resp.Body.Close()
    
    bodyBytes, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(bodyBytes))
}`;
    return code;
  }

  function generateRust(method, url, headers, body) {
    let code = `use reqwest;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let res = client.${method.toLowerCase()}("${url}")`;
    Object.entries(headers).forEach(([key, value]) => {
      code += `\n        .header("${key}", "${value}")`;
    });
    if (body) {
      code += `\n        .body(r#"${body}"#)`;
    }
    code += `
        .send()
        .await?;
    
    println!("{}", res.text().await?);
    Ok(())
}`;
    return code;
  }

  function generatePHP(method, url, headers, body) {
    let code = `<?php
$ch = curl_init();

curl_setopt($ch, CURLOPT_URL, '${url}');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${method}');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
`;
    Object.entries(headers).forEach(([key, value]) => {
      code += `    '${key}: ${value}',\n`;
    });
    code += `]);`;
    if (body) {
      code += `\ncurl_setopt($ch, CURLOPT_POSTFIELDS, '${body.replace(/'/g, "\\'")}');`;
    }
    code += `

$response = curl_exec($ch);
curl_close($ch);

echo $response;
?>`;
    return code;
  }

  function generateRuby(method, url, headers, body) {
    let code = `require 'net/http'
require 'json'

uri = URI('${url}')
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = uri.scheme == 'https'

request = Net::HTTP::${method.charAt(0) + method.slice(1).toLowerCase()}.new(uri)
`;
    Object.entries(headers).forEach(([key, value]) => {
      code += `request['${key}'] = '${value}'\n`;
    });
    if (body) {
      code += `request.body = '${body.replace(/'/g, "\\'")}'\n`;
    }
    code += `
response = http.request(request)
puts response.body`;
    return code;
  }

  // New collection button
  document.getElementById('newCollectionBtn')?.addEventListener('click', () => {
    const name = prompt('Collection name:');
    if (name?.trim()) {
      collections.push({ name: name.trim(), requests: [], expanded: true });
      saveCollections();
      renderCollections();
      showToast('Collection created', 'success');
    }
  });

  // Clear history button
  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
    if (confirm('Clear all history?')) {
      history = [];
      localStorage.setItem('bolt_history', '[]');
      renderHistory();
      showToast('History cleared', 'success');
    }
  });

  // Clear console button
  document.getElementById('clearConsoleBtn')?.addEventListener('click', () => {
    clearConsole();
    showToast('Console cleared', 'info');
  });

  // Send request
  async function sendRequest() {
    const { method, url, headers, body, bodyType, formDataFields: formFields, preScript, testScript } = getRequestData();
    
    if (!url) {
      showToast('Please enter a URL', 'error');
      return;
    }
    
    if (!invoke) {
      showToast('Tauri API not loaded - please restart the app', 'error');
      return;
    }
    
    // Clear console for new request
    clearConsole();
    
    // Execute pre-script
    if (!executePreScript(preScript)) {
      return;
    }
    
    loadingOverlay.classList.add('active');
    responseBody.innerHTML = '<span class="placeholder">Loading...</span>';
    responseHeaders.innerHTML = '';
    responseStatus.textContent = '';
    responseTime.textContent = '';
    responseSize.textContent = '';
    document.getElementById('testResults')?.remove();
    
    // Hide preview iframe
    const previewFrame = document.getElementById('responsePreview');
    if (previewFrame) previewFrame.style.display = 'none';
    responseBody.style.display = 'block';
    
    try {
      let data;
      
      // Use multipart request for form data
      if (bodyType === 'formdata' && formFields && formFields.length > 0) {
        data = await invoke('send_multipart_request', {
          request: { method, url, headers, fields: formFields }
        });
      } else {
        data = await invoke('send_request', {
          request: { method, url, headers, body }
        });
      }
      
      responseData = data; // Store for chaining
      rawResponseBody = data.body || ''; // Store raw for mode switching
      
      if (data.error) {
        responseBody.innerHTML = `<span style="color: var(--error);">Error: ${escapeHtml(data.error)}</span>`;
        responseStatus.textContent = 'Error';
        responseStatus.className = 'status error';
        showToast(`Request failed: ${data.error}`, 'error');
        renderTimingBreakdown(data.timing);
      } else {
        responseStatus.textContent = `${data.status} ${data.status_text}`;
        responseStatus.className = `status ${data.status < 300 ? 'success' : data.status < 400 ? 'redirect' : 'error'}`;
        responseTime.textContent = `${data.duration}ms`;
        responseSize.textContent = formatBytes(data.size);
        
        // Display response based on current preview mode
        displayResponseBody(data.body, data.headers);
        
        // Response headers
        if (data.headers) {
          responseHeaders.innerHTML = Object.entries(data.headers)
            .map(([key, value]) => `
              <div class="header-row">
                <span class="header-key">${escapeHtml(key)}</span>
                <span class="header-value">${escapeHtml(value)}</span>
              </div>
            `).join('');
          
          // Parse and store Set-Cookie headers
          Object.entries(data.headers).forEach(([headerName, headerValue]) => {
            if (headerName.toLowerCase() === 'set-cookie') {
              // Handle multiple cookies (some servers send as comma-separated or array-like)
              const cookieStrings = headerValue.split(/,(?=\s*[^;=]+=[^;]+)/);
              cookieStrings.forEach(cookieStr => {
                const cookie = parseSetCookieHeader(cookieStr.trim(), url);
                if (cookie.name) {
                  storeCookie(cookie);
                }
              });
            }
          });
          
          // Update response cookies tab
          renderResponseCookies(url);
        }
        
        // Render timing breakdown
        renderTimingBreakdown(data.timing);
        
        // Execute tests
        if (testScript) {
          const testResults = executeTestScript(testScript, data);
          showTestResults(testResults);
        }
        
        // Save response to current tab
        const currentTab = getActiveTab();
        if (currentTab) {
          currentTab.response = data;
          currentTab.unsaved = false;
          renderTabs();
        }
        
        addToHistory({ method, url }, data);
        showToast(`${method} ${data.status} - ${data.duration}ms`, 'success');
      }
    } catch (error) {
      responseBody.innerHTML = `<span style="color: var(--error);">Error: ${escapeHtml(String(error))}</span>`;
      responseStatus.textContent = 'Error';
      responseStatus.className = 'status error';
      showToast(`Error: ${error}`, 'error');
    } finally {
      loadingOverlay.classList.remove('active');
    }
  }
  
  // Render response cookies tab
  function renderResponseCookies(requestUrl) {
    const responseCookies = document.getElementById('responseCookies');
    if (!responseCookies) return;
    
    const domain = parseCookieDomain(requestUrl);
    const matchingCookies = [];
    
    // Find cookies that match this domain
    if (domain && cookies[domain]) {
      matchingCookies.push(...Object.values(cookies[domain]));
    }
    
    // Also check for parent domain cookies
    Object.keys(cookies).forEach(cookieDomain => {
      if (domain && cookieDomain !== domain && domain.endsWith('.' + cookieDomain)) {
        matchingCookies.push(...Object.values(cookies[cookieDomain]));
      }
    });
    
    if (matchingCookies.length === 0) {
      responseCookies.innerHTML = '<div class="empty-state"><i class="fas fa-cookie"></i><p>No cookies</p></div>';
      return;
    }
    
    responseCookies.innerHTML = `
      <table class="cookies-table-grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
            <th>Domain</th>
            <th>Path</th>
            <th>Expires</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          ${matchingCookies.map(cookie => `
            <tr class="${isCookieExpired(cookie) ? 'expired-row' : ''}">
              <td class="cookie-name-cell">${escapeHtml(cookie.name)}</td>
              <td class="cookie-value-cell" title="${escapeHtml(cookie.value)}">${escapeHtml(cookie.value.substring(0, 50))}${cookie.value.length > 50 ? '...' : ''}</td>
              <td>${escapeHtml(cookie.domain)}</td>
              <td>${escapeHtml(cookie.path || '/')}</td>
              <td>${formatCookieExpiry(cookie.expires)}</td>
              <td>
                ${cookie.secure ? '<span class="cookie-flag secure">Secure</span>' : ''}
                ${cookie.httpOnly ? '<span class="cookie-flag httponly">HttpOnly</span>' : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  // Display response body based on current preview mode
  function displayResponseBody(body, headers) {
    const previewFrame = document.getElementById('responsePreview');
    const contentType = headers?.['content-type'] || '';
    
    if (currentPreviewMode === 'pretty') {
      responseBody.style.display = 'block';
      if (previewFrame) previewFrame.style.display = 'none';
      
      // Try to format as JSON
      try {
        const parsed = JSON.parse(body);
        responseBody.innerHTML = syntaxHighlight(parsed);
      } catch {
        // Not JSON, show as plain text
        responseBody.textContent = body;
      }
    } else if (currentPreviewMode === 'raw') {
      responseBody.style.display = 'block';
      if (previewFrame) previewFrame.style.display = 'none';
      responseBody.textContent = body;
    } else if (currentPreviewMode === 'preview') {
      // HTML preview mode
      if (contentType.includes('html') || body.trim().startsWith('<')) {
        responseBody.style.display = 'none';
        if (previewFrame) {
          previewFrame.style.display = 'block';
          previewFrame.srcdoc = body;
        }
      } else {
        // Not HTML, fallback to pretty mode for non-HTML content
        responseBody.style.display = 'block';
        if (previewFrame) previewFrame.style.display = 'none';
        responseBody.textContent = body;
        showToast('Preview mode works best with HTML responses', 'info');
      }
    }
  }
  
  // Switch preview mode
  function setPreviewMode(mode) {
    currentPreviewMode = mode;
    localStorage.setItem('bolt_preview_mode', mode);
    
    // Update button states
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    // Re-display response if we have one
    if (rawResponseBody) {
      displayResponseBody(rawResponseBody, responseData?.headers);
    }
  }

  function showTestResults(results) {
    const container = document.createElement('div');
    container.id = 'testResults';
    container.className = 'test-results';
    container.innerHTML = `
      <div class="test-summary">
        <span class="passed"><i class="fas fa-check"></i> ${results.passed} passed</span>
        <span class="failed"><i class="fas fa-times"></i> ${results.failed} failed</span>
      </div>
      <div class="test-list">
        ${results.results.map(r => `
          <div class="test-item ${r.passed ? 'passed' : 'failed'}">
            <i class="fas fa-${r.passed ? 'check' : 'times'}"></i>
            <span>${escapeHtml(r.name)}</span>
            ${r.error ? `<span class="error-msg">${escapeHtml(r.error)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
    
    const responsePanel = document.querySelector('.response-content');
    responsePanel.insertBefore(container, responsePanel.firstChild);
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Event listeners
  sendBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    sendRequest();
  });

  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendRequest();
    }
  });

  // Response toolbar
  document.getElementById('formatBtn')?.addEventListener('click', () => {
    try {
      const json = JSON.parse(responseBody.textContent);
      responseBody.innerHTML = syntaxHighlight(json);
      showToast('JSON formatted', 'success');
    } catch { showToast('Not valid JSON', 'error'); }
  });

  document.getElementById('copyBtn')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(responseBody.textContent);
    showToast('Copied', 'success');
  });

  document.getElementById('wrapBtn')?.addEventListener('click', () => {
    responseBody.classList.toggle('no-wrap');
  });

  document.getElementById('searchResponseBtn')?.addEventListener('click', () => {
    const query = prompt('Search in response:');
    if (query) {
      const text = responseBody.textContent;
      const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      responseBody.innerHTML = text.replace(regex, '<mark>$1</mark>');
    }
  });

  // Save Response to File
  document.getElementById('saveResponseBtn')?.addEventListener('click', async () => {
    if (!rawResponseBody) {
      showToast('No response to save', 'error');
      return;
    }
    
    // Generate suggested filename from URL and content type
    let suggestedName = 'response';
    try {
      const urlObj = new URL(urlInput.value);
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length > 0) {
        suggestedName = pathParts[pathParts.length - 1].replace(/[^a-z0-9._-]/gi, '_');
      }
    } catch {}
    
    // Add extension based on content type
    const contentType = responseData?.headers?.['content-type'] || '';
    if (contentType.includes('json')) {
      if (!suggestedName.endsWith('.json')) suggestedName += '.json';
    } else if (contentType.includes('html')) {
      if (!suggestedName.endsWith('.html')) suggestedName += '.html';
    } else if (contentType.includes('xml')) {
      if (!suggestedName.endsWith('.xml')) suggestedName += '.xml';
    } else if (!suggestedName.includes('.')) {
      suggestedName += '.txt';
    }
    
    try {
      // Use Tauri dialog API if available
      if (window.__TAURI__?.dialog?.save) {
        const filePath = await window.__TAURI__.dialog.save({
          defaultPath: suggestedName,
          filters: [
            { name: 'JSON', extensions: ['json'] },
            { name: 'HTML', extensions: ['html', 'htm'] },
            { name: 'XML', extensions: ['xml'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        
        if (filePath) {
          await invoke('save_response_to_file', {
            path: filePath,
            content: rawResponseBody
          });
          showToast(`Saved to ${filePath}`, 'success');
        }
      } else {
        // Fallback: use browser download
        const blob = new Blob([rawResponseBody], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Response downloaded', 'success');
      }
    } catch (error) {
      showToast(`Save failed: ${error}`, 'error');
    }
  });

  // Preview Mode Toggle
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setPreviewMode(btn.dataset.mode);
    });
  });
  
  // Set initial preview mode button state
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentPreviewMode);
  });

  // Method color
  function updateMethodColor() {
    const colors = {
      GET: 'var(--method-get)',
      POST: 'var(--method-post)',
      PUT: 'var(--method-put)',
      PATCH: 'var(--method-patch)',
      DELETE: 'var(--method-delete)',
      HEAD: 'var(--text-secondary)',
      OPTIONS: 'var(--text-secondary)'
    };
    if (methodSelect) methodSelect.style.color = colors[methodSelect.value] || 'var(--text-primary)';
  }

  methodSelect?.addEventListener('change', updateMethodColor);

  // Initialize
  updateMethodColor();
  renderHistory();
  renderCollections();
  renderEnvSelect();

  // ===================
  // KEYBOARD SHORTCUTS
  // ===================
  
  // Close any open modal
  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => modal.remove());
  }
  
  // Toggle environment selector dropdown
  function toggleEnvSelector() {
    if (envSelect) {
      envSelect.focus();
      // Trigger a click to open the dropdown
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      envSelect.dispatchEvent(event);
    }
  }
  
  // Show save to collection modal for current request
  function saveCurrentRequest() {
    const { method, url, headers, body, preScript, testScript } = getRequestData();
    if (!url) {
      showToast('Enter a URL first', 'error');
      return;
    }
    showSaveToCollectionModal({ method, url, headers, body, preScript, testScript });
  }
  
  // Global keyboard shortcut handler
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;
    
    // Check if we're in a text input that should handle shortcuts normally
    const activeElement = document.activeElement;
    const isTextInput = activeElement && (
      activeElement.tagName === 'TEXTAREA' ||
      (activeElement.tagName === 'INPUT' && activeElement.type === 'text') ||
      activeElement.isContentEditable
    );
    
    // Escape - Close any open modal
    if (e.key === 'Escape') {
      const modals = document.querySelectorAll('.modal-overlay');
      if (modals.length > 0) {
        closeAllModals();
        e.preventDefault();
        return;
      }
    }
    
    // Cmd/Ctrl+Enter - Send request
    if (modifier && e.key === 'Enter') {
      e.preventDefault();
      sendRequest();
      return;
    }
    
    // Cmd/Ctrl+S - Save current request to collection
    if (modifier && e.key === 's') {
      e.preventDefault();
      saveCurrentRequest();
      return;
    }
    
    // Cmd/Ctrl+L - Focus URL input
    if (modifier && e.key === 'l') {
      e.preventDefault();
      if (urlInput) {
        urlInput.focus();
        urlInput.select();
      }
      return;
    }
    
    // Cmd/Ctrl+E - Toggle environment selector
    if (modifier && e.key === 'e') {
      e.preventDefault();
      toggleEnvSelector();
      return;
    }
  });

  // Initialize tabs and change tracking
  initializeTabs();
  setupChangeTracking();
  renderConsole();
  
  // ===================
  // COLLECTION RUNNER
  // ===================
  
  function openCollectionRunner(colIndex) {
    const collection = collections[colIndex];
    if (!collection || !collection.requests || collection.requests.length === 0) {
      showToast('Collection has no requests', 'error');
      return;
    }
    
    runnerState.collectionIndex = colIndex;
    runnerState.running = false;
    runnerState.aborted = false;
    runnerState.results = [];
    runnerState.passed = 0;
    runnerState.failed = 0;
    runnerState.skipped = 0;
    
    const modal = document.getElementById('collectionRunnerModal');
    const runnerConfig = document.getElementById('runnerConfig');
    const runnerProgress = document.getElementById('runnerProgress');
    const runnerResults = document.getElementById('runnerResults');
    
    // Reset to config view
    runnerConfig.style.display = 'block';
    runnerProgress.style.display = 'none';
    runnerResults.style.display = 'none';
    
    // Set collection name
    document.getElementById('runnerCollectionName').textContent = collection.name;
    
    // Populate environment selector
    const runnerEnvSelect = document.getElementById('runnerEnvSelect');
    runnerEnvSelect.innerHTML = environments.map((env, i) => 
      `<option value="${i}" ${i === activeEnvIndex ? 'selected' : ''}>${escapeHtml(env.name)}</option>`
    ).join('');
    
    // Populate requests list
    const runnerRequestsList = document.getElementById('runnerRequestsList');
    runnerRequestsList.innerHTML = collection.requests.map((req, i) => `
      <div class="runner-request-item" data-index="${i}">
        <input type="checkbox" class="runner-request-checkbox" data-index="${i}" checked>
        <span class="method ${req.method.toLowerCase()}">${req.method}</span>
        <span class="request-name">${escapeHtml(req.name || req.url)}</span>
      </div>
    `).join('');
    
    // Select all checkbox
    const selectAllCheckbox = document.getElementById('runnerSelectAll');
    selectAllCheckbox.checked = true;
    selectAllCheckbox.onchange = () => {
      runnerRequestsList.querySelectorAll('.runner-request-checkbox').forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
      });
    };
    
    // Reset form values
    document.getElementById('runnerIterations').value = 1;
    document.getElementById('runnerDelay').value = 0;
    
    // Show modal
    modal.style.display = 'flex';
  }
  
  // Close runner modal
  document.getElementById('closeRunnerModal')?.addEventListener('click', () => {
    const modal = document.getElementById('collectionRunnerModal');
    modal.style.display = 'none';
    runnerState.aborted = true; // Stop any running collection
  });
  
  document.getElementById('collectionRunnerModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'collectionRunnerModal') {
      document.getElementById('collectionRunnerModal').style.display = 'none';
      runnerState.aborted = true;
    }
  });
  
  // Start collection run
  document.getElementById('runnerStartBtn')?.addEventListener('click', startCollectionRun);
  
  // Stop collection run
  document.getElementById('runnerStopBtn')?.addEventListener('click', () => {
    runnerState.aborted = true;
    showToast('Stopping collection run...', 'info');
  });
  
  // Run again button
  document.getElementById('runnerRunAgainBtn')?.addEventListener('click', () => {
    const colIndex = runnerState.collectionIndex;
    openCollectionRunner(colIndex);
  });
  
  // Export results button
  document.getElementById('runnerExportBtn')?.addEventListener('click', exportRunnerResults);
  
  async function startCollectionRun() {
    const collection = collections[runnerState.collectionIndex];
    const iterations = parseInt(document.getElementById('runnerIterations').value) || 1;
    const delay = parseInt(document.getElementById('runnerDelay').value) || 0;
    const selectedEnvIndex = parseInt(document.getElementById('runnerEnvSelect').value);
    
    // Get selected requests
    const selectedIndices = [];
    document.querySelectorAll('.runner-request-checkbox:checked').forEach(cb => {
      selectedIndices.push(parseInt(cb.dataset.index));
    });
    
    if (selectedIndices.length === 0) {
      showToast('Select at least one request', 'error');
      return;
    }
    
    // Initialize runner state
    runnerState.running = true;
    runnerState.aborted = false;
    runnerState.results = [];
    runnerState.passed = 0;
    runnerState.failed = 0;
    runnerState.skipped = 0;
    
    // Switch to progress view
    document.getElementById('runnerConfig').style.display = 'none';
    document.getElementById('runnerProgress').style.display = 'block';
    document.getElementById('runnerResults').style.display = 'none';
    
    // Reset progress UI
    document.getElementById('runnerProgressFill').style.width = '0%';
    document.getElementById('runnerPassed').textContent = '0';
    document.getElementById('runnerFailed').textContent = '0';
    document.getElementById('runnerSkipped').textContent = '0';
    document.getElementById('runnerCurrent').innerHTML = '';
    document.getElementById('runnerProgressText').textContent = 'Running...';
    
    const totalRequests = selectedIndices.length * iterations;
    let completedRequests = 0;
    
    // Store original env index to restore later
    const originalEnvIndex = activeEnvIndex;
    activeEnvIndex = selectedEnvIndex;
    
    try {
      for (let iteration = 1; iteration <= iterations && !runnerState.aborted; iteration++) {
        for (let i = 0; i < selectedIndices.length && !runnerState.aborted; i++) {
          const reqIndex = selectedIndices[i];
          const request = collection.requests[reqIndex];
          
          // Update current request display
          const currentDiv = document.getElementById('runnerCurrent');
          currentDiv.innerHTML = `
            <div class="runner-current-item">
              <div class="spinner-small"></div>
              <span class="method ${request.method.toLowerCase()}">${request.method}</span>
              <span>${escapeHtml(request.name || request.url)}</span>
              ${iterations > 1 ? `<span class="iteration-badge">Iteration ${iteration}/${iterations}</span>` : ''}
            </div>
          `;
          
          const result = await runSingleRequest(request, iteration);
          runnerState.results.push(result);
          
          // Update stats
          if (result.success) {
            if (result.testsFailed > 0) {
              runnerState.failed++;
            } else {
              runnerState.passed++;
            }
          } else {
            runnerState.failed++;
          }
          
          // Update UI
          completedRequests++;
          const progress = (completedRequests / totalRequests) * 100;
          document.getElementById('runnerProgressFill').style.width = `${progress}%`;
          document.getElementById('runnerPassed').textContent = runnerState.passed;
          document.getElementById('runnerFailed').textContent = runnerState.failed;
          document.getElementById('runnerSkipped').textContent = runnerState.skipped;
          
          // Show completed request
          const statusClass = result.success && result.testsFailed === 0 ? 'success' : 'error';
          const statusIcon = result.success && result.testsFailed === 0 ? 'check' : 'times';
          currentDiv.innerHTML = `
            <div class="runner-current-item completed ${statusClass}">
              <i class="fas fa-${statusIcon} status-icon"></i>
              <span class="method ${request.method.toLowerCase()}">${request.method}</span>
              <span>${escapeHtml(request.name || request.url)}</span>
              <span style="color: var(--text-muted); margin-left: auto;">${result.duration}ms</span>
            </div>
          `;
          
          // Delay between requests
          if (delay > 0 && (i < selectedIndices.length - 1 || iteration < iterations)) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
    } catch (error) {
      showToast(`Runner error: ${error.message}`, 'error');
    } finally {
      // Restore original environment
      activeEnvIndex = originalEnvIndex;
      
      // Mark any remaining requests as skipped if aborted
      if (runnerState.aborted) {
        const remaining = totalRequests - completedRequests;
        runnerState.skipped = remaining;
        document.getElementById('runnerSkipped').textContent = remaining;
      }
      
      runnerState.running = false;
      
      // Show results
      showRunnerResults();
    }
  }
  
  async function runSingleRequest(request, iteration) {
    const result = {
      name: request.name || request.url,
      method: request.method,
      url: substituteEnvVars(request.url),
      iteration,
      status: null,
      statusText: '',
      duration: 0,
      success: false,
      testsPassed: 0,
      testsFailed: 0,
      testResults: [],
      error: null
    };
    
    const startTime = Date.now();
    
    try {
      // Build request with env var substitution
      let url = substituteEnvVars(request.url);
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      const headers = {};
      if (request.headers) {
        Object.entries(request.headers).forEach(([key, value]) => {
          headers[substituteEnvVars(key)] = substituteEnvVars(value);
        });
      }
      
      let body = null;
      if (request.body && !['GET', 'HEAD'].includes(request.method)) {
        body = substituteEnvVars(request.body);
      }
      
      // Execute pre-script if present
      if (request.preScript) {
        try {
          executePreScriptForRunner(request.preScript);
        } catch (e) {
          result.error = `Pre-script error: ${e.message}`;
          result.duration = Date.now() - startTime;
          return result;
        }
      }
      
      // Send request via Tauri
      if (!invoke) {
        result.error = 'Tauri API not loaded';
        result.duration = Date.now() - startTime;
        return result;
      }
      
      const response = await invoke('send_request', {
        request: { method: request.method, url, headers, body }
      });
      
      result.duration = response.duration || (Date.now() - startTime);
      
      if (response.error) {
        result.error = response.error;
        return result;
      }
      
      result.status = response.status;
      result.statusText = response.status_text;
      result.success = true;
      
      // Execute tests if present
      if (request.testScript) {
        const testResults = executeTestScriptForRunner(request.testScript, response);
        result.testsPassed = testResults.passed;
        result.testsFailed = testResults.failed;
        result.testResults = testResults.results;
      }
      
    } catch (error) {
      result.error = error.message || String(error);
      result.duration = Date.now() - startTime;
    }
    
    return result;
  }
  
  function executePreScriptForRunner(script) {
    if (!script.trim()) return;
    
    const context = {
      env: { ...environments[activeEnvIndex].variables },
      setEnv: (key, value) => {
        environments[activeEnvIndex].variables[key] = value;
        saveEnvironments();
      },
      timestamp: () => Date.now(),
      uuid: () => crypto.randomUUID ? crypto.randomUUID() : generateId(),
      randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
      btoa: (str) => btoa(str),
      atob: (str) => atob(str),
    };
    
    const fn = new Function('bx', script);
    fn(context);
  }
  
  function executeTestScriptForRunner(script, response) {
    if (!script.trim()) return { passed: 0, failed: 0, results: [] };
    
    const results = [];
    const context = {
      response: {
        status: response.status,
        statusText: response.status_text,
        body: response.body,
        json: () => { try { return JSON.parse(response.body); } catch { return null; } },
        headers: response.headers,
        time: response.duration,
      },
      env: { ...environments[activeEnvIndex].variables },
      setEnv: (key, value) => {
        environments[activeEnvIndex].variables[key] = value;
        saveEnvironments();
      },
      test: (name, fn) => {
        try {
          fn();
          results.push({ name, passed: true });
        } catch (error) {
          results.push({ name, passed: false, error: error.message });
        }
      },
      expect: (actual) => ({
        toBe: (expected) => { if (actual !== expected) throw new Error(`Expected ${expected} but got ${actual}`); },
        toEqual: (expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`); },
        toContain: (expected) => { if (!actual?.includes?.(expected)) throw new Error(`Expected to contain ${expected}`); },
        toBeTruthy: () => { if (!actual) throw new Error(`Expected truthy value but got ${actual}`); },
        toBeFalsy: () => { if (actual) throw new Error(`Expected falsy value but got ${actual}`); },
        toBeGreaterThan: (expected) => { if (actual <= expected) throw new Error(`Expected ${actual} to be greater than ${expected}`); },
        toBeLessThan: (expected) => { if (actual >= expected) throw new Error(`Expected ${actual} to be less than ${expected}`); },
      }),
    };
    
    try {
      const fn = new Function('bx', script);
      fn(context);
    } catch (error) {
      results.push({ name: 'Script execution', passed: false, error: error.message });
    }
    
    return {
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      results
    };
  }
  
  function showRunnerResults() {
    document.getElementById('runnerProgress').style.display = 'none';
    document.getElementById('runnerResults').style.display = 'block';
    
    const totalTests = runnerState.results.reduce((sum, r) => sum + r.testsPassed + r.testsFailed, 0);
    const passedTests = runnerState.results.reduce((sum, r) => sum + r.testsPassed, 0);
    const failedTests = runnerState.results.reduce((sum, r) => sum + r.testsFailed, 0);
    const totalTime = runnerState.results.reduce((sum, r) => sum + r.duration, 0);
    const avgTime = runnerState.results.length > 0 ? Math.round(totalTime / runnerState.results.length) : 0;
    
    // Summary
    document.getElementById('runnerResultsSummary').innerHTML = `
      <div class="runner-summary-item">
        <span class="label">Total Requests</span>
        <span class="value neutral">${runnerState.results.length}</span>
      </div>
      <div class="runner-summary-item">
        <span class="label">Passed</span>
        <span class="value success">${runnerState.passed}</span>
      </div>
      <div class="runner-summary-item">
        <span class="label">Failed</span>
        <span class="value error">${runnerState.failed}</span>
      </div>
      ${runnerState.skipped > 0 ? `
      <div class="runner-summary-item">
        <span class="label">Skipped</span>
        <span class="value neutral">${runnerState.skipped}</span>
      </div>
      ` : ''}
      <div class="runner-summary-item">
        <span class="label">Tests Passed</span>
        <span class="value success">${passedTests}</span>
      </div>
      <div class="runner-summary-item">
        <span class="label">Tests Failed</span>
        <span class="value error">${failedTests}</span>
      </div>
      <div class="runner-summary-item">
        <span class="label">Avg. Time</span>
        <span class="value neutral">${avgTime}ms</span>
      </div>
    `;
    
    // Results table
    const iterations = parseInt(document.getElementById('runnerIterations').value) || 1;
    document.getElementById('runnerResultsBody').innerHTML = runnerState.results.map(result => {
      const statusClass = result.status ? (result.status < 300 ? 'success' : result.status < 400 ? 'redirect' : 'error') : 'error';
      const statusText = result.error || `${result.status} ${result.statusText}`;
      
      return `
        <tr>
          <td>
            <div class="request-cell">
              <span class="method ${result.method.toLowerCase()}">${result.method}</span>
              <span>${escapeHtml(result.name)}</span>
              ${iterations > 1 ? `<span class="iteration-badge">#${result.iteration}</span>` : ''}
            </div>
          </td>
          <td class="status-cell ${statusClass}">${escapeHtml(statusText)}</td>
          <td>${result.duration}ms</td>
          <td>
            <div class="tests-cell">
              ${result.testsPassed > 0 ? `<span class="test-badge passed"><i class="fas fa-check"></i> ${result.testsPassed}</span>` : ''}
              ${result.testsFailed > 0 ? `<span class="test-badge failed"><i class="fas fa-times"></i> ${result.testsFailed}</span>` : ''}
              ${result.testsPassed === 0 && result.testsFailed === 0 ? '<span style="color: var(--text-muted);">-</span>' : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    
    document.getElementById('runnerProgressText').textContent = runnerState.aborted ? 'Stopped' : 'Completed';
  }
  
  function exportRunnerResults() {
    const collection = collections[runnerState.collectionIndex];
    const exportData = {
      collection: collection.name,
      timestamp: new Date().toISOString(),
      summary: {
        totalRequests: runnerState.results.length,
        passed: runnerState.passed,
        failed: runnerState.failed,
        skipped: runnerState.skipped,
        totalDuration: runnerState.results.reduce((sum, r) => sum + r.duration, 0),
        testsPassed: runnerState.results.reduce((sum, r) => sum + r.testsPassed, 0),
        testsFailed: runnerState.results.reduce((sum, r) => sum + r.testsFailed, 0)
      },
      results: runnerState.results.map(r => ({
        name: r.name,
        method: r.method,
        url: r.url,
        iteration: r.iteration,
        status: r.status,
        statusText: r.statusText,
        duration: r.duration,
        success: r.success,
        error: r.error,
        tests: r.testResults
      }))
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${collection.name.replace(/[^a-z0-9]/gi, '_')}_results_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Results exported', 'success');
  }
}
