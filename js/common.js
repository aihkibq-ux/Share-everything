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
let mouseX = 0,
  mouseY = 0;
let targetMouseX = 0,
  targetMouseY = 0;

let particleCount = window.innerWidth < 768 ? 200 : 600;
const colors = [
  "rgba(0, 255, 255, 1)",
  "rgba(77, 159, 255, 0.9)",
  "rgba(224, 64, 251, 0.85)",
  "rgba(255, 64, 129, 0.8)",
  "rgba(255, 255, 255, 0.6)",
];

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }
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

function animateParticles() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  mouseX += (targetMouseX - mouseX) * 0.05;
  mouseY += (targetMouseY - mouseY) * 0.05;
  speedMultiplier += (targetSpeedMultiplier - speedMultiplier) * 0.08;

  // Reset counters for this frame
  bucketKeys.forEach((c) => (bucketCounts[c] = 0));

  for (let i = 0; i < particleCount; i++) {
    particles[i].update();
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
      ctx.beginPath();
      ctx.arc(d.px, d.py, d.pSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  rafId = requestAnimationFrame(animateParticles);
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resize();
    
    // Update particle count on resize in case of orientation change
    const newCount = window.innerWidth < 768 ? 200 : 600;
    if (newCount !== particleCount) {
      particleCount = newCount;
      drawPool = Array.from({ length: particleCount }, () => ({
        px: 0, py: 0, pSize: 0, opacity: 0, color: "",
      }));
      bucketKeys.forEach((c) => {
        bucketArrays[c] = Array(particleCount);
      });
    }

    initParticles();
    animateParticles();
  }, 300);
});

// Smooth hyper-drive burst
window.addEventListener("mousedown", () => (targetSpeedMultiplier = 20));
window.addEventListener("mouseup", () => (targetSpeedMultiplier = 1));
window.addEventListener("mouseleave", () => (targetSpeedMultiplier = 1));
window.addEventListener("touchstart", () => (targetSpeedMultiplier = 20));
window.addEventListener("touchend", () => (targetSpeedMultiplier = 1));

resize();
initParticles();
animateParticles();

/* ===== Cursor Glow, Spotlight & Parallax (merged mousemove) ===== */
const cursorGlow = document.getElementById("cursorGlow");
let mouseAF = null;

document.addEventListener("mousemove", (e) => {
  const clientX = e.clientX;
  const clientY = e.clientY;

  // Particles Parallax Offset
  targetMouseX = (clientX - width / 2) * 2;
  targetMouseY = (clientY - height / 2) * 2;

  if (mouseAF) return; // Debounce RAF
  mouseAF = requestAnimationFrame(() => {
    // Global Cursor Glow
    if (cursorGlow) {
      cursorGlow.style.transform = `translate(${clientX - 300}px, ${clientY - 300}px)`;
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
          const siblings = [...card.parentElement.children];
          const i = siblings.indexOf(card);
          setTimeout(() => card.classList.add("visible"), i * 80);
          observer.unobserve(card);
        }
      });
    },
    { threshold: 0.1 },
  );
  blogCards.forEach((el) => observer.observe(el));
}

// Expose for use in page scripts
window.initBlogCardReveal = initBlogCardReveal;

/* ===== 清除文字选区（防止蓝框残留）===== */
document.addEventListener("mousedown", (e) => {
  if (!e.target.closest(".post-content")) {
    window.getSelection()?.removeAllRanges();
  }
});

/* ===== 路由跳转平滑动画 & 预加载 ===== */
document.addEventListener("DOMContentLoaded", () => {
  // 1. 拦截站内链接，添加淡出动画
  document.body.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link || !link.href) return;
    
    // 只拦截当前域名的内部链接，且不是新标签页
    if (link.target !== "_blank" && link.href.startsWith(window.location.origin)) {
      // 忽略仅 hash 的变化 (锚点)
      const url = new URL(link.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash !== window.location.hash) {
        return; 
      }
      
      e.preventDefault();
      const wrapper = document.getElementById("pageWrapper");
      if (wrapper) {
        wrapper.classList.add("page-fade-out");
      } else {
        document.body.classList.add("page-fade-out"); // fallback
      }
      setTimeout(() => {
        window.location.href = link.href;
      }, 350); // 与 CSS 动画时长匹配
    }
  });

  // 2. 鼠标悬停文章卡片时自动预加载数据
  document.body.addEventListener("mouseover", (e) => {
    const card = e.target.closest("a.blog-card");
    if (card && card.href) {
      if (!card.dataset.preloaded) {
        card.dataset.preloaded = "true";
        const url = new URL(card.href);
        const id = url.searchParams.get("id");
        if (id && window.NotionAPI && NotionAPI.getPost) {
          // 静默预压入 sessionStorage 缓存中
          NotionAPI.getPost(id).catch(() => {});
        }
      }
    }
  });
});
