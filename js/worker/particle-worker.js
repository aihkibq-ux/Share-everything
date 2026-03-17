/**
 * particle-worker.js — OffscreenCanvas 粒子渲染引擎
 */

let canvas, ctx;
let width = 0, height = 0;
let particles = [];
let rafId = null;

let mouseX = 0, mouseY = 0;
let targetMouseX = 0, targetMouseY = 0;

let particleCount = 600;
let isMobile = false;

const colors = [
  "rgba(0, 255, 255, 1)",
  "rgba(77, 159, 255, 0.9)",
  "rgba(224, 64, 251, 0.85)",
  "rgba(255, 64, 129, 0.8)",
  "rgba(255, 255, 255, 0.6)",
];

class Particle {
  constructor() {
    this.spawn(false);
  }

  spawn(isRespawn) {
    this.x = (Math.random() - 0.5) * width * (isRespawn ? 1.5 : 2) + width / 2;
    this.y = (Math.random() - 0.5) * height * (isRespawn ? 1.5 : 2) + height / 2;
    this.z = isRespawn ? 2000 + Math.random() * 500 : Math.random() * 2000 + 100;
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

let drawPool = [];
let bucketKeys = colors;
let bucketArrays = {};
let bucketCounts = {};
let speedMultiplier = 1;
let targetSpeedMultiplier = 1;
let isPaused = false;

function initParticles() {
  particles = [];
  drawPool = Array.from({ length: particleCount }, () => ({
    px: 0, py: 0, pSize: 0, opacity: 0, color: "",
  }));
  
  bucketArrays = {};
  bucketCounts = {};
  bucketKeys.forEach((c) => {
    bucketArrays[c] = Array(particleCount);
    bucketCounts[c] = 0;
  });

  for (let i = 0; i < particleCount; i++) particles.push(new Particle());
}

function animateParticles() {
  if (!ctx) return;
  if (isPaused) {
    rafId = requestAnimationFrame(animateParticles);
    return;
  }
  
  ctx.clearRect(0, 0, width, height);
  mouseX += (targetMouseX - mouseX) * 0.05;
  mouseY += (targetMouseY - mouseY) * 0.05;
  speedMultiplier += (targetSpeedMultiplier - speedMultiplier) * 0.08;

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

// 接收主线程消息
self.onmessage = function (e) {
  const data = e.data;
  switch (data.type) {
    case 'init':
      canvas = data.canvas;
      ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
      width = data.width;
      height = data.height;
      isMobile = data.isMobile;
      particleCount = isMobile ? 200 : 600;
      initParticles();
      if (!rafId) rafId = requestAnimationFrame(animateParticles);
      break;

    case 'resize':
      width = data.width;
      height = data.height;
      isMobile = data.isMobile;
      const newCount = isMobile ? 200 : 600;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
      }
      if (newCount !== particleCount) {
        particleCount = newCount;
        initParticles();
      }
      break;

    case 'mousemove':
      targetMouseX = data.mouseX;
      targetMouseY = data.mouseY;
      break;

    case 'speed':
      targetSpeedMultiplier = data.speed;
      break;

    case 'pause':
      isPaused = data.isPaused;
      break;
  }
};
