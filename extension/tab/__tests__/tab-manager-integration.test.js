const events = {
  created: [],
  updated: [],
  removed: []
};
const tabs = new Map();
let nextId = 300;

globalThis.chrome = {
  tabs: {
    async query() {
      return [...tabs.values()];
    },
    async create(details) {
      const tab = { id: nextId++, windowId: details.windowId || 1, url: details.url || '' };
      tabs.set(tab.id, tab);
      events.created.forEach((listener) => listener(tab));
      return tab;
    },
    async update(tabId) {
      const tab = tabs.get(tabId);
      return { ...tab, url: tab.url };
    },
    async remove(tabId) {
      tabs.delete(tabId);
      events.removed.forEach((listener) => listener(tabId));
    },
    onCreated: { addListener(listener) { events.created.push(listener); } },
    onUpdated: { addListener(listener) { events.updated.push(listener); } },
    onRemoved: { addListener(listener) { events.removed.push(listener); } }
  },
  action: {
    async setBadgeText() {},
    async setBadgeBackgroundColor() {}
  },
  scripting: {
    async executeScript() {}
  }
};

const manager = await import('../tab-manager.js');
manager.resetRegistry();
manager.attachTabLifecycleListeners();

tabs.set(101, { id: 101, windowId: 1, url: 'https://user.invalid' });
await manager.initializeRegistry();
if (!manager.getRegistry().user_tabs.includes(101)) throw new Error('initial user tab missing');

const created = await manager.createAgentTab({ url: 'https://agent.invalid', purpose: 'search' });
if (!manager.isAgentTab(created.id)) throw new Error('created tab not registered as agent');
if (manager.getRegistry().user_tabs.includes(created.id)) {
  throw new Error('agent tab leaked into user registry');
}
await manager.switchAgentTab(created.id);
await manager.closeAgentTab(created.id);
if (manager.isAgentTab(created.id)) throw new Error('closed agent tab remains registered');

events.created.forEach((listener) => listener({ id: 102, windowId: 1, url: 'https://new-user.invalid' }));
if (!manager.getRegistry().user_tabs.includes(102)) throw new Error('created user tab missing');

chrome.scripting.executeScript = async () => {
  throw new Error('synthetic marker failure');
};
let markerFailed = false;
try {
  await manager.createAgentTab({ url: 'https://unmarked.invalid' });
} catch {
  markerFailed = true;
}
if (!markerFailed) throw new Error('marker failure was not surfaced');
if (manager.getRegistry().agent_tabs.some((tab) => tab.url === 'https://unmarked.invalid')) {
  throw new Error('unmarked tab remained registered');
}

console.log('Tab manager integration tests passed');
