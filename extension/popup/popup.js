// extension/popup/popup.js

document.addEventListener('DOMContentLoaded', () => {
  // Views
  const viewIdle = document.getElementById('view-idle');
  const viewRunning = document.getElementById('view-running');
  
  // Elements
  const btnRun = document.getElementById('btn-run');
  const btnStop = document.getElementById('btn-stop');
  const btnSettings = document.getElementById('btn-settings');
  const btnLock = document.getElementById('btn-lock');
  const btnTheme = document.getElementById('btn-theme');
  const iconSun = document.getElementById('icon-sun');
  const iconMoon = document.getElementById('icon-moon');
  const promptInput = document.getElementById('prompt-input');
  const displayQuery = document.getElementById('display-query');

  // Load saved theme
  chrome.storage.local.get(['theme'], (result) => {
    if (result.theme === 'dark') {
      document.body.classList.add('dark-mode');
      iconMoon.style.display = 'none';
      iconSun.style.display = 'block';
    }
  });

  // Toggle Theme
  btnTheme.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    
    iconMoon.style.display = isDark ? 'none' : 'block';
    iconSun.style.display = isDark ? 'block' : 'none';
    
    chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
  });

  // Transition to Running State
  btnRun.addEventListener('click', () => {
    const query = promptInput.value.trim();
    if (!query) return;

    // Update UI
    displayQuery.textContent = `"${query}"`;
    viewIdle.style.display = 'none';
    viewRunning.style.display = 'block';

    // Send USER_QUERY to service worker
    chrome.runtime.sendMessage({
      type: 'USER_QUERY',
      timestamp: new Date().toISOString(),
      payload: { query: query }
    });
  });

  // Transition to Idle State
  btnStop.addEventListener('click', () => {
    // Send STOP_AGENT to service worker
    chrome.runtime.sendMessage({
      type: 'STOP_AGENT',
      timestamp: new Date().toISOString(),
      payload: {}
    });

    // Update UI
    viewRunning.style.display = 'none';
    viewIdle.style.display = 'block';
  });

  // Trigger Mock Notification
  btnSettings.addEventListener('click', () => {
    chrome.notifications.create({
      type: 'basic',
      title: 'Pecific Settings',
      message: 'Settings opened (Mock).',
      iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    });
  });

  // Lock Icon Interaction
  if (btnLock) {
    btnLock.addEventListener('click', () => {
      alert("Privacy Vault is locked. Credentials are safe on-device.");
    });
  }
});
