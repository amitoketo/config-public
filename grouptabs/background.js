// Background script for Edge extension (background.js)

import { parse } from 'https://cdn.jsdelivr.net/npm/tldts@6.1.0/dist/index.esm.min.js';

let customGroupings = {};
let cachedTabs = [];
let groupAcrossWindows = false; // Default: keep windows separate

// Load settings from storage
chrome.storage.local.get(['customGroupings', 'groupAcrossWindows'], (result) => {
  customGroupings = result.customGroupings || {};
  groupAcrossWindows = result.groupAcrossWindows || false;
  console.log("Custom Groupings:", customGroupings);
  console.log("Group across windows:", groupAcrossWindows);
});

// Extract only the domain name (without TLD)
function extractDomain(url) {
  if (!url) return "Other";
  const parsed = parse(url);
  return parsed.domainWithoutSuffix || parsed.domain || url.hostname || "";
}

// Ungroup all tabs and wait for completion
function ungroupAllTabs(windowId, callback) {
  const query = groupAcrossWindows ? {} : { windowId };
  
  chrome.tabs.query(query, (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.error("No tabs found to ungroup.");
      if (callback) callback();
      return;
    }
    
    const tabIds = tabs.map(tab => tab.id);
    cachedTabs = tabs.filter(tab => tab.url);
    chrome.tabs.ungroup(tabIds, () => {
      console.log("Tabs ungrouped.");
      if (callback) callback();
    });
  });
}

// Reorder tabs before grouping
function reorderTabs(callback) {
  if (!cachedTabs || cachedTabs.length === 0) {
    console.error("No cached tabs available for reordering.");
    if (callback) callback();
    return;
  }

  const sortedTabs = [...cachedTabs].sort((a, b) => {
    const domainA = extractDomain(a.url);
    const domainB = extractDomain(b.url);
    if (!domainA || !domainB) return 0;
    return domainA.localeCompare(domainB);
  });
  
  const tabIds = sortedTabs.map(tab => tab.id);
  chrome.tabs.move(tabIds, { index: -1 }, () => {
    console.log("Tabs reordered.");
    cachedTabs = sortedTabs;
    if (callback) callback();
  });
}

// Categorize tabs based on extracted domain
function categorizeTabs() {
  if (!cachedTabs || cachedTabs.length === 0) {
    console.error("No cached tabs available for categorization.");
    return {};
  }

  const groups = {};

  cachedTabs.forEach((tab) => {
    if (!tab.url) return;
    const domain = extractDomain(tab.url);
    const groupName = customGroupings[domain] || domain;

    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(tab);
  });

  return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
}

chrome.tabGroups.onUpdated.addListener((group) => {
  if (!group || !group.id) return;
  
  chrome.tabs.query({ groupId: group.id }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    
    tabs.forEach((tab) => {
      if (!tab.url) return;
      const domain = extractDomain(tab.url);
      if (!domain) return;
      
      if (customGroupings[domain] !== group.title) {
        console.log(`Updating group: ${domain} -> ${group.title}`);
        customGroupings[domain] = group.title;
        chrome.storage.local.set({ customGroupings }, () => {
          console.log(`Saved updated grouping for ${domain}: ${group.title}`);
        });
      }
    });
  });
});

// Create all tab groups sequentially
function createAllEdgeTabGroups() {
  const groupedTabs = categorizeTabs();
  const groupNames = Object.keys(groupedTabs);
  if (groupNames.length === 0) return;

  let index = 0;

  function createNextGroup() {
    if (index >= groupNames.length) return;

    const groupName = groupNames[index];
    const tabs = groupedTabs[groupName];
    index++;

    if (!tabs || tabs.length === 0) {
      createNextGroup();
      return;
    }

    chrome.tabs.group({ tabIds: tabs.map(tab => tab.id) }, (groupId) => {
      if (chrome.runtime.lastError || !groupId) {
        console.error("Failed to create group.", chrome.runtime.lastError);
        createNextGroup();
        return;
      }
      chrome.tabGroups.update(groupId, { title: groupName }, () => {
        createNextGroup();
      });
    });
  }

  createNextGroup();
}

// Group tabs - uses current window by default
function groupTabs(tab) {
  const windowId = tab?.windowId;
  
  ungroupAllTabs(windowId, () => {
    reorderTabs(() => {
      createAllEdgeTabGroups();
    });
  });
}

// Toggle the groupAcrossWindows setting
function toggleGroupAcrossWindows() {
  groupAcrossWindows = !groupAcrossWindows;
  chrome.storage.local.set({ groupAcrossWindows }, () => {
    console.log("Group across windows:", groupAcrossWindows);
  });
}

// Left-click: group tabs, Right-click (context menu): toggle setting
chrome.action.onClicked.addListener(groupTabs);

// Create context menu for toggling the setting
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "toggleGroupAcrossWindows",
    title: "Group tabs across all windows",
    type: "checkbox",
    checked: groupAcrossWindows,
    contexts: ["action"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "toggleGroupAcrossWindows") {
    groupAcrossWindows = info.checked;
    chrome.storage.local.set({ groupAcrossWindows }, () => {
      console.log("Group across windows:", groupAcrossWindows);
    });
  }
});