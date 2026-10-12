// unboxx live preview: loads the destination page in a sandboxed frame at desktop width
// and scales it down to the card. The parent only learns when loading finished.
(() => {
  const VIRTUAL_WIDTH = 1280;
  const frame = document.getElementById("frame");

  let url = "";
  try {
    const raw = decodeURIComponent(location.hash.slice(1));
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") url = parsed.href;
  } catch {
    url = "";
  }

  function report(state) {
    window.parent.postMessage({ source: "unboxx-preview", state }, "*");
  }

  function fit() {
    const scale = window.innerWidth / VIRTUAL_WIDTH;
    frame.style.width = `${VIRTUAL_WIDTH}px`;
    frame.style.height = `${Math.ceil(window.innerHeight / scale)}px`;
    frame.style.transform = `scale(${scale})`;
  }

  if (!url) {
    report("error");
    return;
  }

  fit();
  window.addEventListener("resize", fit);
  frame.addEventListener("load", () => report("loaded"), { once: true });
  frame.src = url;
})();
