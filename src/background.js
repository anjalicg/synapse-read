chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set side panel behavior:', error));

// Right-click browser context menus: Save Content & Save Link Only
function registerAfterwordContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'afterword-save-content',
      title: 'Save Content to Afterword',
      contexts: ['page', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'afterword-save-link',
      title: 'Save Link to Afterword',
      contexts: ['link'],
    });
  });
}

chrome.runtime.onInstalled.addListener(registerAfterwordContextMenus);
chrome.runtime.onStartup?.addListener(registerAfterwordContextMenus);

async function enqueuePendingSave(payload) {
  const { ['afterword:pendingSaves']: existing = [] } = await chrome.storage.local.get('afterword:pendingSaves');
  existing.push({ ...payload, queuedAt: Date.now() });
  await chrome.storage.local.set({ 'afterword:pendingSaves': existing });
  chrome.runtime.sendMessage({ type: 'AFTERWORD_PENDING_SAVES' }).catch(() => {});
}

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (tab?.windowId && chrome.sidePanel?.open) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  if (info.menuItemId === 'afterword-save-link' && info.linkUrl) {
    await enqueuePendingSave({
      mode: 'link',
      url: info.linkUrl,
      title: (info.selectionText || '').trim() || info.linkUrl,
      content: '',
    });
    return;
  }

  if (info.menuItemId === 'afterword-save-content' && tab?.id) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selectedText) => ({
          url: window.location.href,
          title: document.title || window.location.href,
          content: (selectedText || document.body?.innerText || '').trim(),
        }),
        args: [info.selectionText || ''],
      });
      if (result?.url) {
        await enqueuePendingSave({ mode: 'content', ...result });
      }
    } catch (err) {
      await enqueuePendingSave({
        mode: 'link',
        url: info.pageUrl || tab.url,
        title: tab.title || info.pageUrl || tab.url,
        content: (info.selectionText || '').trim(),
      });
    }
  }
});

// Auto-register on worker boot
registerAfterwordContextMenus();
