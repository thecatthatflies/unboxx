// unboxx offscreen page: copies text for the background worker when a tab has no content script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen" || message.action !== "copy") return false;
  const area = document.createElement("textarea");
  area.value = String(message.text || "");
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  sendResponse({ ok });
  return false;
});
