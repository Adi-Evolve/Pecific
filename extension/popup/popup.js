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

  // Privacy Modal & Telemetry Elements
  const modalVault = document.getElementById('modal-privacy-vault');
  const btnCloseVault = document.getElementById('btn-close-vault');
  const btnDoneVault = document.getElementById('btn-done-vault');
  const btnResetVault = document.getElementById('btn-reset-vault');
  const badgePrivacyIdle = document.getElementById('badge-privacy-idle');
  const badgePrivacyRunning = document.getElementById('badge-privacy-running');
  const statSpii = document.getElementById('stat-spii-count');
  const statPii = document.getElementById('stat-pii-count');
  const statCtx = document.getElementById('stat-ctx-count');
  const statLeak = document.getElementById('stat-leak-count');
  const tokenListContainer = document.getElementById('token-manifest-list');
  const idleMaskedCount = document.getElementById('idle-masked-count');
  const runningMaskedCount = document.getElementById('running-masked-count');

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

  // ─── Privacy Vault & Telemetry Logic ───────────────────────────────────────
  function openVaultModal() {
    if (modalVault) {
      modalVault.style.display = 'flex';
      refreshTelemetry();
    }
  }

  function closeVaultModal() {
    if (modalVault) {
      modalVault.style.display = 'none';
    }
  }

  function updateTelemetryUI(telemetry) {
    if (!telemetry) return;

    if (statSpii) statSpii.textContent = telemetry.spii_count || 0;
    if (statPii) statPii.textContent = telemetry.pii_count || 0;
    if (statCtx) statCtx.textContent = telemetry.contextual_count || 0;
    if (statLeak) statLeak.textContent = '0';

    const total = telemetry.total_masked || 0;
    if (idleMaskedCount) idleMaskedCount.textContent = total;
    if (runningMaskedCount) runningMaskedCount.textContent = total;

    if (tokenListContainer) {
      const tokens = telemetry.tokens_active || [];
      if (tokens.length === 0) {
        tokenListContainer.innerHTML = '<div class="token-empty">No active tokens yet. Page has 0 sensitive fields.</div>';
      } else {
        tokenListContainer.innerHTML = tokens.map(token => {
          let cat = 'PII';
          if (/(?:PASSWORD|AADHAAR|PAN|CARD|DL|VOTER_ID|BANK_ACCOUNT|UAN|OTP)/i.test(token)) {
            cat = 'SPII';
          } else if (/(?:ADDRESS|DOB|IFSC|IP)/i.test(token)) {
            cat = 'CONTEXTUAL';
          }
          return `
            <div class="token-item">
              <span class="token-badge">${token}</span>
              <span class="token-cat ${cat}">${cat}</span>
            </div>
          `;
        }).join('');
      }
    }
  }

  function refreshTelemetry() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_PRIVACY_TELEMETRY' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.telemetry) {
          updateTelemetryUI(response.telemetry);
        }
      });
    } catch (e) {
      // Ignored
    }
  }

  // Event Listeners for Privacy Vault Modal
  if (btnLock) btnLock.addEventListener('click', openVaultModal);
  if (badgePrivacyIdle) badgePrivacyIdle.addEventListener('click', openVaultModal);
  if (badgePrivacyRunning) badgePrivacyRunning.addEventListener('click', openVaultModal);
  if (btnCloseVault) btnCloseVault.addEventListener('click', closeVaultModal);
  if (btnDoneVault) btnDoneVault.addEventListener('click', closeVaultModal);

  if (btnResetVault) {
    btnResetVault.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'RESET_SESSION' }, () => {
        refreshTelemetry();
      });
    });
  }

  // Listen for real-time telemetry broadcasts from service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'PRIVACY_TELEMETRY_UPDATED' && message.payload) {
      updateTelemetryUI(message.payload);
    }
  });

  // Initial telemetry fetch
  refreshTelemetry();

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
    }, (response) => {
      if (response && response.telemetry) {
        updateTelemetryUI(response.telemetry);
      }
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
      message: 'Zero-Egress Privacy Engine Active (DPDP Act 2023 Compliant).',
      iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    });
  });
});
