// unboxx preview card: styles, markup and image painting.
// Shared by the in-page overlay (inside a shadow root) and the popup.
(() => {
  const { icon } = globalThis.UnboxxIcons;

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const LIGHT_TOKENS = `
    --ubx-bg: #f4f5f1;
    --ubx-bg-raised: #fafbf8;
    --ubx-bg-sunk: #e8eae4;
    --ubx-bg-hover: #e3e6de;
    --ubx-line: rgba(38, 48, 30, 0.1);
    --ubx-line-strong: rgba(38, 48, 30, 0.2);
    --ubx-text: #1d2219;
    --ubx-text-2: #4d5647;
    --ubx-text-3: #656e5e;
    --ubx-accent: #4a5f3c;
    --ubx-accent-hover: #3d5031;
    --ubx-accent-ink: #f4f5f1;
    --ubx-accent-soft: rgba(74, 95, 60, 0.12);
    --ubx-warn: #8a4f0c;
    --ubx-warn-soft: rgba(176, 110, 20, 0.13);
    --ubx-danger: #a8231b;
    --ubx-danger-soft: rgba(179, 38, 30, 0.1);
    --ubx-danger-line: rgba(179, 38, 30, 0.28);
    --ubx-mark-tile: #4a5f3c;
    --ubx-mark-cup: #f4f5f1;
    --ubx-mark-dot: #b8caa6;
    --ubx-shadow: 0 1px 0 rgba(255, 255, 255, 0.75) inset, 0 18px 40px -12px rgba(40, 52, 30, 0.28), 0 3px 8px -2px rgba(40, 52, 30, 0.1);
    --ubx-toast-bg: #1d2219;
    --ubx-toast-ink: #eef0ea;
    color-scheme: light;
  `;

  const DARK_TOKENS = `
    --ubx-bg: #1b1e19;
    --ubx-bg-raised: #222620;
    --ubx-bg-sunk: #131512;
    --ubx-bg-hover: #2a2f27;
    --ubx-line: rgba(220, 232, 208, 0.09);
    --ubx-line-strong: rgba(220, 232, 208, 0.18);
    --ubx-text: #e8ebe3;
    --ubx-text-2: #b5bcad;
    --ubx-text-3: #929a89;
    --ubx-accent: #a9c093;
    --ubx-accent-hover: #bccfa8;
    --ubx-accent-ink: #141711;
    --ubx-accent-soft: rgba(169, 192, 147, 0.14);
    --ubx-warn: #e6b062;
    --ubx-warn-soft: rgba(230, 176, 98, 0.13);
    --ubx-danger: #f29286;
    --ubx-danger-soft: rgba(242, 146, 134, 0.12);
    --ubx-danger-line: rgba(242, 146, 134, 0.3);
    --ubx-mark-tile: #a9c093;
    --ubx-mark-cup: #141711;
    --ubx-mark-dot: #4a5f3c;
    --ubx-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 22px 48px -12px rgba(0, 0, 0, 0.6), 0 3px 10px -2px rgba(0, 0, 0, 0.35);
    --ubx-toast-bg: #e8ebe3;
    --ubx-toast-ink: #1b1e19;
    color-scheme: dark;
  `;

  // Radius system: card 16, inner panels 10, buttons and chips 8 / 6.
  const CSS = `
    .ubx-root {
      ${LIGHT_TOKENS}
      --ubx-font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      --ubx-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
      --ubx-ease: cubic-bezier(0.16, 1, 0.3, 1);
    }
    .ubx-root[data-theme="dark"] { ${DARK_TOKENS} }
    @media (prefers-color-scheme: dark) {
      .ubx-root[data-theme="auto"] { ${DARK_TOKENS} }
    }

    .ubx-root, .ubx-root * { box-sizing: border-box; }
    .ubx-icon { display: block; flex: none; }

    .ubx-card {
      position: relative;
      width: 368px;
      max-width: calc(100vw - 24px);
      max-height: calc(100vh - 24px);
      overflow: visible;
      background: var(--ubx-bg);
      color: var(--ubx-text);
      border: 1px solid var(--ubx-line);
      border-radius: 16px;
      box-shadow: var(--ubx-shadow);
      font: 400 13px/1.45 var(--ubx-font);
      letter-spacing: -0.003em;
      -webkit-font-smoothing: antialiased;
      text-align: left;
      transform-origin: var(--ubx-arrow-x, 50%) 0;
    }
    .ubx-card[data-side="top"] { transform-origin: var(--ubx-arrow-x, 50%) 100%; }
    .ubx-card[data-context="popup"] { width: 100%; max-width: none; max-height: none; box-shadow: none; }
    .ubx-scroll { max-height: calc(100vh - 26px); overflow-y: auto; overscroll-behavior: contain; border-radius: inherit; scrollbar-width: thin; }
    .ubx-card[data-context="popup"] .ubx-scroll { max-height: none; overflow: visible; }

    .ubx-arrow {
      position: absolute;
      top: -7px;
      left: calc(var(--ubx-arrow-x, 50%) - 7px);
      width: 14px;
      height: 14px;
      background: var(--ubx-bg);
      border-left: 1px solid var(--ubx-line);
      border-top: 1px solid var(--ubx-line);
      border-top-left-radius: 3px;
      transform: rotate(45deg);
      pointer-events: none;
    }
    .ubx-card[data-side="top"] .ubx-arrow { top: auto; bottom: -7px; transform: rotate(225deg); }
    .ubx-card[data-context="popup"] .ubx-arrow,
    .ubx-card[data-moved="true"] .ubx-arrow,
    .ubx-card[data-detached="true"] .ubx-arrow { display: none; }

    .ubx-enter { animation: ubx-in 260ms var(--ubx-ease) both; }
    .ubx-leave { animation: ubx-out 140ms ease-in both; pointer-events: none; }
    @keyframes ubx-in { from { opacity: 0; transform: translateY(var(--ubx-dy, 6px)) scale(0.97); } to { opacity: 1; transform: none; } }
    @keyframes ubx-out { from { opacity: 1; } to { opacity: 0; transform: translateY(calc(var(--ubx-dy, 6px) * 0.5)) scale(0.985); } }

    /* Header */
    .ubx-head { display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 14px; min-height: 46px; user-select: none; }
    .ubx-card[data-context="page"] .ubx-head { cursor: grab; }
    .ubx-card[data-dragging="true"] .ubx-head { cursor: grabbing; }
    .ubx-mark { width: 18px; height: 18px; flex: none; display: block; }
    .ubx-mark-tile { fill: var(--ubx-mark-tile); }
    .ubx-mark-cup { fill: none; stroke: var(--ubx-mark-cup); stroke-linecap: round; }
    .ubx-mark-dot { fill: var(--ubx-mark-dot); }
    .ubx-word { font-size: 14.5px; font-weight: 500; letter-spacing: -0.015em; color: var(--ubx-text); }
    .ubx-head-tools { margin-left: auto; display: flex; align-items: center; gap: 2px; }

    .ubx-status {
      display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; margin-right: 4px;
      border-radius: 6px; font-size: 11.5px; font-weight: 500; white-space: nowrap;
      color: var(--ubx-accent); background: var(--ubx-accent-soft);
    }
    .ubx-status[data-tone="warn"] { color: var(--ubx-warn); background: var(--ubx-warn-soft); }
    .ubx-status[data-tone="danger"] { color: var(--ubx-danger); background: var(--ubx-danger-soft); }

    .ubx-iconbtn {
      all: unset; box-sizing: border-box; width: 28px; height: 28px; border-radius: 8px;
      display: grid; place-items: center; cursor: pointer; color: var(--ubx-text-3);
      transition: background-color 150ms, color 150ms, transform 120ms var(--ubx-ease);
    }
    .ubx-iconbtn:hover { background: var(--ubx-bg-hover); color: var(--ubx-text); }
    .ubx-iconbtn:active { transform: scale(0.94); }
    .ubx-iconbtn[aria-pressed="true"] { color: var(--ubx-accent); background: var(--ubx-accent-soft); }
    .ubx-iconbtn:focus-visible, .ubx-btn:focus-visible, .ubx-dest:focus-visible, .ubx-textlink:focus-visible {
      outline: 2px solid var(--ubx-accent); outline-offset: 1px;
    }

    /* Preview */
    .ubx-preview {
      position: relative; margin: 0 7px; aspect-ratio: 1.91 / 1; border-radius: 10px; overflow: hidden;
      background: var(--ubx-bg-sunk); box-shadow: inset 0 0 0 1px var(--ubx-line); isolation: isolate;
    }
    .ubx-shot { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; transition: opacity 320ms var(--ubx-ease); z-index: 1; }
    .ubx-shot.is-painted { opacity: 1; }
    .ubx-live { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
    .ubx-live iframe { display: block; width: 100%; height: 100%; border: 0; opacity: 0; transition: opacity 300ms var(--ubx-ease); background: transparent; }
    .ubx-live iframe.is-loaded { opacity: 1; }
    .ubx-preview::after { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px var(--ubx-line); z-index: 2; pointer-events: none; }
    .ubx-preview[data-danger="true"] .ubx-shot,
    .ubx-preview[data-danger="true"] .ubx-fallback { filter: blur(14px) saturate(0.4); transform: scale(1.08); }
    .ubx-danger-veil {
      position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; align-content: center; gap: 6px;
      color: var(--ubx-danger); font-size: 12.5px; font-weight: 600; text-align: center;
      background: color-mix(in srgb, var(--ubx-bg) 55%, transparent);
    }

    .ubx-fallback {
      position: absolute; inset: 0; padding: 16px 18px; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px;
      background:
        radial-gradient(120% 100% at 100% 0%, var(--ubx-accent-soft), transparent 62%),
        linear-gradient(180deg, var(--ubx-bg-raised), var(--ubx-bg-sunk));
    }
    .ubx-fb-site { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ubx-text-3); min-width: 0; }
    .ubx-fb-site span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ubx-fb-title {
      font-size: 18px; font-weight: 600; letter-spacing: -0.022em; line-height: 1.22; color: var(--ubx-text);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-wrap: balance;
    }
    .ubx-fb-desc { font-size: 12.5px; color: var(--ubx-text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ubx-fb-file { font-size: 28px; font-weight: 600; letter-spacing: -0.03em; color: var(--ubx-text); }

    .ubx-fav { width: 16px; height: 16px; border-radius: 4px; flex: none; display: block; }
    .ubx-monogram {
      width: 18px; height: 18px; border-radius: 5px; flex: none; display: grid; place-items: center;
      background: var(--ubx-accent); color: var(--ubx-accent-ink); font-size: 10.5px; font-weight: 650; text-transform: uppercase; line-height: 1;
    }
    .ubx-favslot { position: relative; width: 18px; height: 18px; flex: none; display: grid; place-items: center; }
    .ubx-favslot .ubx-fav { position: absolute; inset: 1px; opacity: 0; transition: opacity 200ms; }
    .ubx-favslot .ubx-fav.is-painted { opacity: 1; }
    .ubx-favslot .ubx-fav.is-painted + .ubx-monogram { opacity: 0; }

    /* Destination */
    .ubx-dest {
      display: flex; align-items: center; gap: 10px; margin: 6px 6px 0; padding: 8px 8px 8px 9px; border-radius: 10px;
      text-decoration: none; color: inherit; cursor: pointer; transition: background-color 150ms;
    }
    .ubx-dest:hover { background: var(--ubx-bg-hover); }
    .ubx-dest:hover .ubx-open { color: var(--ubx-accent); transform: translate(1px, -1px); }
    .ubx-dest-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .ubx-dest-line { display: flex; align-items: baseline; min-width: 0; white-space: nowrap; }
    .ubx-host { font-size: 16px; font-weight: 500; letter-spacing: -0.018em; color: var(--ubx-text); flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    .ubx-path { font-size: 13px; color: var(--ubx-text-3); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .ubx-title { font-size: 12.5px; color: var(--ubx-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ubx-open { color: var(--ubx-text-2); transition: transform 200ms var(--ubx-ease), color 150ms; }
    .ubx-dest[data-tone="danger"] .ubx-host { color: var(--ubx-danger); }

    /* Signals */
    .ubx-chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 4px 15px 0; }
    .ubx-chip {
      display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 7px; border-radius: 6px;
      font-size: 11.5px; font-weight: 500; color: var(--ubx-text-3); background: var(--ubx-bg-sunk); white-space: nowrap;
    }
    .ubx-chip[title], .ubx-status[title] { cursor: help; }
    .ubx-chip[data-tone="warn"] { color: var(--ubx-warn); background: var(--ubx-warn-soft); }
    .ubx-chip[data-tone="danger"] { color: var(--ubx-danger); background: var(--ubx-danger-soft); }
    .ubx-chip[data-tone="accent"] { color: var(--ubx-accent); background: var(--ubx-accent-soft); }

    .ubx-alert {
      display: flex; gap: 10px; margin: 10px 7px 0; padding: 10px 12px; border-radius: 10px;
      font-size: 12.5px; line-height: 1.45; color: var(--ubx-warn); background: var(--ubx-warn-soft);
    }
    .ubx-alert[data-tone="danger"] { color: var(--ubx-danger); background: var(--ubx-danger-soft); }
    .ubx-alert[title] { cursor: help; }
    .ubx-alert .ubx-icon { margin-top: 1px; }
    .ubx-alert-body { display: grid; gap: 2px; min-width: 0; }
    .ubx-alert-row { display: flex; gap: 8px; min-width: 0; }
    .ubx-alert-label { flex: none; min-width: 64px; opacity: 0.8; }
    .ubx-alert-row strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Skeleton */
    .ubx-skel {
      background: linear-gradient(90deg, var(--ubx-bg-sunk) 0%, var(--ubx-bg-hover) 45%, var(--ubx-bg-sunk) 90%);
      background-size: 220% 100%; animation: ubx-shimmer 1.3s ease-in-out infinite;
    }
    .ubx-preview.ubx-skel { box-shadow: none; }
    .ubx-skel-line { display: block; width: 62%; height: 10px; border-radius: 4px; margin-top: 6px; }
    @keyframes ubx-shimmer { from { background-position: 100% 0; } to { background-position: -120% 0; } }

    /* Error */
    .ubx-empty {
      position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 6px; padding: 16px;
      text-align: center; color: var(--ubx-text-2); font-size: 12.5px;
    }
    .ubx-empty strong { color: var(--ubx-text); font-size: 13.5px; font-weight: 600; }
    .ubx-empty .ubx-icon { color: var(--ubx-text-3); margin-bottom: 2px; }

    /* Special links */
    .ubx-special { display: flex; align-items: center; gap: 14px; margin: 0 7px; padding: 16px 14px; border-radius: 10px; background: var(--ubx-bg-sunk); }
    .ubx-special-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; flex: none; background: var(--ubx-accent-soft); color: var(--ubx-accent); }
    .ubx-special-text { min-width: 0; display: grid; gap: 2px; }
    .ubx-special-label { font-size: 11.5px; color: var(--ubx-text-3); }
    .ubx-special-value { font-size: 15px; font-weight: 500; letter-spacing: -0.012em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ubx-special-sub { font-size: 12px; color: var(--ubx-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Details */
    .ubx-details { display: grid; gap: 14px; margin: 10px 7px 0; padding: 12px; border-radius: 10px; background: var(--ubx-bg-sunk); }
    .ubx-details[hidden] { display: none; }
    .ubx-details:not([hidden]) { animation: ubx-reveal 220ms var(--ubx-ease) both; }
    @keyframes ubx-reveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    .ubx-dl-label { font-size: 11.5px; font-weight: 600; color: var(--ubx-text-2); margin-bottom: 6px; }
    .ubx-url {
      font: 11.5px/1.55 var(--ubx-mono); color: var(--ubx-text); word-break: break-all;
      max-height: 92px; overflow-y: auto; user-select: text; scrollbar-width: thin;
    }
    .ubx-params { display: flex; flex-wrap: wrap; gap: 4px; }
    .ubx-param {
      font: 11px/1.4 var(--ubx-mono); padding: 2px 6px; border-radius: 5px; color: var(--ubx-warn); background: var(--ubx-warn-soft);
      text-decoration: line-through; text-decoration-thickness: 1px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ubx-hops { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
    .ubx-hop { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 3px 0; min-width: 0; }
    .ubx-hop-dot { width: 7px; height: 7px; margin-top: 6px; border-radius: 50%; flex: none; background: var(--ubx-line-strong); position: relative; }
    .ubx-hop:not(:last-child) .ubx-hop-dot::after { content: ""; position: absolute; left: 3px; top: 9px; width: 1px; height: 18px; background: var(--ubx-line-strong); }
    .ubx-hop:last-child .ubx-hop-dot { background: var(--ubx-accent); }
    .ubx-hop-text { min-width: 0; font-size: 12px; color: var(--ubx-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ubx-hop-text b { font-weight: 600; color: var(--ubx-text); }
    .ubx-hop:last-child .ubx-hop-text { color: var(--ubx-text); }
    .ubx-kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; }
    .ubx-kv dt { color: var(--ubx-text-3); }
    .ubx-kv dd { margin: 0; color: var(--ubx-text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ubx-links { display: flex; flex-wrap: wrap; gap: 14px; }
    .ubx-textlink {
      all: unset; cursor: pointer; font-size: 12px; font-weight: 500; color: var(--ubx-accent);
      display: inline-flex; align-items: center; gap: 5px; border-radius: 4px;
    }
    .ubx-textlink:hover { color: var(--ubx-accent-hover); text-decoration: underline; text-underline-offset: 2px; }
    .ubx-kbd {
      font: 500 10.5px/1 var(--ubx-mono); min-width: 18px; height: 18px; padding: 0 5px; border-radius: 5px;
      display: inline-grid; place-items: center; white-space: nowrap; color: var(--ubx-text-2); background: var(--ubx-bg);
      box-shadow: inset 0 -1px 0 var(--ubx-line-strong), 0 0 0 1px var(--ubx-line);
    }

    /* Actions */
    .ubx-actions { display: flex; align-items: center; gap: 2px; margin-top: 10px; padding: 6px 6px 7px; border-top: 1px solid var(--ubx-line); }
    .ubx-btn {
      all: unset; box-sizing: border-box; height: 30px; padding: 0 9px; border-radius: 8px;
      display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap;
      font: 500 12.5px/1 var(--ubx-font); color: var(--ubx-text-2);
      transition: background-color 150ms, color 150ms, transform 120ms var(--ubx-ease);
    }
    .ubx-btn:hover { background: var(--ubx-bg-hover); color: var(--ubx-text); }
    .ubx-btn:active { transform: scale(0.97); }
    .ubx-btn[data-tone="accent"] { color: var(--ubx-accent); }
    .ubx-btn[data-tone="danger"] { color: var(--ubx-danger); }
    .ubx-btn.is-done { color: var(--ubx-accent); }
    .ubx-btn.is-armed { background: var(--ubx-danger-soft); color: var(--ubx-danger); }
    .ubx-actions .ubx-spacer { flex: 1; }
    .ubx-actions .ubx-iconbtn[aria-expanded="true"] svg { transform: rotate(180deg); }
    .ubx-actions .ubx-iconbtn svg { transition: transform 220ms var(--ubx-ease); }

    /* Toast */
    .ubx-toast {
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
      display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px 0 12px; border-radius: 10px;
      background: var(--ubx-toast-bg); color: var(--ubx-toast-ink); font: 500 13px/1 var(--ubx-font);
      box-shadow: 0 12px 30px -8px rgba(20, 26, 16, 0.4); pointer-events: none; white-space: nowrap;
      animation: ubx-toast 2400ms var(--ubx-ease) both;
    }
    .ubx-toast .ubx-mark { width: 14px; height: 14px; }
    @keyframes ubx-toast {
      0% { opacity: 0; transform: translate(-50%, 10px) scale(0.98); }
      10%, 85% { opacity: 1; transform: translate(-50%, 0) scale(1); }
      100% { opacity: 0; transform: translate(-50%, 4px) scale(0.99); }
    }

    @media (prefers-reduced-motion: reduce) {
      .ubx-enter, .ubx-leave, .ubx-skel, .ubx-toast, .ubx-details { animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
      .ubx-shot, .ubx-open, .ubx-iconbtn, .ubx-btn { transition: none !important; }
    }
  `;

  // The unboxx logo: an open "u" box with the dot it revealed. Source of truth is icons/logo.svg;
  // this copy uses the 16px-tuned geometry and theme tokens so it reads at UI sizes in both themes.
  const MARK = `<svg class="ubx-mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><rect class="ubx-mark-tile" width="100" height="100" rx="24"/><path class="ubx-mark-cup" d="M28.5 47v9.5a21.5 21.5 0 0 0 43 0V47" stroke-width="15"/><circle class="ubx-mark-dot" cx="50" cy="22.5" r="10"/></svg>`;

  const THREAT_LABELS = {
    MALWARE: "Malware",
    SOCIAL_ENGINEERING: "Phishing",
    UNWANTED_SOFTWARE: "Unwanted software",
    POTENTIALLY_HARMFUL_APPLICATION: "Harmful app",
  };

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!n || n < 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  }

  function timeAgo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d} d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function trackerCount(m) {
    return (m.removed || []).filter((p) => p.name !== "path").length + ((m.removed || []).some((p) => p.name === "path") ? 1 : 0);
  }

  function hopCount(m) {
    const chain = m.chain && m.chain.length ? m.chain.length - 1 : 0;
    return chain + (m.unwrapped ? m.unwrapped.length : 0);
  }

  // One status at most, and only when something is wrong. A clean link shows nothing.
  function statusFor(m) {
    if (m.loading) return null;
    if (m.safety && m.safety.status === "unsafe") return { tone: "danger", label: "Dangerous", icon: "warning-octagon" };
    if (m.mismatch || (m.flags && (m.flags.punycode || m.flags.userinfo))) return { tone: "warn", label: "Suspicious", icon: "warning" };
    const trackers = trackerCount(m);
    if (trackers) {
      return {
        tone: "warn",
        label: trackers === 1 ? "1 tracker" : `${trackers} trackers`,
        icon: "eye-slash",
        hint: "Tracking parameters are removed when you copy or open the link.",
      };
    }
    return null;
  }

  function chipsFor(m) {
    const chips = [];
    const hops = hopCount(m);
    if (hops) {
      chips.push({
        icon: "path",
        label: hops === 1 ? "1 redirect" : `${hops} redirects`,
        tone: hops >= 4 ? "warn" : "",
        hint: m.flags && m.flags.shortener ? "Short link. It passes through other addresses before the destination." : "The link passes through other addresses before the destination.",
      });
    } else if (m.flags && m.flags.shortener) {
      chips.push({ icon: "scissors", label: "Short link", hint: "Shortened address. The destination is resolved when the preview loads." });
    }
    if (m.fileType) {
      const size = formatBytes(m.contentLength);
      chips.push({
        icon: "file-arrow-down",
        label: size ? `${m.fileType.label}, ${size}` : m.fileType.label,
        tone: m.fileType.executable ? "warn" : "",
        hint: m.fileType.executable ? "Opening this link downloads a program." : "Opening this link downloads a file.",
      });
    } else if (m.contentType && !/html|xml/.test(m.contentType) && m.contentLength) {
      chips.push({ icon: "file-arrow-down", label: `${m.contentType.split(";")[0].split("/").pop().toUpperCase()}, ${formatBytes(m.contentLength)}`, hint: "Opening this link downloads a file." });
    }
    if (m.flags && m.flags.insecure) chips.push({ icon: "lock-simple-open", label: "Not encrypted", tone: "warn", hint: "The page loads over HTTP. Others on the network can read or change it." });
    if (m.flags && m.flags.ipHost) chips.push({ icon: "globe-simple", label: "IP address", tone: "warn", hint: "The address is a numeric IP instead of a domain name." });
    if (m.flags && m.flags.suspiciousTld) chips.push({ icon: "warning-diamond", label: "Unusual domain", tone: "warn", hint: "This domain ending is common in spam and phishing." });
    if (m.status >= 400) {
      const broken = m.status === 404 || m.status === 410;
      chips.push(
        broken
          ? { icon: "link-break", label: "Broken link", tone: "warn", hint: `The server says this page does not exist (${m.status}).` }
          : m.status >= 500
            ? { icon: "link-break", label: "Server error", hint: `The server failed to load the page (${m.status}).` }
            : { icon: "link-break", label: "Preview blocked", hint: `The site refused the background request (${m.status}).` }
      );
    }
    if (m.authWall) chips.push({ icon: "lock-simple", label: "Sign-in page", hint: "Without your cookies, this link redirects to a sign-in page." });
    if (m.notFetched === "action") chips.push({ icon: "shield-check", label: "Not loaded", hint: "Logout and unsubscribe links are never loaded in the background." });
    return chips;
  }

  function alertRow(label, value) {
    return `<span class="ubx-alert-row"><span class="ubx-alert-label">${esc(label)}</span><strong>${esc(value)}</strong></span>`;
  }

  function alertFor(m) {
    if (m.safety && m.safety.status === "unsafe") {
      const threats = (m.safety.threats || []).map((t) => THREAT_LABELS[t] || t).join(", ") || "Threat";
      return { tone: "danger", icon: "warning-octagon", html: alertRow("Google Safe Browsing", threats), hint: "This site is on Google's list of known malware and phishing sites." };
    }
    if (m.mismatch) {
      return { tone: "warn", icon: "warning", html: alertRow("Link text", m.mismatch.textHost) + alertRow("Goes to", m.mismatch.destHost) };
    }
    if (m.flags && m.flags.userinfo) {
      return { tone: "warn", icon: "warning", html: alertRow("Real host", m.displayHost), hint: "Everything before the @ in an address is ignored by the browser." };
    }
    if (m.flags && m.flags.punycode) {
      return { tone: "warn", icon: "warning", html: alertRow("Look-alike characters", m.displayHost), hint: "The domain uses non-Latin letters that can imitate another name." };
    }
    return null;
  }

  function favSlot(host, kind) {
    const site = globalThis.UnboxxRules ? globalThis.UnboxxRules.registrableDomain(host || "") : host;
    const letter = esc((site || host || "?").replace(/^www\./, "").charAt(0) || "?");
    return `<span class="ubx-favslot"><canvas class="ubx-fav" data-ubx-paint="${kind}" width="32" height="32" aria-hidden="true"></canvas><span class="ubx-monogram" aria-hidden="true">${letter}</span></span>`;
  }

  // The live page is loaded only for ordinary pages: never for flagged, look-alike, download,
  // logout-style or unreachable links.
  function canLive(m) {
    if (!m || m.kind !== "web" || m.loading || m.error || m.notFetched || m.fileType || m.mismatch) return false;
    if (m.safety && m.safety.status === "unsafe") return false;
    if (m.flags && (m.flags.punycode || m.flags.userinfo)) return false;
    if (m.contentType && !/html|xml/.test(m.contentType)) return false;
    return /^https?:/i.test(m.cleanUrl || m.finalUrl || "");
  }

  function liveUrl(m) {
    return m.cleanUrl || m.finalUrl || m.href;
  }

  function previewHtml(m, o) {
    const danger = m.safety && m.safety.status === "unsafe";
    if (m.loading) return `<div class="ubx-preview ubx-skel" aria-hidden="true"></div>`;

    let inner;
    if (m.error && !m.title) {
      inner = `
        <div class="ubx-empty">
          ${icon("link-break", 22)}
          <strong>${m.error === "timeout" ? "Timed out" : "Unreachable"}</strong>
        </div>`;
    } else {
      const showShot = !danger && (o.previews === "screenshot" || (o.previews !== "off" && Boolean(m.imageUrl)));
      const fallbackTitle = m.fileType && !m.title ? "" : m.title || m.displayHost;
      inner = `
        <div class="ubx-fallback">
          <div class="ubx-fb-site">${favSlot(m.displayHost, "favicon-large")}<span>${esc(m.siteName || m.displayHost)}</span></div>
          ${m.fileType && !m.title ? `<div class="ubx-fb-file">.${esc(m.fileType.ext)}</div>` : ""}
          ${fallbackTitle ? `<div class="ubx-fb-title">${esc(fallbackTitle)}</div>` : ""}
          ${m.description ? `<div class="ubx-fb-desc">${esc(m.description)}</div>` : ""}
        </div>
        ${showShot ? `<canvas class="ubx-shot" data-ubx-paint="preview" aria-hidden="true"></canvas>` : ""}
        ${o.previews === "live" && canLive(m) ? `<div class="ubx-live" data-ubx-live aria-hidden="true"></div>` : ""}`;
    }

    return `
      <figure class="ubx-preview" data-danger="${danger}" aria-label="Preview of ${esc(m.displayHost)}">
        ${inner}
        ${danger ? `<div class="ubx-danger-veil">${icon("warning-octagon", 26)}<span>Preview hidden</span></div>` : ""}
      </figure>`;
  }

  function detailsHtml(m, o) {
    const sections = [];
    const finalUrl = m.cleanUrl || m.finalUrl || m.href;
    sections.push(`
      <div>
        <div class="ubx-dl-label">Address</div>
        <div class="ubx-url">${esc(finalUrl)}</div>
      </div>`);

    const removed = (m.removed || []).filter((p) => p.name);
    if (removed.length) {
      sections.push(`
        <div>
          <div class="ubx-dl-label">Removed trackers</div>
          <div class="ubx-params">${removed
            .map((p) => `<span class="ubx-param" title="${esc(p.name)}=${esc(p.value)}">${esc(p.name === "path" ? p.value : p.value ? `${p.name}=${p.value}` : p.name)}</span>`)
            .join("")}</div>
        </div>`);
    }

    const hops = [...(m.unwrapped || []), ...(m.chain || [])].filter((url, i, arr) => url && url !== arr[i - 1]);
    if (hops.length > 1) {
      sections.push(`
        <div>
          <div class="ubx-dl-label">Redirect path</div>
          <ol class="ubx-hops">${hops
            .map((url) => {
              const p = globalThis.UnboxxRules.displayParts(url);
              return `<li class="ubx-hop"><span class="ubx-hop-dot"></span><span class="ubx-hop-text" title="${esc(url)}"><b>${esc(p.host)}</b>${esc(p.rest)}</span></li>`;
            })
            .join("")}</ol>
        </div>`);
    }

    const facts = [];
    if (m.status) facts.push(["Status", `${m.status}${m.status >= 200 && m.status < 300 ? " OK" : ""}`]);
    if (m.contentType) facts.push(["Type", m.contentType.split(";")[0]]);
    if (m.contentLength) facts.push(["Size", formatBytes(m.contentLength)]);
    const safety = m.safety || {};
    facts.push([
      "Safe Browsing",
      safety.status === "safe" ? "No threats" : safety.status === "unsafe" ? "Threat reported" : safety.status === "off" ? "Off" : "Not checked",
    ]);
    if (m.fetchedAt) facts.push(["Checked", timeAgo(m.fetchedAt)]);
    sections.push(`<dl class="ubx-kv">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd title="${esc(v)}">${esc(v)}</dd>`).join("")}</dl>`);

    sections.push(`
      <div class="ubx-links">
        ${m.cleanUrl && m.cleanUrl !== m.href ? `<button class="ubx-textlink" data-act="copy-original" title="Copy the link with its trackers (Shift C)">${icon("copy", 14)}Copy original</button>` : ""}
        <button class="ubx-textlink" data-act="wayback">${icon("clock-counter-clockwise", 14)}Wayback Machine</button>
        <button class="ubx-textlink" data-act="virustotal">${icon("bug-beetle", 14)}Scan on VirusTotal</button>
        ${o.context === "page" ? `<button class="ubx-textlink" data-act="refresh">${icon("arrow-clockwise", 14)}Check again</button>` : ""}
      </div>`);

    return `<div class="ubx-details" ${o.expanded ? "" : "hidden"}>${sections.join("")}</div>`;
  }

  function header(m, o) {
    const status = m.kind === "web" ? statusFor(m) : null;
    const pinTool =
      o.context === "page"
        ? `<button class="ubx-iconbtn" data-act="pin" aria-pressed="${Boolean(o.pinned)}" aria-label="${o.pinned ? "Unpin preview" : "Pin preview"}" title="${o.pinned ? "Unpin" : "Pin"} (P)">${icon(o.pinned ? "push-pin-slash" : "push-pin", 15)}</button>`
        : "";
    const closeTool = o.context === "page" && o.pinned ? `<button class="ubx-iconbtn" data-act="close" aria-label="Close preview" title="Close (Esc)">${icon("x", 15)}</button>` : "";
    return `
      <header class="ubx-head" data-drag-handle>
        ${MARK}
        <span class="ubx-word">unboxx</span>
        <div class="ubx-head-tools">
          ${status ? `<span class="ubx-status" data-tone="${status.tone}"${status.hint ? ` title="${esc(status.hint)}"` : ""}>${status.icon ? icon(status.icon, 13) : ""}${esc(status.label)}</span>` : ""}
          ${pinTool}${closeTool}
        </div>
      </header>`;
  }

  function renderWeb(m, o) {
    const danger = m.safety && m.safety.status === "unsafe";
    const alert = m.loading ? null : alertFor(m);
    const chips = chipsFor(m);
    const showTitle = !m.loading && m.title && m.title.toLowerCase() !== (m.displayHost || "").toLowerCase();
    const cleanDiffers = m.cleanUrl && m.cleanUrl !== m.href;

    return `
      ${header(m, o)}
      ${previewHtml(m, o)}
      <a class="ubx-dest" data-act="open" href="${esc(m.cleanUrl || m.finalUrl || m.href)}" data-tone="${danger ? "danger" : ""}" title="${danger ? "Open anyway" : "Open in new tab"} (O)">
        ${favSlot(m.displayHost, "favicon")}
        <span class="ubx-dest-text">
          <span class="ubx-dest-line"><span class="ubx-host">${esc(m.displayHost)}</span><span class="ubx-path">${esc(m.displayPath || "")}</span></span>
          ${showTitle ? `<span class="ubx-title">${esc(m.title)}</span>` : ""}
          ${m.loading ? `<span class="ubx-skel ubx-skel-line"></span>` : ""}
        </span>
        <span class="ubx-open" aria-hidden="true">${icon("arrow-square-out", 18)}</span>
      </a>
      ${chips.length ? `<div class="ubx-chips">${chips.map((c) => `<span class="ubx-chip" data-tone="${c.tone || ""}"${c.hint ? ` title="${esc(c.hint)}"` : ""}>${icon(c.icon, 13)}${esc(c.label)}</span>`).join("")}</div>` : ""}
      ${alert ? `<div class="ubx-alert" data-tone="${alert.tone}" role="alert"${alert.hint ? ` title="${esc(alert.hint)}"` : ""}>${icon(alert.icon, 16)}<span class="ubx-alert-body">${alert.html}</span></div>` : ""}
      ${detailsHtml(m, o)}
      <footer class="ubx-actions">
        <button class="ubx-btn" data-act="copy" title="${cleanDiffers ? "Copies the link without trackers or redirects. (C)" : "Copy link (C)"}">${icon("copy", 15)}<span>Copy</span></button>
        <button class="ubx-iconbtn" data-act="copy-md" aria-label="Copy as Markdown" title="Copy as Markdown (M)">${icon("markdown-logo", 16)}</button>
        ${o.context === "page" ? `<button class="ubx-iconbtn" data-act="open-bg" aria-label="Open in background tab" title="Open in background tab (B)">${icon("browsers", 16)}</button>` : ""}
        <span class="ubx-spacer"></span>
        <button class="ubx-iconbtn" data-act="details" aria-expanded="${Boolean(o.expanded)}" aria-label="Show details" title="Details (D)">${icon("caret-down", 15)}</button>
      </footer>`;
  }

  function renderSpecial(m, o) {
    const map = {
      email: { icon: "envelope-simple", label: "Email address", open: "Write email", copy: "Copy address" },
      phone: { icon: "phone", label: "Phone number", open: "Call", copy: "Copy number" },
      sms: { icon: "chat-circle-text", label: "Text message", open: "Send text", copy: "Copy number" },
      other: { icon: "link-simple", label: `${(m.scheme || "App").toUpperCase()} link`, open: "Open app", copy: "Copy link" },
    };
    const meta = map[m.kind] || map.other;
    return `
      ${header(m, o)}
      <div class="ubx-special">
        <span class="ubx-special-icon">${icon(meta.icon, 20)}</span>
        <span class="ubx-special-text">
          <span class="ubx-special-label">${esc(meta.label)}</span>
          <span class="ubx-special-value" title="${esc(m.address)}">${esc(m.address)}</span>
          ${m.subject ? `<span class="ubx-special-sub">Subject: ${esc(m.subject)}</span>` : ""}
        </span>
      </div>
      <footer class="ubx-actions">
        <button class="ubx-btn" data-act="copy-address" title="Copy (C)">${icon("copy", 15)}<span>${esc(meta.copy)}</span></button>
        <button class="ubx-btn" data-act="open-native">${icon("arrow-square-out", 15)}<span>${esc(meta.open)}</span></button>
      </footer>`;
  }

  // m: preview model, o: { context: "page" | "popup", pinned, expanded, previews, shortcuts, theme }
  function render(m, o = {}) {
    const body = m.kind === "web" ? renderWeb(m, o) : renderSpecial(m, o);
    return `
      <div class="ubx-card" role="dialog" aria-label="Link preview for ${esc(m.displayHost || m.address || "link")}"
        data-context="${o.context || "page"}" data-pinned="${Boolean(o.pinned)}" data-kind="${m.kind}">
        <span class="ubx-arrow" aria-hidden="true"></span>
        <div class="ubx-scroll">${body}</div>
      </div>`;
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // Draws image bytes onto a canvas. Canvas drawing is not subject to the host page's
  // img-src CSP, so previews render on every site.
  async function paint(canvas, image, fit = "cover", align = "center") {
    if (!canvas || !image || !image.b64) return false;
    try {
      const bitmap = await createImageBitmap(base64ToBlob(image.b64, image.mime || "image/png"));
      // clientWidth ignores the entrance transform, so the bitmap is sized for the settled card.
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * dpr));
      const h = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * dpr));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      const ratio = bitmap.width / bitmap.height;
      const targetRatio = w / h;
      ctx.clearRect(0, 0, w, h);

      // Square logos, avatars and low-res images look bad cropped to a wide frame.
      // Show them whole, over a blurred, dimmed copy of themselves.
      const framed = fit === "cover" && align !== "top" && (ratio < targetRatio * 0.7 || bitmap.width < w * 0.45);
      if (framed) {
        const cover = Math.max(w / bitmap.width, h / bitmap.height) * 1.15;
        ctx.save();
        ctx.filter = `blur(${Math.round(22 * dpr)}px) saturate(1.15)`;
        ctx.drawImage(bitmap, (w - bitmap.width * cover) / 2, (h - bitmap.height * cover) / 2, bitmap.width * cover, bitmap.height * cover);
        ctx.restore();
        ctx.fillStyle = "rgba(20, 28, 14, 0.14)";
        ctx.fillRect(0, 0, w, h);
        const inset = Math.min((h * 0.72) / bitmap.height, (w * 0.6) / bitmap.width, 2 * dpr);
        const dw = bitmap.width * inset;
        const dh = bitmap.height * inset;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;
        const r = Math.min(12 * dpr, dw / 6);
        // A light tile behind the image casts the shadow and backs transparent logos.
        ctx.save();
        ctx.shadowColor = "rgba(20, 28, 14, 0.28)";
        ctx.shadowBlur = 18 * dpr;
        ctx.shadowOffsetY = 5 * dpr;
        ctx.beginPath();
        ctx.roundRect(dx, dy, dw, dh, r);
        ctx.fillStyle = "#f7f8f4";
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(dx, dy, dw, dh, r);
        ctx.clip();
        ctx.drawImage(bitmap, dx, dy, dw, dh);
        ctx.restore();
      } else {
        const scale = fit === "cover" ? Math.max(w / bitmap.width, h / bitmap.height) : Math.min(w / bitmap.width, h / bitmap.height);
        const dw = bitmap.width * scale;
        const dh = bitmap.height * scale;
        ctx.drawImage(bitmap, (w - dw) / 2, align === "top" ? 0 : (h - dh) / 2, dw, dh);
      }
      bitmap.close();
      canvas.classList.add("is-painted");
      return true;
    } catch {
      return false;
    }
  }

  // Temporarily swaps a button's label and icon to confirm an action.
  function flash(button, label, iconName = "check") {
    if (!button) return;
    // Remember the resting state once, so a second click mid-flash can't make "Copied" permanent.
    if (button._ubxOriginal === undefined) button._ubxOriginal = button.innerHTML;
    const iconOnly = button.classList.contains("ubx-iconbtn");
    button.innerHTML = iconOnly ? icon(iconName, 16) : `${icon(iconName, 15)}<span>${esc(label)}</span>`;
    button.classList.add("is-done");
    clearTimeout(button._ubxFlash);
    button._ubxFlash = setTimeout(() => {
      button.innerHTML = button._ubxOriginal;
      button._ubxOriginal = undefined;
      button.classList.remove("is-done");
    }, 1400);
  }

  function markdown(m) {
    const title = (m.title || m.displayHost || m.href).replace(/([\[\]\\])/g, "\\$1");
    // Parentheses and spaces end a Markdown link early, and encodeURIComponent leaves ( ) alone.
    const url = (m.cleanUrl || m.finalUrl || m.href).replace(/[()\s]/g, (c) => ({ "(": "%28", ")": "%29" })[c] || encodeURIComponent(c));
    return `[${title}](${url})`;
  }

  // Card model built from instant local analysis, shown while the background fetch runs.
  function localModel(local, text = "") {
    const Rules = globalThis.UnboxxRules;
    const parts = Rules.displayParts(local.clean);
    return {
      kind: "web",
      href: local.href,
      target: local.target,
      finalUrl: local.target,
      cleanUrl: local.clean,
      displayHost: parts.host,
      displayPath: parts.rest,
      removed: local.removed,
      unwrapped: local.unwrapped,
      chain: [local.target],
      flags: local.flags,
      fileType: local.fileType,
      safety: { status: "unknown", threats: [] },
      mismatch: text ? Rules.textMismatch(text, local.target) : null,
      linkText: text,
      loading: true,
    };
  }

  function screenshotUrl(url) {
    return `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=1200&h=630`;
  }

  globalThis.UnboxxCard = { CSS, MARK, canLive, liveUrl, render, renderHeader: header, localModel, paint, flash, markdown, screenshotUrl, esc, formatBytes, timeAgo, statusFor, trackerCount };
})();
