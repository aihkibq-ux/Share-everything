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

// Reusable draw-data objects to reduce GC pressure
let drawPool = Array.from({ length: particleCount }, () => ({
  px: 0,
  py: 0,
  pSize: 0,
  opacity: 0,
  color: "",
}));

const bucketKeys = colors;
let bucketArrays = {};
let bucketCounts = {};
bucketKeys.forEach((c) => {
  bucketArrays[c] = Array(particleCount);
  bucketCounts[c] = 0;
});

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
    // Update particle count on resize in case of orientation change
    const newCount = window.innerWidth < 768 ? 120 : 350;
    if (newCount !== particleCount) {
      particleCount = newCount;
      drawPool = Array.from({ length: particleCount }, () => ({
        px: 0, py: 0, pSize: 0, opacity: 0, color: "",
      }));
      bucketKeys.forEach((c) => {
        bucketArrays[c] = Array(particleCount);
      });
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
  if (!e.target.closest(".post-content")) {
    window.getSelection()?.removeAllRanges();
  }
});

/* ===== SPA Router — 单页应用导航 ===== */
const SPARouter = (() => {
  let isNavigating = false;
  const loadedScripts = new Set();
  const pageCache = {};
  const prefetched = new Set();

  function ensureScript(src) {
    if (loadedScripts.has(src) || document.querySelector(`script[src="${src}"]`)) {
      loadedScripts.add(src);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => { loadedScripts.add(src); resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function navigate(url, pushState = true) {
    if (isNavigating) return;
    isNavigating = true;

    const content = document.getElementById("spa-content");
    if (!content) { isNavigating = false; window.location.href = url; return; }

    // ① 淡出
    content.style.transition = "opacity 0.15s ease, transform 0.15s ease";
    content.style.opacity = "0";
    content.style.transform = "translateY(-8px)";

    try {
      // ② 获取页面（优先使用缓存）
      let html = pageCache[url];
      if (!html) {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      }

      // 等淡出动画完成
      await new Promise(r => setTimeout(r, 150));

      // ③ 解析并提取内容
      const doc = new DOMParser().parseFromString(html, "text/html");
      const newContent = doc.getElementById("spa-content");
      if (!newContent) { isNavigating = false; window.location.href = url; return; }

      // 按需加载依赖脚本
      const extScripts = doc.querySelectorAll('script[src]:not([src*="common"])');
      for (const s of extScripts) await ensureScript(s.getAttribute('src'));

      // ④ 先更新 URL（让页面脚本能读到正确的 location）
      if (pushState) history.pushState(null, "", url);

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

      const inlineScripts = doc.querySelectorAll("script:not([src])");
      inlineScripts.forEach(s => {
        const code = s.textContent || "";
        if (!code.trim()) return;
        // 跳过 common.js 相关定义脚本
        if (code.includes("const SPARouter") || code.includes("class Particle")) return;
        try {
          const el = document.createElement("script");
          el.textContent = `(function(){${code}})()`;
          document.body.appendChild(el);
          el.remove(); // 执行后清理 DOM 节点
        } catch (e) {
          console.error("SPA script execution error:", e);
        }
      });

      // ⑦ 滚动到顶部
      window.scrollTo({ top: 0, behavior: "auto" });

      // 尽早解锁，允许下一次导航
      isNavigating = false;

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
      console.error("SPA navigation failed, falling back:", err);
      isNavigating = false;
      window.location.href = url;
      return;
    } finally {
      isNavigating = false;
    }
  }

  // 拦截站内链接点击
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link || !link.href || link.target === "_blank") return;
    if (!link.href.startsWith(window.location.origin)) return;
    const u = new URL(link.href), c = new URL(window.location.href);
    if (u.pathname === c.pathname && u.search === c.search && u.hash) return;
    e.preventDefault();
    navigate(link.href);
  });

  // 浏览器前进/后退
  window.addEventListener("popstate", () => navigate(window.location.href, false));

  // 悬停预取页面 HTML + Notion 数据
  document.addEventListener("mouseover", (e) => {
    const link = e.target.closest("a");
    if (link && link.href && link.href.startsWith(window.location.origin) && !prefetched.has(link.href)) {
      prefetched.add(link.href);
      fetch(link.href).then(r => r.text()).then(h => { pageCache[link.href] = h; }).catch(() => {});
    }
    // Notion 数据预加载
    const card = e.target.closest("a.blog-card");
    if (card && card.href && !card.dataset.preloaded) {
      card.dataset.preloaded = "true";
      const id = new URL(card.href).searchParams.get("id");
      if (id && window.NotionAPI && NotionAPI.getPost) NotionAPI.getPost(id).catch(() => {});
    }
  });

  history.replaceState(null, "", window.location.href);
  return { navigate };
})();
window.SPARouter = SPARouter;
