// extension/popup/popup.js

document.addEventListener('DOMContentLoaded', () => {
  // Views
  const viewIdle = document.getElementById('view-idle');
  const viewRunning = document.getElementById('view-running');
  
  // Elements
  const btnRun = document.getElementById('btn-run');
  const btnStop = document.getElementById('btn-stop');
  const btnSettings = document.getElementById('btn-settings');
  const promptInput = document.getElementById('prompt-input');
  const displayQuery = document.getElementById('display-query');

  // Transition to Running State
  btnRun.addEventListener('click', () => {
    const query = promptInput.value.trim();
    if (!query) return;

    // Update UI
    displayQuery.textContent = query;
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

  // Trigger Mock Notification (Testing purpose mapped to Settings gear for now)
  btnSettings.addEventListener('click', () => {
    chrome.notifications.create({
      type: 'basic',
      title: 'BVAgent Status',
      message: 'Extension settings loaded correctly.',
      iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' // 1x1 transparent pixel fallback
    });
  });

  // Make tabs clickable (Visual toggle only)
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      // Remove active class from all
      tabs.forEach(t => t.classList.remove('active'));
      // Add active to clicked
      e.currentTarget.classList.add('active');
    });
  });

  // Make lock icon clickable
  const lockIcon = document.querySelectorAll('.icon-btn')[1]; // 2nd icon btn
  if (lockIcon) {
    lockIcon.addEventListener('click', () => {
      alert("Privacy Vault is locked. Credentials are safe on-device.");
    });
  }
});
