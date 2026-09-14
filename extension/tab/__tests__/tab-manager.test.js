import {
  MAX_AGENT_TABS,
  registerUserTab,
  registerAgentTab,
  isAgentTab,
  canAgentAccess,
  getRegistry,
  resetRegistry
} from '../tab-manager.js';

resetRegistry();
registerUserTab(101);
registerUserTab(102);
registerAgentTab({ id: 201, windowId: 1, url: 'https://example.invalid' }, 'search');

if (!isAgentTab(201)) throw new Error('agent tab was not registered');
if (isAgentTab(101)) throw new Error('user tab was registered as agent tab');
if (!canAgentAccess(201, true)) throw new Error('agent tab should be writable');
if (canAgentAccess(101, true)) throw new Error('user tab must be read-only');
if (canAgentAccess(101, false)) throw new Error('user tab must be inaccessible');

const registry = getRegistry();
if (registry.user_tabs.length !== 2) throw new Error('user tab registry mismatch');
if (registry.agent_tabs[0].badge !== '🤖') throw new Error('agent badge missing');
if (registry.policy.max_agent_tabs !== MAX_AGENT_TABS) throw new Error('tab limit missing');
if (registry.policy.visual_marker.color !== '#00ff88') throw new Error('visual marker policy missing');

console.log('Tab manager unit tests passed');
