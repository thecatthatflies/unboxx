document.addEventListener("DOMContentLoaded", () => {
  console.log("[unboxx popup] Opened");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;

    const domain = new URL(tab.url).hostname;
    console.log("[unboxx popup] Domain:", domain);

    // Check if site is disabled
    chrome.storage.sync.get([`disabled_${domain}`], (result) => {
      const isDisabled = result[`disabled_${domain}`] || false;
      console.log("[unboxx popup] Is disabled:", isDisabled);

      const statusEl = document.getElementById("status");
      const disableBtn = document.getElementById("disable-btn");

      if (isDisabled) {
        statusEl.textContent = "Disabled";
        disableBtn.innerHTML = '<i class="ph-duotone ph-toggle-right"></i> Enable on this site';
        disableBtn.classList.add("enabled");
      } else {
        statusEl.textContent = "Active";
        disableBtn.innerHTML = '<i class="ph-duotone ph-toggle-left"></i> Disable on this site';
        disableBtn.classList.remove("enabled");
      }

      // Toggle button
      disableBtn.onclick = () => {
        if (isDisabled) {
          // Re-enable
          chrome.storage.sync.remove([`disabled_${domain}`], () => {
            console.log("[unboxx popup] Enabled");
            statusEl.textContent = "Active";
            disableBtn.innerHTML = '<i class="ph-duotone ph-toggle-left"></i> Disable on this site';
            disableBtn.classList.remove("enabled");

            // Reload page to apply changes
            chrome.tabs.reload(tab.id);
            window.close();
          });
        } else {
          // Disable
          chrome.storage.sync.set({ [`disabled_${domain}`]: true }, () => {
            console.log("[unboxx popup] Disabled");
            statusEl.textContent = "Disabled";
            disableBtn.innerHTML = '<i class="ph-duotone ph-toggle-right"></i> Enable on this site';
            disableBtn.classList.add("enabled");

            // Reload page to apply changes
            chrome.tabs.reload(tab.id);
            window.close();
          });
        }
      };
    });

    // Get stats from content script
    chrome.tabs.sendMessage(
      tab.id,
      { action: "getStats" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.log("[unboxx popup] Content script not available");
          document.getElementById("link-count").textContent = "0";
          document.getElementById("tracking-count").textContent = "0";
          return;
        }

        console.log("[unboxx popup] Got stats:", response);
        document.getElementById("link-count").textContent = response.linkCount || "0";
        document.getElementById("tracking-count").textContent = response.trackingCount || "0";
      }
    );
  });
});
