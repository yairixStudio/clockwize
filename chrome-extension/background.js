// Open side panel when clicking the extension icon
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set side panel behavior - open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Tab monitoring - notify sidepanel of URL changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      chrome.runtime.sendMessage({ type: 'TAB_URL_CHANGED', url: tab.url }).catch(() => {});
    }
  } catch (e) {
    // Tab might not exist
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only fire for active tab on URL change or load complete
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id === tabId && tab.url) {
      chrome.runtime.sendMessage({ type: 'TAB_URL_CHANGED', url: tab.url }).catch(() => {});
    }
  } catch (e) {
    // Ignore errors when sidepanel is closed
  }
});
