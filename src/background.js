/*
 * Critter Cam — service worker.
 *
 * Nothing about the filter runs here; the worker only handles first-run setup
 * and opens the preview page when the extension is installed or updated.
 */

const STORAGE_KEY = 'settings';
const PREVIEW_PAGE = 'src/preview/preview.html';

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: {} });
  }
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL(PREVIEW_PAGE) });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'crittercam:openPreview') {
    chrome.tabs.create({ url: chrome.runtime.getURL(PREVIEW_PAGE) });
    sendResponse({ ok: true });
  }
  return false;
});
