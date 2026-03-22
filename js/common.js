/**
 * common.js — 共享交互逻辑
 * 粒子星空、光标跟随、卡片聚光灯、滚动揭示
 */

/* ===== Particles (Star-field Warp) ===== */
const canvas = document.getElementById("particles-canvas");
const ctx = canvas ? canvas.getContext("2d") : null;
let width, height;
let particles = [];
let rafId = null;
let particleBootstrapTimer = null;
let mouseX = 0,
  mouseY = 0;
let targetMouseX = 0,
  targetMouseY = 0;
let particleCount = window.innerWidth < 768 ? 120 : 350;
const colors = [
  "rgba(0, 255, 255, 1)",
  "rgba(77, 159, 255, 0.9)",
  "rgba(224, 64, 251, 0.85)",
  "rgba(255, 64, 129, 0.8)",
  "rgba(255, 255, 255, 0.6)",
];

function resize() {
  const rect = canvas?.getBoundingClientRect();
  width = Math.max(
    window.innerWidth || 0,
    document.documentElement.clientWidth || 0,
    Math.round(rect?.width || 0),
  );
  height = Math.max(
    window.innerHeight || 0,
    document.documentElement.clientHeight || 0,
    Math.round(rect?.height || 0),
  );
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }
  return width > 0 && height > 0;
}

class Particle {
  constructor() {
    this.spawn(false);
  }

  spawn(isRespawn) {
    this.x =
      (Math.random() - 0.5) * width * (isRespawn ? 1.5 : 2) + width / 2;
    this.y =
      (Math.random() - 0.5) * height * (isRespawn ? 1.5 : 2) + height / 2;
    this.z = isRespawn
      ? 2000 + Math.random() * 500
      : Math.random() * 2000 + 100;
    this.size = Math.random() * 1.5 + 0.5;
    this.color = colors[Math.floor(Math.random() * colors.length)];
    this.baseVz = Math.random() * -3 - 0.5;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = (Math.random() - 0.5) * 0.5;
    this.vz = this.baseVz;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz * speedMultiplier;
    if (
      this.z < 1 ||
      this.x < -width ||
      this.x > width * 2 ||
      this.y < -height ||
      this.y > height * 2
    ) {
      this.spawn(true);
    }
  }

  getDrawData(out) {
    const fov = 300;
    const perspective = fov / (fov + this.z);
    const parallaxX = mouseX * (1000 / this.z) * 0.2;
    const parallaxY = mouseY * (1000 / this.z) * 0.2;
    out.px = (this.x - width / 2) * perspective + width / 2 + parallaxX;
    out.py = (this.y - height / 2) * perspective + height / 2 + parallaxY;
    out.pSize = this.size * perspective * 2;
    out.opacity = Math.min(1, Math.max(0, 1 - this.z / 1500));
    out.color = this.color;
    return out;
  }
}

function initParticles() {
  particles = [];
  for (let i = 0; i < particleCount; i++) particles.push(new Particle());
}

const bucketKeys = colors;
let drawPool = [];
let bucketArrays = {};
let bucketCounts = {};

function rebuildParticleBuffers() {
  drawPool = Array.from({ length: particleCount }, () => ({
    px: 0,
    py: 0,
    pSize: 0,
    opacity: 0,
    color: "",
  }));

  bucketArrays = {};
  bucketCounts = {};
  bucketKeys.forEach((c) => {
    bucketArrays[c] = Array(particleCount);
    bucketCounts[c] = 0;
  });
}

rebuildParticleBuffers();

let speedMultiplier = 1;
let targetSpeedMultiplier = 1;
let particlesBootstrapped = false;

function drawParticlesFrame(advance = true) {
  if (!ctx || !width || !height) return;
  ctx.clearRect(0, 0, width, height);

  if (advance) {
    mouseX += (targetMouseX - mouseX) * 0.05;
    mouseY += (targetMouseY - mouseY) * 0.05;
    speedMultiplier += (targetSpeedMultiplier - speedMultiplier) * 0.08;
  }

  // Reset counters for this frame
  bucketKeys.forEach((c) => (bucketCounts[c] = 0));

  for (let i = 0; i < particleCount; i++) {
    if (advance) particles[i].update();
    const d = particles[i].getDrawData(drawPool[i]);
    const c = d.color;
    bucketArrays[c][bucketCounts[c]++] = d;
  }

  for (let i = 0; i < bucketKeys.length; i++) {
    const color = bucketKeys[i];
    const count = bucketCounts[color];
    if (count === 0) continue;

    ctx.fillStyle = color;

    for (let j = 0; j < count; j++) {
      const d = bucketArrays[color][j];
      ctx.globalAlpha = d.opacity;
      const s = d.pSize * 2;
      ctx.fillRect(d.px - d.pSize, d.py - d.pSize, s, s);
    }
  }
  ctx.globalAlpha = 1;
}

function stopParticles() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function clearParticleBootstrapTimer() {
  if (particleBootstrapTimer) {
    clearTimeout(particleBootstrapTimer);
    particleBootstrapTimer = null;
  }
}

function animateParticles() {
  if (!ctx) return;
  drawParticlesFrame(true);
  rafId = requestAnimationFrame(animateParticles);
}

function bootstrapParticles(force = false) {
  if (!ctx) return false;

  stopParticles();
  clearParticleBootstrapTimer();

  const hasViewport = resize();
  if (!hasViewport) return false;

  if (force || !particlesBootstrapped || particles.length !== particleCount) {
    initParticles();
    particlesBootstrapped = true;
  }

  drawParticlesFrame(false);
  animateParticles();
  return true;
}

function scheduleParticleBootstrap(force = false, attempt = 0) {
  if (!ctx) return;

  requestAnimationFrame(() => {
    const didBootstrap = bootstrapParticles(force);
    if (!didBootstrap && attempt < 6) {
      particleBootstrapTimer = setTimeout(() => {
        particleBootstrapTimer = null;
        scheduleParticleBootstrap(true, attempt + 1);
      }, 80 + attempt * 80);
    }
  });
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  stopParticles();
  clearParticleBootstrapTimer();
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    const newCount = window.innerWidth < 768 ? 120 : 350;
    if (newCount !== particleCount) {
      particleCount = newCount;
      rebuildParticleBuffers();
    }

    bootstrapParticles(true);
  }, 300);
});

// Smooth hyper-drive burst
window.addEventListener("mousedown", () => (targetSpeedMultiplier = 20));
window.addEventListener("mouseup", () => (targetSpeedMultiplier = 1));
window.addEventListener("mouseleave", () => (targetSpeedMultiplier = 1));
window.addEventListener("touchstart", () => (targetSpeedMultiplier = 20), {
  passive: true,
});
window.addEventListener("touchend", () => (targetSpeedMultiplier = 1), {
  passive: true,
});
window.addEventListener("touchcancel", () => (targetSpeedMultiplier = 1), {
  passive: true,
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => scheduleParticleBootstrap(), {
    once: true,
  });
} else {
  scheduleParticleBootstrap();
}

window.addEventListener("load", () => scheduleParticleBootstrap(true), {
  once: true,
});

window.addEventListener("pageshow", () => {
  if (!particlesBootstrapped || !rafId) {
    scheduleParticleBootstrap(true);
  }
});

// 页面不可见时暂停粒子动画，节省 CPU/GPU
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopParticles();
    clearParticleBootstrapTimer();
  } else if (ctx) {
    scheduleParticleBootstrap(!particlesBootstrapped || !rafId);
  }
});

/* ===== Cursor Glow, Spotlight & Parallax (merged mousemove) ===== */
function createMediaQueryList(query) {
  if (typeof window.matchMedia === "function") {
    return window.matchMedia(query);
  }

  return {
    matches: false,
    addEventListener: null,
    removeEventListener: null,
    addListener: () => {},
    removeListener: () => {},
  };
}

function sanitizeImageUrl(candidate) {
  if (!candidate || typeof candidate !== "string") return null;

  try {
    const parsed = new URL(candidate, window.location.origin);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch (error) {
    return null;
  }
}

function sanitizeCoverBackground(value, fallback = null) {
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();
  const isGradient = /^(linear-gradient|radial-gradient)\([#(),.%\sa-zA-Z0-9+-]+\)$/.test(trimmed);
  if (!trimmed || !isGradient) return fallback;
  if (trimmed.includes(";") || /url\s*\(/i.test(trimmed)) return fallback;
  return trimmed;
}

function isLikelyEphemeralAssetUrl(candidate) {
  if (!candidate || typeof candidate !== "string") return false;

  try {
    const parsed = new URL(candidate, window.location.href);
    const expiringQueryKeys = [
      "X-Amz-Algorithm",
      "X-Amz-Credential",
      "X-Amz-Date",
      "X-Amz-Expires",
      "X-Amz-Signature",
      "Expires",
      "Signature",
    ];

    return expiringQueryKeys.some((key) => parsed.searchParams.has(key));
  } catch (error) {
    return false;
  }
}

function resolveShareImageUrl(candidate, fallback = null) {
  const safeUrl = sanitizeImageUrl(candidate);
  if (!safeUrl || isLikelyEphemeralAssetUrl(safeUrl)) {
    return fallback;
  }

  return safeUrl;
}

function normalizePostId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function getPostIdFromUrl(url = window.location.href) {
  try {
    const resolved = new URL(url, window.location.origin);
    const pathMatch = resolved.pathname.match(/^\/posts\/([^/?#]+)/);
    if (pathMatch?.[1]) {
      return normalizePostId(decodeURIComponent(pathMatch[1]));
    }

    if (resolved.pathname.endsWith("/post.html")) {
      return normalizePostId(resolved.searchParams.get("id"));
    }

    return null;
  } catch (error) {
    return null;
  }
}

function buildPostPath(postId) {
  const normalizedPostId = normalizePostId(postId);
  return normalizedPostId ? `/posts/${encodeURIComponent(normalizedPostId)}` : "/post.html";
}

function buildPostUrl(postId) {
  return new URL(buildPostPath(postId), window.location.origin).href;
}

const BLOG_RETURN_URL_STORAGE_KEY = "spa:last-blog-url";

function isBlogPageUrl(url = window.location.href) {
  try {
    const resolved = new URL(url, window.location.origin);
    if (resolved.origin !== window.location.origin) {
      return false;
    }

    const normalizedPath =
      resolved.pathname === "/"
        ? "/index.html"
        : resolved.pathname.endsWith("/")
          ? `${resolved.pathname}index.html`
          : resolved.pathname;

    return normalizedPath.endsWith("/blog.html");
  } catch (error) {
    return false;
  }
}

function rememberBlogReturnUrl(url = window.location.href) {
  if (!isBlogPageUrl(url)) {
    return null;
  }

  const resolved = new URL(url, window.location.origin).href;

  try {
    sessionStorage.setItem(BLOG_RETURN_URL_STORAGE_KEY, resolved);
  } catch (error) {
    // sessionStorage unavailable
  }

  return resolved;
}

function readStoredBlogReturnUrl() {
  try {
    const storedUrl = sessionStorage.getItem(BLOG_RETURN_URL_STORAGE_KEY);
    if (!storedUrl || !isBlogPageUrl(storedUrl)) {
      return null;
    }

    return new URL(storedUrl, window.location.origin).href;
  } catch (error) {
    return null;
  }
}

function getPreferredBlogReturnUrl({ fallback = "/blog.html" } = {}) {
  const rememberedUrl = readStoredBlogReturnUrl();
  if (rememberedUrl) {
    return rememberedUrl;
  }

  if (typeof document.referrer === "string" && isBlogPageUrl(document.referrer)) {
    try {
      return new URL(document.referrer, window.location.origin).href;
    } catch (error) {
      // Ignore invalid referrer and fall through to the default route.
    }
  }

  return new URL(fallback, window.location.origin).href;
}

window.SiteUtils = Object.freeze({
  buildPostPath,
  buildPostUrl,
  createMediaQueryList,
  getPreferredBlogReturnUrl,
  getPostIdFromUrl,
  normalizePostId,
  rememberBlogReturnUrl,
  sanitizeImageUrl,
  sanitizeCoverBackground,
  resolveShareImageUrl,
});

if (isBlogPageUrl(window.location.href)) {
  rememberBlogReturnUrl(window.location.href);
}

const cursorGlow = document.getElementById("cursorGlow");
const finePointerQuery = createMediaQueryList("(hover: hover) and (pointer: fine)");
const reducedMotionQuery = createMediaQueryList("(prefers-reduced-motion: reduce)");
const connectionInfo =
  navigator.connection ||
  navigator.mozConnection ||
  navigator.webkitConnection ||
  null;
let mouseAF = null;
let cursorTrackingEnabled = false;
let latestPointerX = 0;
let latestPointerY = 0;

function canUseCursorGlow() {
  return Boolean(cursorGlow) && finePointerQuery.matches && !reducedMotionQuery.matches;
}

function bindMediaQueryChange(mediaQueryList, handler) {
  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", handler);
    return;
  }

  mediaQueryList.addListener(handler);
}

function handleMouseMove(e) {
  latestPointerX = e.clientX;
  latestPointerY = e.clientY;

  // Particles Parallax Offset
  if (width && height) {
    targetMouseX = (latestPointerX - width / 2) * 2;
    targetMouseY = (latestPointerY - height / 2) * 2;
  }

  if (mouseAF) return; // Debounce RAF
  mouseAF = requestAnimationFrame(() => {
    // Global Cursor Glow
    if (cursorGlow && cursorTrackingEnabled) {
      cursorGlow.style.transform = `translate(${latestPointerX - 200}px, ${latestPointerY - 200}px)`;
    }
    mouseAF = null;
  });
}

function syncCursorGlowState() {
  const enabled = canUseCursorGlow();
  document.body?.classList.toggle("has-cursor-glow", enabled);

  if (enabled === cursorTrackingEnabled) return;
  cursorTrackingEnabled = enabled;

  if (!enabled && cursorGlow) {
    cursorGlow.style.transform = "";
  }
}

document.addEventListener("mousemove", handleMouseMove, { passive: true });
bindMediaQueryChange(finePointerQuery, syncCursorGlowState);
bindMediaQueryChange(reducedMotionQuery, syncCursorGlowState);
syncCursorGlowState();

/* ===== Blog Card Reveal (reuse for blog pages) ===== */
function initBlogCardReveal() {
  const blogCards = document.querySelectorAll(".blog-card");
  if (blogCards.length === 0) return () => {};

  if (typeof IntersectionObserver !== "function") {
    blogCards.forEach((card) => card.classList.add("visible"));
    return () => {};
  }

  const revealTimeouts = new Set();

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const i = Number(card.dataset.revealIndex || 0);
          const timeoutId = window.setTimeout(() => {
            revealTimeouts.delete(timeoutId);
            card.classList.add("visible");
          }, i * 80);
          revealTimeouts.add(timeoutId);
          observer.unobserve(card);
        }
      });
    },
    { threshold: 0.1 },
  );
  blogCards.forEach((el, index) => {
    el.dataset.revealIndex = String(index);
    observer.observe(el);
  });

  return () => {
    observer.disconnect();
    revealTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    revealTimeouts.clear();
  };
}

// Expose for use in page scripts
window.initBlogCardReveal = initBlogCardReveal;

function ensureMetaTag(selector, attributes) {
  let meta = document.head?.querySelector(selector);
  if (!meta) {
    meta = document.createElement("meta");
    Object.entries(attributes).forEach(([key, value]) => {
      meta.setAttribute(key, value);
    });
    document.head?.appendChild(meta);
  }
  return meta;
}

function ensureLinkTag(selector, attributes) {
  let link = document.head?.querySelector(selector);
  if (!link) {
    link = document.createElement("link");
    Object.entries(attributes).forEach(([key, value]) => {
      link.setAttribute(key, value);
    });
    document.head?.appendChild(link);
  }
  return link;
}

const DEFAULT_OG_IMAGE_URL = new URL("favicon.png?v=2", window.location.origin).href;
const DEFAULT_OG_IMAGE_ALT = "Share Everything";

function sanitizeMetaImageUrl(candidate) {
  return resolveShareImageUrl(candidate, DEFAULT_OG_IMAGE_URL) || DEFAULT_OG_IMAGE_URL;
}

function updateSeoMeta({
  title,
  description,
  url = window.location.href,
  canonicalUrl = url,
  ogTitle = title,
  ogDescription = description,
  ogImage = DEFAULT_OG_IMAGE_URL,
  ogImageAlt = DEFAULT_OG_IMAGE_ALT,
  ogType,
  robots,
} = {}) {
  const resolvedUrl = new URL(url, window.location.href);
  resolvedUrl.hash = "";
  const resolvedCanonicalUrl = new URL(canonicalUrl, window.location.href);
  resolvedCanonicalUrl.hash = "";
  const resolvedOgImage = sanitizeMetaImageUrl(ogImage);

  if (typeof title === "string" && title) {
    document.title = title;
  }

  if (typeof description === "string") {
    ensureMetaTag('meta[name="description"]', {
      name: "description",
    }).content = description;
  }

  if (typeof ogTitle === "string" && ogTitle) {
    ensureMetaTag('meta[property="og:title"]', {
      property: "og:title",
    }).content = ogTitle;
  }

  if (typeof ogDescription === "string") {
    ensureMetaTag('meta[property="og:description"]', {
      property: "og:description",
    }).content = ogDescription;
  }

  if (typeof ogType === "string" && ogType) {
    ensureMetaTag('meta[property="og:type"]', {
      property: "og:type",
    }).content = ogType;
  }

  ensureMetaTag('meta[property="og:url"]', {
    property: "og:url",
  }).content = resolvedUrl.href;
  ensureMetaTag('meta[property="og:image"]', {
    property: "og:image",
  }).content = resolvedOgImage;
  ensureMetaTag('meta[property="og:image:alt"]', {
    property: "og:image:alt",
  }).content = typeof ogImageAlt === "string" && ogImageAlt ? ogImageAlt : DEFAULT_OG_IMAGE_ALT;

  ensureLinkTag('link[rel="canonical"]', {
    rel: "canonical",
  }).href = resolvedCanonicalUrl.href;

  if (typeof robots === "string" && robots) {
    ensureMetaTag('meta[name="robots"]', {
      name: "robots",
    }).content = robots;
  } else if (robots === null) {
    document.head?.querySelector('meta[name="robots"]')?.remove();
  }
}

window.updateSeoMeta = updateSeoMeta;
updateSeoMeta({
  title: document.title,
  description: document.querySelector('meta[name="description"]')?.content,
  ogTitle: document.querySelector('meta[property="og:title"]')?.content || document.title,
  ogDescription:
    document.querySelector('meta[property="og:description"]')?.content ||
    document.querySelector('meta[name="description"]')?.content,
  ogImage: document.querySelector('meta[property="og:image"]')?.content || DEFAULT_OG_IMAGE_URL,
  ogImageAlt:
    document.querySelector('meta[property="og:image:alt"]')?.content || DEFAULT_OG_IMAGE_ALT,
  ogType: document.querySelector('meta[property="og:type"]')?.content || "website",
  robots: document.querySelector('meta[name="robots"]')?.content ?? null,
  url: window.location.href,
  canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || window.location.href,
});

function ensureStructuredDataTag(key) {
  const selector = `script[type="application/ld+json"][data-structured-data="${key}"]`;
  let script = document.head?.querySelector(selector);
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-structured-data", key);
    document.head?.appendChild(script);
  }
  return script;
}

function setStructuredData(key, payload) {
  if (!key) return;
  if (!payload || typeof payload !== "object") {
    clearStructuredData(key);
    return;
  }

  ensureStructuredDataTag(key).textContent = JSON.stringify(payload);
}

function clearStructuredData(key) {
  if (!key) return;
  document.head
    ?.querySelector(`script[type="application/ld+json"][data-structured-data="${key}"]`)
    ?.remove();
}

window.StructuredData = Object.freeze({
  set: setStructuredData,
  clear: clearStructuredData,
});

const PageProgress = (() => {
  let root = null;
  let bar = null;
  let trickleTimer = null;
  let hideTimer = null;
  let currentValue = 0;

  function ensureElements() {
    if (root && bar) {
      return { root, bar };
    }

    root = document.getElementById("pageProgress");
    if (!(root instanceof HTMLElement)) {
      root = document.createElement("div");
      root.id = "pageProgress";
      root.className = "page-progress";
      root.setAttribute("aria-hidden", "true");

      bar = document.createElement("span");
      bar.className = "page-progress-bar";
      root.appendChild(bar);
      document.body?.appendChild(root);
    } else {
      bar = root.querySelector(".page-progress-bar");
      if (!(bar instanceof HTMLElement)) {
        bar = document.createElement("span");
        bar.className = "page-progress-bar";
        root.appendChild(bar);
      }
    }

    return { root, bar };
  }

  function setProgress(value) {
    const nextValue = Math.max(0, Math.min(1, value));
    currentValue = nextValue;
    ensureElements().bar.style.transform = `scaleX(${nextValue})`;
  }

  function stopTrickle() {
    if (trickleTimer != null) {
      clearInterval(trickleTimer);
      trickleTimer = null;
    }
  }

  function start() {
    const elements = ensureElements();
    if (hideTimer != null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    stopTrickle();
    elements.root.classList.remove("is-complete");
    elements.root.classList.add("is-visible");
    setProgress(0.08);

    trickleTimer = window.setInterval(() => {
      const delta = currentValue < 0.35
        ? 0.14
        : currentValue < 0.65
          ? 0.08
          : 0.03;
      setProgress(Math.min(0.9, currentValue + delta));
    }, 160);
  }

  function finish() {
    const elements = ensureElements();
    stopTrickle();
    elements.root.classList.add("is-visible");
    setProgress(Math.max(currentValue, 0.96));

    window.requestAnimationFrame(() => {
      setProgress(1);
      elements.root.classList.add("is-complete");
    });

    hideTimer = window.setTimeout(() => {
      elements.root.classList.remove("is-visible", "is-complete");
      setProgress(0);
      hideTimer = null;
    }, 260);
  }

  return { start, finish };
})();

function findPageFocusTarget(root, preferredSelectors = []) {
  if (!(root instanceof HTMLElement)) return null;

  const selectors = [
    ...preferredSelectors,
    "[data-page-focus]",
    ".page-title",
    ".post-title",
    ".hero-title",
    "h1",
  ];

  for (const selector of selectors) {
    const target = root.querySelector(selector);
    if (target instanceof HTMLElement) {
      return target;
    }
  }

  return root;
}

function makeTemporarilyFocusable(target) {
  if (!(target instanceof HTMLElement)) return null;

  const isNaturallyFocusable =
    target.tabIndex >= 0 ||
    target instanceof HTMLAnchorElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable;

  if (!isNaturallyFocusable && !target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    target.dataset.spaManagedFocus = "true";
  }

  return target;
}

function focusSpaContent({ root, preferredSelectors = [], clearPendingFocus = true } = {}) {
  if (!(root instanceof HTMLElement)) return null;

  const target = makeTemporarilyFocusable(findPageFocusTarget(root, preferredSelectors));
  if (!target) return null;

  target.focus({ preventScroll: true });
  if (clearPendingFocus) {
    delete root.dataset.pendingFocus;
  }
  return target;
}

window.focusSpaContent = focusSpaContent;

function getBlogCardLink(target) {
  if (!(target instanceof Element)) return null;

  const card = target.closest(".blog-card");
  if (!card) return null;

  const cardLink = card.querySelector(".blog-card-link");
  return cardLink instanceof HTMLAnchorElement && cardLink.href ? cardLink : null;
}

/* ===== 清除文字选区（防止蓝框残留）===== */
document.addEventListener("mousedown", (e) => {
  if (!(e.target instanceof Element)) return;
  if (e.target.closest(".post-content")) return;
  if (e.target.closest("input, textarea, select, button, a, [contenteditable='true']")) return;

  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed) {
    selection.removeAllRanges();
  }
});

/* ===== Page Runtime ===== */
const PageRuntime = (() => {
  const registry = new Map();
  let currentCleanup = null;

  function getPageIdFromUrl(url = window.location.href) {
    const { pathname } = new URL(url, window.location.origin);
    const normalizedPath =
      pathname === "/" ? "/index.html" : pathname.endsWith("/") ? `${pathname}index.html` : pathname;

    if (normalizedPath.endsWith("/index.html")) return "index";
    if (normalizedPath.endsWith("/blog.html")) return "blog";
    if (pathname.startsWith("/posts/")) return "post";
    if (normalizedPath.endsWith("/post.html")) return "post";
    return null;
  }

  function cleanupCurrentPage() {
    if (typeof currentCleanup !== "function") {
      currentCleanup = null;
      return;
    }

    try {
      currentCleanup();
    } catch (error) {
      console.error("Page cleanup error:", error);
    } finally {
      currentCleanup = null;
    }
  }

  function initializePage(pageId = getPageIdFromUrl(window.location.href)) {
    cleanupCurrentPage();

    if (document.body) {
      document.body.dataset.page = pageId || "";
    }

    const pageModule = pageId ? registry.get(pageId) : null;
    if (!pageModule?.init) return null;

    try {
      currentCleanup = pageModule.init() || null;
    } catch (error) {
      currentCleanup = null;
      console.error(`Page init error (${pageId || "unknown"}):`, error);
    }

    return currentCleanup;
  }

  function register(pageId, pageModule) {
    registry.set(pageId, pageModule);

    if (pageId === getPageIdFromUrl(window.location.href)) {
      initializePage(pageId);
    }
  }

  return {
    getPageIdFromUrl,
    initializePage,
    cleanupCurrentPage,
    register,
  };
})();
window.PageRuntime = PageRuntime;

/* ===== SPA Router — 单页应用导航 ===== */
const SPARouter = (() => {
  let navigationToken = 0;
  let activeNavigationController = null;
  const loadedScripts = new Set();
  const MAX_PAGE_CACHE_ENTRIES = 6;
  const PAGE_CACHE_TTL_MS = 1000 * 60 * 5;
  const pageCache = new Map();
  const prefetched = new Map();

  function canWarmResources() {
    return !(connectionInfo?.saveData || /(^|-)2g$/.test(connectionInfo?.effectiveType || ""));
  }

  function resolveUrl(url) {
    return new URL(url, window.location.href);
  }

  function getRouteKey(url) {
    const resolved = resolveUrl(url);
    const postId = getPostIdFromUrl(resolved.href);
    if (postId) {
      return buildPostUrl(postId);
    }
    resolved.hash = "";
    return resolved.href;
  }

  function getPageCacheKey(url) {
    const resolved = resolveUrl(getRouteKey(url));
    const pageId = PageRuntime.getPageIdFromUrl(resolved.href);
    if (pageId && pageId !== "post") {
      resolved.search = "";
    }

    return resolved.href;
  }

  function rememberPageHtml(cacheKey, html) {
    if (pageCache.has(cacheKey)) {
      pageCache.delete(cacheKey);
    }
    pageCache.set(cacheKey, {
      html,
      cachedAt: Date.now(),
    });

    while (pageCache.size > MAX_PAGE_CACHE_ENTRIES) {
      const oldestCacheKey = pageCache.keys().next().value;
      if (!oldestCacheKey) break;
      pageCache.delete(oldestCacheKey);
      prefetched.delete(oldestCacheKey);
    }
  }

  function readPageHtmlFromCache(cacheKey) {
    const entry = pageCache.get(cacheKey);
    if (!entry) return null;

    if (
      typeof entry.html !== "string" ||
      !Number.isFinite(entry.cachedAt) ||
      Date.now() - entry.cachedAt >= PAGE_CACHE_TTL_MS
    ) {
      pageCache.delete(cacheKey);
      prefetched.delete(cacheKey);
      return null;
    }

    rememberPageHtml(cacheKey, entry.html);
    return entry.html;
  }

  function rememberPrefetchedPage(cacheKey) {
    if (prefetched.has(cacheKey)) {
      prefetched.delete(cacheKey);
    }
    prefetched.set(cacheKey, Date.now());

    while (prefetched.size > MAX_PAGE_CACHE_ENTRIES) {
      const oldestPrefetchedKey = prefetched.keys().next().value;
      if (!oldestPrefetchedKey) break;
      prefetched.delete(oldestPrefetchedKey);
    }
  }

  function hasFreshPrefetch(cacheKey) {
    const prefetchedAt = prefetched.get(cacheKey);
    if (!Number.isFinite(prefetchedAt)) {
      prefetched.delete(cacheKey);
      return false;
    }

    if (Date.now() - prefetchedAt >= PAGE_CACHE_TTL_MS) {
      prefetched.delete(cacheKey);
      return false;
    }

    return true;
  }

  function ensureScript(src) {
    const resolvedSrc = resolveUrl(src).href;
    const hasLoadedScript =
      loadedScripts.has(resolvedSrc) ||
      Array.from(document.scripts).some((script) => script.src === resolvedSrc);

    if (hasLoadedScript) {
      loadedScripts.add(resolvedSrc);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = resolvedSrc;
      s.onload = () => {
        loadedScripts.add(resolvedSrc);
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function fetchPageHtml(url, { signal } = {}) {
    const routeKey = getRouteKey(url);
    const cacheKey = getPageCacheKey(routeKey);
    const cachedHtml = readPageHtmlFromCache(cacheKey);
    if (cachedHtml) {
      return cachedHtml;
    }

    const response = await fetch(routeKey, {
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    rememberPageHtml(cacheKey, html);
    return html;
  }

  function warmPage(url) {
    if (!canWarmResources()) return;
    const cacheKey = getPageCacheKey(url);
    if (hasFreshPrefetch(cacheKey) || readPageHtmlFromCache(cacheKey)) return;

    rememberPrefetchedPage(cacheKey);
    fetchPageHtml(url).catch(() => {
      prefetched.delete(cacheKey);
    });
  }

  function warmPostDetail(link) {
    if (!canWarmResources()) return;
    if (!link?.href || !link.href.startsWith(window.location.origin)) return;
    if (link.dataset.preloaded === "true") return;

    const id = getPostIdFromUrl(link.href);
    if (!id || !window.NotionAPI?.getPost) return;

    link.dataset.preloaded = "true";
    NotionAPI.getPost(id).catch(() => {});
  }

  async function navigate(url, pushState = true) {
    const content = document.getElementById("spa-content");
    if (!content) {
      window.location.href = url;
      return;
    }

    const targetUrl = resolveUrl(url);
    const currentRouteKey = getRouteKey(window.location.href);
    const targetRouteKey = getRouteKey(targetUrl.href);
    if (pushState && targetRouteKey === currentRouteKey) return;

    PageProgress.start();

    const currentPageId = PageRuntime.getPageIdFromUrl(window.location.href);
    const targetPageId = PageRuntime.getPageIdFromUrl(targetRouteKey);
    const currentToken = ++navigationToken;

    if (currentPageId === "blog" && targetPageId === "post") {
      rememberBlogReturnUrl(window.location.href);
    }

    activeNavigationController?.abort();
    activeNavigationController = new AbortController();

    PageRuntime.cleanupCurrentPage();

    // ① 淡出
    content.style.transition = "opacity 0.15s ease, transform 0.15s ease";
    content.style.opacity = "0";
    content.style.transform = "translateY(-8px)";

    try {
      // ② 获取页面（优先使用缓存）
      const html = await fetchPageHtml(targetRouteKey, {
        signal: activeNavigationController.signal,
      });
      if (currentToken !== navigationToken) return;

      // 等淡出动画完成
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (currentToken !== navigationToken) return;

      // ③ 解析并提取内容
      const doc = new DOMParser().parseFromString(html, "text/html");
      const newContent = doc.getElementById("spa-content");
      if (!newContent) {
        window.location.href = targetRouteKey;
        return;
      }

      // 按需加载依赖脚本
      const extScripts = doc.querySelectorAll('script[src]:not([src*="common"])');
      for (const s of extScripts) {
        const scriptSrc = s.getAttribute("src");
        if (scriptSrc) {
          await ensureScript(scriptSrc);
        }
      }
      if (currentToken !== navigationToken) return;

      // ④ 先更新 URL（让页面脚本能读到正确的 location）
      if (pushState) {
        history.pushState(null, "", targetUrl.href);
      }

      // 更新标题和描述
      const nextTitle = doc.title || "Share Everything";
      const nextDescription = doc.querySelector('meta[name="description"]')?.content || "";
      const nextOgTitle = doc.querySelector('meta[property="og:title"]')?.content || nextTitle;
      const nextOgDescription =
        doc.querySelector('meta[property="og:description"]')?.content || nextDescription;
      const nextOgImage =
        doc.querySelector('meta[property="og:image"]')?.content || DEFAULT_OG_IMAGE_URL;
      const nextOgImageAlt =
        doc.querySelector('meta[property="og:image:alt"]')?.content || nextTitle || DEFAULT_OG_IMAGE_ALT;
      const nextOgType = doc.querySelector('meta[property="og:type"]')?.content || "website";
      const nextRobots = doc.querySelector('meta[name="robots"]')?.content ?? null;
      const nextCanonicalUrl = doc.querySelector('link[rel="canonical"]')?.href || targetUrl.href;
      updateSeoMeta({
        title: nextTitle,
        description: nextDescription,
        url: targetUrl.href,
        canonicalUrl: nextCanonicalUrl,
        ogTitle: nextOgTitle,
        ogDescription: nextOgDescription,
        ogImage: nextOgImage,
        ogImageAlt: nextOgImageAlt,
        ogType: nextOgType,
        robots: nextRobots,
      });

      // ⑤ 替换内容
      content.innerHTML = newContent.innerHTML;
      content.dataset.pendingFocus = targetPageId || "page";
      clearStructuredData("post-article");

      // 禁用内部的入场动画（避免与 SPA 过渡重叠）
      content.querySelectorAll(".page-transition-wrapper").forEach(el => el.style.animation = "none");
      content.querySelectorAll(".top-actions").forEach(el => {
        el.style.animation = "none";
        el.style.opacity = "1";
        el.style.transform = "none";
      });

      // ⑥ 初始化页面脚本
      PageRuntime.initializePage(targetPageId);

      // ⑦ 滚动到顶部
      window.scrollTo({ top: 0, behavior: "auto" });
      window.requestAnimationFrame(() => {
        if (currentToken !== navigationToken) return;
        focusSpaContent({
          root: content,
          clearPendingFocus: targetPageId !== "post",
        });
      });

      // ⑧ 淡入
      content.style.transform = "translateY(12px)";
      void content.offsetHeight;
      content.style.transition = "opacity 0.25s ease, transform 0.25s var(--transition-smooth)";
      content.style.opacity = "1";
      content.style.transform = "translateY(0)";

      setTimeout(() => {
        content.style.transition = "";
        content.style.opacity = "";
        content.style.transform = "";
      }, 300);

    } catch (err) {
      if (err?.name === "AbortError" || currentToken !== navigationToken) {
        return;
      }
      console.error("SPA navigation failed, falling back:", err);
      window.location.href = targetRouteKey;
      return;
    } finally {
      if (currentToken === navigationToken) {
        activeNavigationController = null;
        PageProgress.finish();
      }
    }
  }

  // 拦截站内链接点击
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }

    const target = e.target;
    if (!(target instanceof Element)) return;

    const link = target.closest("a");
    if (!link || !link.href || link.target === "_blank" || link.hasAttribute("download")) return;

    const u = resolveUrl(link.href);
    const c = resolveUrl(window.location.href);
    if (u.origin !== c.origin) return;
    if (u.pathname === c.pathname && u.search === c.search && u.hash) return;

    e.preventDefault();
    navigate(u.href);
  });

  // 浏览器前进/后退
  window.addEventListener("popstate", () => navigate(window.location.href, false));

  // 悬停预取页面 HTML + Notion 数据
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch" || !canWarmResources()) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const link = target.closest("a");
    if (link && link.href && link.href.startsWith(window.location.origin)) {
      warmPage(link.href);
    }
    // Notion 数据预加载
    const hoveredCard = getBlogCardLink(target);
    if (hoveredCard && hoveredCard.href) {
      warmPostDetail(hoveredCard);
    }
  }, {
    passive: true,
  });

  document.addEventListener("pointerdown", (e) => {
    if (!canWarmResources()) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const pressedCard = getBlogCardLink(target);
    if (pressedCard && pressedCard.href) {
      warmPostDetail(pressedCard);
    }
  }, {
    passive: true,
  });

  document.addEventListener("focusin", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const link = target.closest("a");
    if (link && link.href && link.href.startsWith(window.location.origin)) {
      warmPage(link.href);
    }

    const focusedCard = getBlogCardLink(target);
    if (focusedCard && focusedCard.href) {
      warmPostDetail(focusedCard);
    }
  });

  history.replaceState(null, "", window.location.href);
  return { navigate };
})();
window.SPARouter = SPARouter;
