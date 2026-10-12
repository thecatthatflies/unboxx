// unboxx URL rules, shared by the background worker, content script, popup and options page.
// Plain script that assigns globalThis.UnboxxRules, so it works both as a content script
// and as a side-effect import from the module service worker.
(() => {
  // Parameters that only ever carry tracking data. Safe to strip on any site.
  const GLOBAL_PARAMS = new Set([
    "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "twclid", "yclid",
    "ttclid", "li_fat_id", "rdt_cid", "epik", "igshid", "mc_cid", "mc_eid", "_hsenc", "_hsmi",
    "__hssc", "__hstc", "__hsfp", "hsctatracking", "mkt_tok", "_openstat", "ga_id", "_ga", "_gl",
    "gfe_rd", "srsltid", "s_cid", "at_medium", "at_campaign", "ncid", "cmpid", "sr_share",
    "guccounter", "guce_referrer", "guce_referrer_sig", "ml_subscriber", "ml_subscriber_hash",
    "aff_id", "affiliate_id", "wickedid", "_branch_match_id", "_branch_referrer", "irclickid",
    "irgwc", "clickid", "click_id", "trackingid", "spm_id_from", "vero_conv", "vero_id",
    "oly_anon_id", "oly_enc_id", "rb_clickid", "sscid", "_kx", "ss_source", "ss_campaign_id",
  ]);

  const GLOBAL_PREFIXES = ["utm_", "hsa_", "pk_", "mtm_", "matomo_", "piwik_", "__cft__", "__tn__"];

  // Strict mode only. These are tracking most of the time but are real parameters on some sites.
  const STRICT_PARAMS = new Set([
    "ref", "ref_src", "ref_url", "referrer", "referer", "source", "src", "cmp", "campaign",
    "campaign_id", "ad_id", "adset_id", "affiliate", "partner", "share", "shared", "via",
  ]);

  // Site-specific trackers. `strict` entries apply only in strict mode.
  const SITE_RULES = [
    {
      host: /(^|\.)amazon\.(com|ca|de|fr|it|es|nl|se|pl|in|sg|ae|sa|eg|com\.au|com\.br|com\.mx|com\.tr|com\.be|co\.uk|co\.jp)$/,
      params: ["psc", "ref_", "_encoding", "content-id", "crid", "sprefix", "qid", "sr", "dib", "dib_tag", "th", "pd_rd_i", "pd_rd_r", "pd_rd_w", "pd_rd_wg", "smid", "spla", "hvadid", "hvpos", "hvnetw", "hvrand", "hvpone", "hvptwo", "hvqmt", "hvdev", "hvdvcmdl", "hvlocint", "hvlocphy", "hvtargid", "keywords"],
      prefixes: ["pd_rd_", "pf_rd_"],
      strict: ["tag", "ascsubtag", "linkcode", "linkid", "creativeasin", "camp", "creative"],
      stripPath: /\/ref=[^/?#]*/,
    },
    { host: /(^|\.)(youtube\.com|youtu\.be)$/, params: ["si", "feature", "pp", "embeds_referring_euri", "source_ve_path"] },
    { host: /(^|\.)(twitter\.com|x\.com)$/, params: ["s", "t", "ref_src", "ref_url"] },
    { host: /(^|\.)instagram\.com$/, params: ["igsh", "igshid", "img_index"] },
    { host: /(^|\.)threads\.(net|com)$/, params: ["xmt", "slof"] },
    { host: /(^|\.)tiktok\.com$/, params: ["_r", "_t", "is_from_webapp", "sender_device", "is_copy_url", "web_id", "u_code", "preview_pb", "share_app_id", "share_item_id", "share_link_id", "social_sharing", "tt_from", "checksum", "user_id", "sec_user_id"] },
    { host: /(^|\.)spotify\.com$/, params: ["si", "nd", "dl_branch"] },
    { host: /(^|\.)linkedin\.com$/, params: ["trk", "trkinfo", "trackingid", "refid", "lipi", "midtoken", "midsig", "eid", "otptoken", "lgcta", "lgtemp", "original_referer", "trkemail"] },
    { host: /(^|\.)facebook\.com$/, params: ["mibextid", "sfnsn", "rdid", "refsrc", "hc_ref", "fref", "hc_location", "ref"] },
    { host: /(^|\.)reddit\.com$/, params: ["share_id", "ref_source", "rdt", "ref_campaign", "correlation_id"] },
    { host: /(^|\.)google\.[a-z.]{2,6}$/, onPath: /^\/(search|webhp)?$/, params: ["ved", "ei", "sa", "usg", "sca_esv", "sca_upv", "sxsrf", "gs_lp", "gs_lcrp", "gs_ssp", "oq", "aqs", "sourceid", "iflsig", "uact", "bih", "biw", "dpr", "rlz", "client", "sclient", "fbs", "ictx"] },
    { host: /(^|\.)bing\.com$/, onPath: /^\/(search|images|videos|news)/, params: ["form", "sp", "ghc", "lq", "pq", "sc", "qs", "cvid", "ghsh", "ghacc", "ghpl"] },
    { host: /(^|\.)medium\.com$/, params: ["source", "sk"] },
    { host: /\.substack\.com$/, params: ["r", "triedredirect", "showwelcome", "publication_id", "post_id", "isfreemail"] },
    { host: /(^|\.)aliexpress\.[a-z.]{2,6}$/, params: ["spm", "scm", "algo_pvid", "algo_exp_id", "btsid", "ws_ab_test", "pdp_npi", "sk", "aff_platform", "aff_trace_key", "terminal_id", "afsmartredirect", "gatewayadapt", "pdp_ext_f", "_randl_currency", "_randl_shipto"] },
    { host: /(^|\.)ebay\.[a-z.]{2,6}$/, params: ["_trkparms", "_trksid", "hash", "amdata", "mkcid", "mkevt", "mkrid", "campid", "toolid", "customid", "_from", "itmmeta"] },
    { host: /(^|\.)etsy\.com$/, params: ["click_key", "click_sum", "organic_search_click", "ga_order", "ga_search_type", "ga_view_type", "ga_search_query", "sts", "pro", "frs", "ref", "plkey", "sr_prefetch", "pf_from", "pop"] },
    { host: /(^|\.)walmart\.com$/, params: ["from", "sid", "wl13", "wmlspartner", "affiliates_ad_id", "veh", "sourceid", "classtype"], prefixes: ["ath"] },
    { host: /(^|\.)nytimes\.com$/, params: ["smid", "smtyp", "partner", "emc", "nl", "campaign_id", "instance_id", "segment_id", "user_id", "regi_id"] },
    { host: /(^|\.)washingtonpost\.com$/, params: ["itid", "wpisrc", "wpmk", "wp_cu", "pwapi_token"] },
    { host: /(^|\.)bloomberg\.com$/, params: ["srnd", "sref", "cmpid", "leadsource", "embedded-checkout"] },
  ];

  // Wrapper links that carry the real destination in their own URL.
  // These are decoded locally, so no request ever hits the wrapper.
  const UNWRAP_RULES = [
    { host: /(^|\.)google\.[a-z.]{2,6}$/, path: /^\/url$/, params: ["q", "url"] },
    { host: /(^|\.)google\.[a-z.]{2,6}$/, path: /^\/imgres$/, params: ["imgrefurl"] },
    { host: /^(l|lm)\.facebook\.com$/, path: /^\/l\.php$/, params: ["u"] },
    { host: /^l\.messenger\.com$/, path: /^\/l\.php$/, params: ["u"] },
    { host: /^l\.instagram\.com$/, params: ["u"] },
    { host: /^l\.threads\.(net|com)$/, params: ["u"] },
    { host: /^out\.reddit\.com$/, params: ["url"] },
    { host: /(^|\.)youtube\.com$/, path: /^\/redirect$/, params: ["q"] },
    { host: /\.safelinks\.protection\.outlook\.com$/, params: ["url"] },
    { host: /^slack-redir\.net$/, path: /^\/link$/, params: ["url"] },
    { host: /^steamcommunity\.com$/, path: /^\/linkfilter\/?$/, params: ["u", "url"] },
    { host: /(^|\.)duckduckgo\.com$/, path: /^\/l\/?$/, params: ["uddg"] },
    { host: /(^|\.)bing\.com$/, path: /^\/ck\/a$/, params: ["u"], decode: decodeBing },
    { host: /^(away\.)?vk\.com$/, path: /^\/away\.php$/, params: ["to"] },
    { host: /^disq\.us$/, path: /^\/url$/, params: ["url"], decode: (v) => v.replace(/:[A-Za-z0-9_-]{16,}$/, "") },
    { host: /^t\.umblr\.com$/, path: /^\/redirect$/, params: ["z"] },
    { host: /(^|\.)linkedin\.com$/, path: /^\/redir\/redirect\/?$/, params: ["url"] },
    { host: /^link\.zhihu\.com$/, params: ["target"] },
    { host: /(^|\.)pinterest\.[a-z.]{2,6}$/, path: /^\/offsite\/?$/, params: ["url"] },
    { host: /^exit\.sc$/, params: ["url"] },
    { host: /(^|\.)googleadservices\.com$/, path: /^\/pagead\/aclk$/, params: ["adurl"] },
    { host: /^go\.redirectingat\.com$/, params: ["url"] },
    { host: /^click\.linksynergy\.com$/, params: ["murl"] },
    { host: /(^|\.)awin1\.com$/, path: /^\/cread\.php$/, params: ["ued"] },
    { host: /^urldefense\.proofpoint\.com$/, path: /^\/v2\/url$/, params: ["u"], decode: (v) => safeDecode(v.replace(/-/g, "%").replace(/_/g, "/")) },
    { host: /^urldefense\.com$/, custom: (u) => { const m = u.href.match(/\/v3\/__(.+?)__;/); return m ? m[1].replace(/\*/g, "") : null; } },
    { host: /^href\.li$/, custom: (u) => safeDecode(u.search.slice(1)) },
    { host: /^(www\.)?anonym\.to$/, custom: (u) => safeDecode(u.search.slice(1)) },
  ];

  const SHORTENERS = new Set([
    "bit.ly", "bitly.com", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly", "lnkd.in", "is.gd",
    "v.gd", "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "tiny.cc", "s.id", "t.ly", "bit.do",
    "amzn.to", "amzn.eu", "a.co", "fb.me", "dlvr.it", "trib.al", "ift.tt", "shor.by", "linktr.ee",
    "bl.ink", "snip.ly", "qr.ae", "adf.ly", "soo.gd", "clck.ru", "t.me", "wp.me", "youtu.be",
    "redd.it", "spoti.fi", "apple.co", "g.co", "forms.gle", "maps.app.goo.gl", "on.soundcloud.com",
    "tiny.one", "rotf.lol", "surl.li", "bit.ws", "1url.com", "hubs.ly", "hubs.la", "mailchi.mp",
    "lnk.to", "smarturl.it", "ffm.to", "geni.us", "tr.ee", "dub.sh", "dub.co", "short.io", "zpr.io",
  ]);

  const SUSPICIOUS_TLDS = new Set([
    "zip", "mov", "tk", "ml", "ga", "cf", "gq", "top", "click", "country", "kim", "rest", "cam",
    "xin", "work", "loan", "men", "date", "racing", "download", "stream", "bid", "win", "review",
  ]);

  // Multi-label public suffixes, plus hosting platforms where every subdomain is a different owner.
  const MULTI_SUFFIXES = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "com.au", "net.au", "org.au",
    "edu.au", "gov.au", "co.jp", "ne.jp", "or.jp", "ac.jp", "co.nz", "org.nz", "co.in", "net.in",
    "org.in", "co.za", "com.br", "com.mx", "com.tr", "com.cn", "com.hk", "com.sg", "com.tw", "co.kr",
    "com.ar", "com.co", "com.my", "com.ph", "com.pk", "com.vn", "co.id", "co.il", "com.ua", "com.pl",
    "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "herokuapp.com",
    "web.app", "firebaseapp.com", "blogspot.com", "wordpress.com", "substack.com", "glitch.me",
    "onrender.com", "fly.dev", "azurewebsites.net", "cloudfront.net", "s3.amazonaws.com", "myshopify.com",
    "notion.site", "framer.website", "webflow.io", "carrd.co", "neocities.org", "repl.co", "replit.app",
  ]);

  const COMMON_TLDS = new Set([
    "com", "net", "org", "io", "dev", "app", "co", "ai", "me", "tech", "xyz", "info", "biz", "edu",
    "gov", "us", "uk", "ca", "au", "de", "fr", "es", "it", "nl", "se", "no", "fi", "dk", "pl", "ru",
    "jp", "cn", "in", "br", "mx", "ch", "at", "be", "ie", "nz", "sg", "hk", "kr", "tw", "il", "za",
    "ly", "gg", "tv", "fm", "so", "to", "sh", "site", "online", "store", "shop", "blog", "news",
    "page", "link", "live", "cloud", "pro", "zip", "mov", "top", "tk", "ml", "cf", "gq", "ga",
  ]);

  const FILE_TYPES = {
    pdf: "PDF", zip: "ZIP archive", rar: "RAR archive", "7z": "7z archive", gz: "Archive", tgz: "Archive",
    tar: "Archive", exe: "Windows app", msi: "Windows installer", bat: "Windows script", scr: "Windows screensaver",
    cmd: "Windows script", ps1: "PowerShell script", dmg: "Mac disk image", pkg: "Mac installer",
    app: "Mac app", apk: "Android app", ipa: "iOS app", deb: "Linux package", rpm: "Linux package",
    appimage: "Linux app", jar: "Java app", iso: "Disk image", img: "Disk image", doc: "Word document",
    docx: "Word document", xls: "Excel sheet", xlsx: "Excel sheet", ppt: "PowerPoint", pptx: "PowerPoint",
    csv: "CSV file", mp3: "Audio", wav: "Audio", flac: "Audio", m4a: "Audio", mp4: "Video", mov: "Video",
    mkv: "Video", webm: "Video", avi: "Video", torrent: "Torrent", epub: "eBook", txt: "Text file",
  };
  const EXECUTABLES = new Set(["exe", "msi", "bat", "scr", "cmd", "ps1", "dmg", "pkg", "app", "apk", "ipa", "deb", "rpm", "appimage", "jar"]);

  // Links that perform an action when loaded. unboxx never requests these in the background.
  const ACTION_PATTERN = /(^|[\/_\-.?=&])(log-?out|sign-?out|log-?off|sign-?off|unsubscribe|opt-?out|delete|destroy|revoke|deactivate)([\/_\-.?=&]|$)/i;

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function decodeBing(value) {
    if (!value || !value.startsWith("a1")) return value;
    try {
      const b64 = value.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    } catch {
      return null;
    }
  }

  function parseHttpUrl(value) {
    if (!value) return null;
    let candidate = value.trim();
    if (/^https?%3a/i.test(candidate)) candidate = safeDecode(candidate);
    if (/^www\./i.test(candidate)) candidate = "https://" + candidate;
    try {
      const u = new URL(candidate);
      return u.protocol === "http:" || u.protocol === "https:" ? u : null;
    } catch {
      return null;
    }
  }

  function unwrapOnce(u) {
    const host = u.hostname.toLowerCase();
    for (const rule of UNWRAP_RULES) {
      if (!rule.host.test(host)) continue;
      if (rule.path && !rule.path.test(u.pathname)) continue;
      if (rule.custom) {
        const next = parseHttpUrl(rule.custom(u));
        if (next) return next;
        continue;
      }
      for (const name of rule.params) {
        let value = u.searchParams.get(name);
        if (!value) continue;
        if (rule.decode) value = rule.decode(value);
        const next = parseHttpUrl(value);
        if (next) return next;
      }
    }
    return null;
  }

  function siteRulesFor(host, pathname) {
    return SITE_RULES.filter((rule) => rule.host.test(host) && (!rule.onPath || rule.onPath.test(pathname)));
  }

  function shouldStrip(name, rules, strict) {
    const key = name.toLowerCase();
    if (GLOBAL_PARAMS.has(key)) return true;
    if (GLOBAL_PREFIXES.some((p) => key.startsWith(p))) return true;
    if (strict && STRICT_PARAMS.has(key)) return true;
    for (const rule of rules) {
      if (rule.params && rule.params.includes(key)) return true;
      if (rule.prefixes && rule.prefixes.some((p) => key.startsWith(p))) return true;
      if (strict && rule.strict && rule.strict.includes(key)) return true;
    }
    return false;
  }

  // Removes trackers while keeping every other byte of the query string as it was.
  function cleanUrlObject(u, strict) {
    const out = new URL(u.href);
    const rules = siteRulesFor(out.hostname.toLowerCase(), out.pathname);
    const removed = [];

    if (out.search.length > 1) {
      const kept = [];
      for (const part of out.search.slice(1).split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const rawName = eq === -1 ? part : part.slice(0, eq);
        const name = safeDecode(rawName.replace(/\+/g, " "));
        if (shouldStrip(name, rules, strict)) {
          const rawValue = eq === -1 ? "" : part.slice(eq + 1);
          removed.push({ name, value: safeDecode(rawValue.replace(/\+/g, " ")) });
        } else {
          kept.push(part);
        }
      }
      out.search = kept.length ? "?" + kept.join("&") : "";
    }

    for (const rule of rules) {
      if (rule.stripPath && rule.stripPath.test(out.pathname)) {
        const match = out.pathname.match(rule.stripPath);
        removed.push({ name: "path", value: match[0].replace(/^\//, "") });
        out.pathname = out.pathname.replace(rule.stripPath, "") || "/";
      }
    }

    // Facebook appends a junk fragment after login redirects.
    if (out.hash === "#_=_") out.hash = "";

    return { url: out.href, removed };
  }

  function registrableDomain(host) {
    if (!host) return "";
    const h = host.toLowerCase().replace(/\.$/, "");
    if (isIpHost(h)) return h;
    const labels = h.split(".");
    if (labels.length <= 2) return h;
    const lastTwo = labels.slice(-2).join(".");
    const lastThree = labels.slice(-3).join(".");
    if (MULTI_SUFFIXES.has(lastThree)) return labels.slice(-4).join(".");
    if (MULTI_SUFFIXES.has(lastTwo)) return lastThree;
    return lastTwo;
  }

  function isIpHost(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  }

  // Loopback, .local/.test names and private network ranges (routers, NAS boxes, dev servers).
  function isLocalHost(host) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".test") || host.endsWith(".internal") || host === "[::1]") return true;
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }

  function fileTypeOf(u) {
    const m = u.pathname.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    if (!m || !FILE_TYPES[m[1]]) return null;
    return { ext: m[1], label: FILE_TYPES[m[1]], executable: EXECUTABLES.has(m[1]) };
  }

  function riskFlags(u) {
    const host = u.hostname.toLowerCase();
    const tld = host.split(".").pop();
    const local = isLocalHost(host);
    return {
      insecure: u.protocol === "http:" && !local,
      punycode: host.split(".").some((label) => label.startsWith("xn--")),
      ipHost: isIpHost(host) && !local,
      userinfo: Boolean(u.username || u.password),
      suspiciousTld: SUSPICIOUS_TLDS.has(tld),
      port: Boolean(u.port) && !local,
      shortener: SHORTENERS.has(host.replace(/^www\./, "")),
    };
  }

  function displayParts(href) {
    try {
      const u = new URL(href);
      const host = u.hostname.replace(/^www\./, "");
      let rest = u.pathname === "/" ? "" : u.pathname;
      rest += u.search + u.hash;
      return { host: host + (u.port ? ":" + u.port : ""), rest };
    } catch {
      return { host: href, rest: "" };
    }
  }

  function specialKind(protocol) {
    if (protocol === "mailto:") return "email";
    if (protocol === "tel:" || protocol === "callto:") return "phone";
    if (protocol === "sms:" || protocol === "smsto:") return "sms";
    return null;
  }

  // Instant, network-free analysis of a link. Everything the card can show before a fetch.
  function analyze(href, opts = {}) {
    const strict = Boolean(opts.strict);
    const unwrap = opts.unwrap !== false;
    let u;
    try {
      u = new URL(href);
    } catch {
      return { ok: false, kind: "invalid", href };
    }

    const kind = specialKind(u.protocol);
    if (kind) {
      const address = safeDecode(u.href.slice(u.protocol.length)).split("?")[0];
      const subject = kind === "email" ? u.searchParams.get("subject") : null;
      return { ok: true, kind, href: u.href, address, subject };
    }

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: true, kind: "other", href: u.href, address: u.href, scheme: u.protocol.replace(":", "") };
    }

    const unwrapped = [];
    let current = u;
    if (unwrap) {
      for (let i = 0; i < 4; i++) {
        const next = unwrapOnce(current);
        if (!next || next.href === current.href) break;
        unwrapped.push(current.href);
        current = next;
      }
    }

    const { url: clean, removed } = cleanUrlObject(current, strict);
    const parts = displayParts(current.href);

    return {
      ok: true,
      kind: "web",
      href: u.href,
      target: current.href,
      clean,
      removed,
      unwrapped,
      host: current.hostname.toLowerCase(),
      displayHost: parts.host,
      displayPath: parts.rest,
      registrable: registrableDomain(current.hostname),
      flags: riskFlags(current),
      fileType: fileTypeOf(current),
      isAction: ACTION_PATTERN.test(current.pathname + current.search),
      changed: clean !== u.href,
    };
  }

  function cleanUrl(href, opts = {}) {
    const result = analyze(href, opts);
    return result.ok && result.kind === "web" ? result.clean : href;
  }

  // Phishing check: the visible link text names one domain, the href goes somewhere else.
  function textMismatch(text, destHref) {
    if (!text) return null;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 120) return null;
    const m = trimmed.match(/(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}))(?=[\/:?#\s.,;!)\]"'>]|$)/i);
    if (!m) return null;
    const textHost = m[1].toLowerCase();
    const tld = m[2].toLowerCase();
    const explicit = /https?:\/\/|www\./i.test(trimmed);
    if (!explicit && !COMMON_TLDS.has(tld)) return null;
    let destHost;
    try {
      destHost = new URL(destHref).hostname.toLowerCase();
    } catch {
      return null;
    }
    const a = registrableDomain(textHost);
    const b = registrableDomain(destHost);
    if (!a || !b || a === b) return null;
    return { textHost: textHost.replace(/^www\./, ""), destHost: destHost.replace(/^www\./, "") };
  }

  function sameSite(a, b) {
    try {
      return registrableDomain(new URL(a).hostname) === registrableDomain(new URL(b).hostname);
    } catch {
      return false;
    }
  }

  globalThis.UnboxxRules = {
    analyze,
    cleanUrl,
    textMismatch,
    sameSite,
    registrableDomain,
    displayParts,
    riskFlags,
    fileTypeOf,
    isLocalHost,
    SHORTENERS,
  };
})();
