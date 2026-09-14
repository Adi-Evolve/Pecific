const MAX_AGENT_TABS = 5;
const AGENT_BADGE = '🤖';
const AGENT_BORDER = '#00ff88';

const registry = {
  user_tabs: new Set(),
  agent_tabs: new Map()
};

function requireChrome() {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    throw new Error('Tab manager requires the Chrome tabs API');
  }
}

function agentTabRecord(tab, purpose) {
  return {
    id: tab.id,
    purpose: purpose || 'agent_task',
    status: 'active',
    badge: AGENT_BADGE,
    window_id: tab.windowId,
    url: tab.url || ''
  };
}

async function markAgentTab(tabId) {
  if (chrome.action?.setBadgeText) {
    await chrome.action.setBadgeText({ tabId, text: AGENT_BADGE });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: AGENT_BORDER });
  }
  if (chrome.scripting?.executeScript) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (color) => {
        const id = '__pecific_agent_marker';
        let style = document.getElementById(id);
        if (!style) {
          style = document.createElement('style');
          style.id = id;
          document.documentElement.appendChild(style);
        }
        style.textContent = `html { outline: 3px solid ${color} !important; outline-offset: -3px !important; }`;
      },
      args: [AGENT_BORDER]
    });
  }
}

function registerUserTab(tabId) {
  if (Number.isInteger(tabId) && !registry.agent_tabs.has(tabId)) {
    registry.user_tabs.add(tabId);
  }
}

function registerAgentTab(tab, purpose) {
  if (!tab || !Number.isInteger(tab.id)) throw new Error('Cannot register tab without an id');
  registry.user_tabs.delete(tab.id);
  const record = agentTabRecord(tab, purpose);
  registry.agent_tabs.set(tab.id, record);
  return { ...record };
}

function updateAgentTab(tab) {
  const record = registry.agent_tabs.get(tab?.id);
  if (!record) return false;
  if (typeof tab.url === 'string') record.url = tab.url;
  if (Number.isInteger(tab.windowId)) record.window_id = tab.windowId;
  return true;
}

function unregisterTab(tabId) {
  registry.user_tabs.delete(tabId);
  registry.agent_tabs.delete(tabId);
}

async function initializeRegistry() {
  requireChrome();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (Number.isInteger(tab.id)) registerUserTab(tab.id);
  }
  return getRegistry();
}

function attachTabLifecycleListeners() {
  requireChrome();
  if (!chrome.tabs.onCreated || !chrome.tabs.onRemoved || !chrome.tabs.onUpdated) {
    throw new Error('Chrome tabs lifecycle events are unavailable');
  }
  chrome.tabs.onCreated.addListener((tab) => {
    if (Number.isInteger(tab.id)) registerUserTab(tab.id);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (isAgentTab(tabId)) {
      updateAgentTab({ id: tabId, url: changeInfo.url || tab?.url, windowId: tab?.windowId });
    } else if (Number.isInteger(tabId)) {
      registerUserTab(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => unregisterTab(tabId));
}

function isAgentTab(tabId) {
  return registry.agent_tabs.has(tabId);
}

function canAgentAccess(tabId, write = false) {
  if (!Number.isInteger(tabId)) return false;
  return isAgentTab(tabId);
}

function assertAgentWritable(tabId) {
  if (!isAgentTab(tabId)) {
    throw new Error(`Agent is not permitted to write user tab ${tabId}`);
  }
}

async function createAgentTab({ url, purpose, windowId } = {}) {
  requireChrome();
  if (registry.agent_tabs.size >= MAX_AGENT_TABS) {
    throw new Error(`Maximum agent tabs reached (${MAX_AGENT_TABS})`);
  }
  const tab = await chrome.tabs.create({ url, windowId, active: false });
  registerAgentTab(tab, purpose);
  try {
    await markAgentTab(tab.id);
    return { ...registry.agent_tabs.get(tab.id) };
  } catch (error) {
    unregisterTab(tab.id);
    try {
      await chrome.tabs.remove(tab.id);
    } catch (cleanupError) {
      console.warn('tab-manager: failed to close unmarked agent tab', cleanupError);
    }
    throw new Error(`Agent tab marker failed: ${error.message}`);
  }
}

async function switchAgentTab(tabId) {
  requireChrome();
  assertAgentWritable(tabId);
  const tab = await chrome.tabs.update(tabId, { active: true });
  for (const record of registry.agent_tabs.values()) {
    record.status = record.id === tabId ? 'active' : 'idle';
  }
  return { ...registry.agent_tabs.get(tabId), url: tab.url || registry.agent_tabs.get(tabId).url };
}

async function closeAgentTab(tabId) {
  requireChrome();
  assertAgentWritable(tabId);
  await chrome.tabs.remove(tabId);
  registry.agent_tabs.delete(tabId);
  return { closed: true, tab_id: tabId };
}

function getRegistry() {
  return {
    user_tabs: [...registry.user_tabs],
    agent_tabs: [...registry.agent_tabs.values()].map((record) => ({ ...record })),
    policy: {
      agent_reads_user_tabs: false,
      agent_writes_user_tabs: false,
      inherit_session: true,
      max_agent_tabs: MAX_AGENT_TABS,
      visual_marker: { type: 'border', color: AGENT_BORDER, badge: AGENT_BADGE }
    }
  };
}

function resetRegistry() {
  registry.user_tabs.clear();
  registry.agent_tabs.clear();
}

export {
  MAX_AGENT_TABS,
  registerUserTab,
  registerAgentTab,
  updateAgentTab,
  unregisterTab,
  initializeRegistry,
  attachTabLifecycleListeners,
  isAgentTab,
  canAgentAccess,
  createAgentTab,
  switchAgentTab,
  closeAgentTab,
  getRegistry,
  resetRegistry
};