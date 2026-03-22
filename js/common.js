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

function getParticleCount() {
  const viewportWidth = Math.max(
    window.innerWidth || 0,
    document.documentElement.clientWidth || 0,
  );
  const viewportHeight = Math.max(
    window.innerHeight || 0,
    document.documentElement.clientHeight || 0,
  );
  const area = viewportWidth * viewportHeight;

  if (viewportWidth < 768) {
    return Math.min(140, Math.max(90, Math.round(area / 5200)));
  }

  if (viewportWidth < 1600) {
    return Math.min(320, Math.max(220, Math.round(area / 5200)));
  }

  return Math.min(420, Math.max(320, Math.round(area / 5000)));
}

let particleCount = getParticleCount();
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
    out.pSize = Math.max(0.35, this.size * perspective * 1.9);
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
const reducedMotionQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

function prefersReducedMotion() {
  return Boolean(reducedMotionQuery?.matches);
}

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

  const activeParticleCount = Math.min(particleCount, particles.length, drawPool.length);
  for (let i = 0; i < activeParticleCount; i++) {
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
  if (!ctx || prefersReducedMotion()) return;

  try {
    drawParticlesFrame(true);
  } catch (error) {
    console.error("Particle animation error:", error);
    stopParticles();
    particlesBootstrapped = false;
    return;
  }

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
  if (prefersReducedMotion()) {
    return true;
  }
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
    // Update particle count on resize in case of orientation change
    const newCount = getParticleCount();
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

if (reducedMotionQuery) {
  const handleReducedMotionChange = () => {
    if (reducedMotionQuery.matches) {
      stopParticles();
      clearParticleBootstrapTimer();
      particlesBootstrapped = false;
      bootstrapParticles(true);
      return;
    }

    scheduleParticleBootstrap(true);
  };

  if (typeof reducedMotionQuery.addEventListener === "function") {
    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  } else if (typeof reducedMotionQuery.addListener === "function") {
    reducedMotionQuery.addListener(handleReducedMotionChange);
  }
}

/* ===== Cursor Glow, Spotlight & Parallax (merged mousemove) ===== */
const cursorGlow = document.getElementById("cursorGlow");
let mouseAF = null;

document.addEventListener("mousemove", (e) => {
  const clientX = e.clientX;
  const clientY = e.clientY;

  // Particles Parallax Offset
  if (width && height) {
    targetMouseX = (clientX - width / 2) * 2;
    targetMouseY = (clientY - height / 2) * 2;
  }

  if (mouseAF) return; // Debounce RAF
  mouseAF = requestAnimationFrame(() => {
    // Global Cursor Glow
    if (cursorGlow) {
      cursorGlow.style.transform = `translate(${clientX - 200}px, ${clientY - 200}px)`;
    }
    mouseAF = null;
  });
});

/* ===== Blog Card Reveal (reuse for blog pages) ===== */
function initBlogCardReveal() {
  const blogCards = document.querySelectorAll(".blog-card");
  if (blogCards.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const i = Number(card.dataset.revealIndex || 0);
          setTimeout(() => card.classList.add("visible"), i * 80);
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
}

// Expose for use in page scripts
window.initBlogCardReveal = initBlogCardReveal;

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
    initializeCurrentPage: () => initializePage(getPageIdFromUrl(window.location.href)),
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
  const pageCache = new Map();
  const prefetched = new Set();

  function resolveUrl(url) {
    return new URL(url, window.location.href);
  }

  function getRouteKey(url) {
    const resolved = resolveUrl(url);
    resolved.hash = "";
    return resolved.href;
  }

  function getPageCacheKey(url) {
    const resolved = resolveUrl(url);
    resolved.hash = "";

    if (PageRuntime.getPageIdFromUrl(resolved.href)) {
      resolved.search = "";
    }

    return resolved.href;
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
    const cachedHtml = pageCache.get(cacheKey);
    if (cachedHtml) return cachedHtml;

    const response = await fetch(routeKey, {
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    pageCache.set(cacheKey, html);
    return html;
  }

  function warmPage(url) {
    const cacheKey = getPageCacheKey(url);
    if (prefetched.has(cacheKey) || pageCache.has(cacheKey)) return;

    prefetched.add(cacheKey);
    fetchPageHtml(url).catch(() => {
      prefetched.delete(cacheKey);
    });
  }

  function warmPostDetail(link) {
    if (!link?.href || !link.href.startsWith(window.location.origin)) return;
    if (link.dataset.preloaded === "true") return;

    const id = new URL(link.href).searchParams.get("id");
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

    const targetPageId = PageRuntime.getPageIdFromUrl(targetRouteKey);
    const currentToken = ++navigationToken;

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
      document.title = doc.title || "Share Everything";
      const nd = doc.querySelector('meta[name="description"]');
      const cd = document.querySelector('meta[name="description"]');
      if (nd && cd) cd.content = nd.content;

      // ⑤ 替换内容
      content.innerHTML = newContent.innerHTML;

      // 禁用内部的入场动画（避免与 SPA 过渡重叠）
      content.querySelectorAll(".page-transition-wrapper").forEach(el => el.style.animation = "none");
      content.querySelectorAll(".top-actions").forEach(el => {
        el.style.animation = "none";
        el.style.opacity = "1";
        el.style.transform = "none";
      });

      PageRuntime.initializePage(targetPageId);

      // ⑦ 滚动到顶部
      window.scrollTo({ top: 0, behavior: "auto" });

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
      }
    }
  }

  // 拦截站内链接点击
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }

    const link = e.target.closest("a");
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
  document.addEventListener("mouseover", (e) => {
    const link = e.target.closest("a");
    if (link && link.href && link.href.startsWith(window.location.origin)) {
      warmPage(link.href);
    }
    // Notion 数据预加载
    const card = e.target.closest("a.blog-card");
    if (card && card.href) {
      warmPostDetail(card);
    }
  });

  document.addEventListener("pointerdown", (e) => {
    const card = e.target.closest("a.blog-card");
    if (card && card.href) {
      warmPostDetail(card);
    }
  }, {
    passive: true,
  });

  document.addEventListener("focusin", (e) => {
    const link = e.target.closest?.("a");
    if (link && link.href && link.href.startsWith(window.location.origin)) {
      warmPage(link.href);
    }
  });

  history.replaceState(null, "", window.location.href);
  return { navigate };
})();
window.SPARouter = SPARouter;
