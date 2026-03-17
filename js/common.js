/**
 * common.js — 共享交互逻辑
 * 粒子星空、光标跟随、卡片聚光灯、滚动揭示
 */

/* ===== Particles (OffscreenCanvas with Visibility / Intersection Observer) ===== */
const canvas = document.getElementById("particles-canvas");
let worker = null;
let isOffscreenSupported = false;

function resizeCanvas(isMobile) {
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
}

function initParticleSystem() {
  if (!canvas) return;
  
  // Detect OffscreenCanvas support
  isOffscreenSupported = 'transferControlToOffscreen' in canvas;

  if (isOffscreenSupported) {
    try {
      resizeCanvas(window.innerWidth < 768);
      
      const offscreen = canvas.transferControlToOffscreen();
      worker = new Worker('js/worker/particle-worker.js');
      
      const isMobile = window.innerWidth < 768;
      worker.postMessage({
        type: 'init',
        canvas: offscreen,
        width: window.innerWidth,
        height: window.innerHeight,
        isMobile: isMobile
      }, [offscreen]);

      // Handle Resize
      let resizeTimer = null;
      window.addEventListener("resize", () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          worker.postMessage({
            type: 'resize',
            width: window.innerWidth,
            height: window.innerHeight,
            isMobile: window.innerWidth < 768
          });
        }, 300);
      });

      // Handle hyper-drive speed
      const updateSpeed = (speed) => worker.postMessage({ type: 'speed', speed });
      window.addEventListener("mousedown", () => updateSpeed(20));
      window.addEventListener("mouseup", () => updateSpeed(1));
      window.addEventListener("mouseleave", () => updateSpeed(1));
      window.addEventListener("touchstart", () => updateSpeed(20));
      window.addEventListener("touchend", () => updateSpeed(1));

    } catch (e) {
      console.warn("OffscreenCanvas failed to initialize, worker fallback not implemented.", e);
    }
  } else {
    console.warn("OffscreenCanvas not supported by this browser.");
  }

  // --- Intersection Observer & Page Visibility Throttling ---
  // Pause animation when canvas is not visible or tab is backgrounded
  const pauseAnimation = (isPaused) => {
    if (worker) worker.postMessage({ type: 'pause', isPaused });
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      // isIntersecting is true when the element is visible
      pauseAnimation(!entry.isIntersecting);
    });
  }, { threshold: 0.01 });
  
  // Only observe if canvas exists
  if (canvas) observer.observe(canvas);

  document.addEventListener("visibilitychange", () => {
    pauseAnimation(document.visibilityState === 'hidden');
  });
}

initParticleSystem();

/* ===== Cursor Glow, Spotlight & Parallax (merged mousemove) ===== */
const cursorGlow = document.getElementById("cursorGlow");
let mouseAF = null;

document.addEventListener("mousemove", (e) => {
  const clientX = e.clientX;
  const clientY = e.clientY;

  if (worker) {
    worker.postMessage({
      type: 'mousemove',
      mouseX: (clientX - window.innerWidth / 2) * 2,
      mouseY: (clientY - window.innerHeight / 2) * 2
    });
  }

  if (mouseAF) return; // Debounce RAF
  mouseAF = requestAnimationFrame(() => {
    // Global Cursor Glow
    if (cursorGlow) {
      cursorGlow.style.transform = `translate3d(${clientX - 300}px, ${clientY - 300}px, 0)`;
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
