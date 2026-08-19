
async function apiCall(url, options = {}) {
  const opts = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    ...options,
  };
  if (opts.body && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = { ok: false, error: "Unexpected server response" };
  }
  if (!res.ok && data.ok === undefined) data.ok = false;
  return data;
}


function ensureToastContainer() {
  let c = document.querySelector(".toast-container");
  if (!c) {
    c = document.createElement("div");
    c.className = "toast-container";
    document.body.appendChild(c);
  }
  return c;
}

const TOAST_ICONS = { success: "✓", error: "✕", info: "ℹ", warning: "⚠" };
const TOAST_TITLES = { success: "Success", error: "Error", info: "Notice", warning: "Warning" };

function showToast(message, type = "info", title = null) {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${TOAST_ICONS[type] || "ℹ"}</div>
    <div>
      <div class="toast-title">${title || TOAST_TITLES[type] || "Notice"}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 400);
  }, 4200);
}
window.showToast = showToast;


function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}
window.openModal = openModal;
window.closeModal = closeModal;

document.addEventListener("click", (e) => {
  if (e.target.classList && e.target.classList.contains("modal-overlay")) {
    e.target.classList.remove("open");
    document.body.style.overflow = "";
  }
  if (e.target.closest && e.target.closest("[data-close-modal]")) {
    const overlay = e.target.closest(".modal-overlay");
    if (overlay) {
      overlay.classList.remove("open");
      document.body.style.overflow = "";
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.open").forEach((o) => o.classList.remove("open"));
    document.body.style.overflow = "";
  }
});

// ---------- Button loading / ripple ----------
function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}
window.setButtonLoading = setButtonLoading;

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn");
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement("span");
  const size = Math.max(rect.width, rect.height);
  ripple.className = "ripple";
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
});


function initFloatingLabels(scope = document) {
  scope.querySelectorAll(".field input, .field textarea").forEach((el) => {
    if (!el.placeholder) el.placeholder = " ";
    const sync = () => {
      const field = el.closest(".field");
      if (el.value) field.classList.add("has-value");
      else field.classList.remove("has-value");
    };
    el.addEventListener("input", sync);
    sync();
  });
}

function initPasswordToggles(scope = document) {
  scope.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
    const input = document.getElementById(toggle.getAttribute("data-password-toggle"));
    if (!input) return;
    toggle.addEventListener("click", () => {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      toggle.textContent = visible ? "Show" : "Hide";
      toggle.setAttribute("aria-label", `${visible ? "Show" : "Hide"} password`);
    });
  });
}

function fieldError(fieldEl, message) {
  fieldEl.classList.add("error");
  fieldEl.classList.remove("success");
  const hint = fieldEl.querySelector(".field-hint");
  if (hint) hint.textContent = message || "";
  setTimeout(() => fieldEl.classList.remove("error"), 450);
}
function fieldSuccess(fieldEl) {
  fieldEl.classList.remove("error");
  fieldEl.classList.add("success");
  const hint = fieldEl.querySelector(".field-hint");
  if (hint) hint.textContent = "";
}
window.fieldError = fieldError;
window.fieldSuccess = fieldSuccess;


function initNavbar() {
  const nav = document.querySelector(".navbar");
  if (!nav) return;
  const onScroll = () => {
    if (window.scrollY > 24) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const hamburger = document.querySelector(".hamburger");
  const links = document.querySelector(".nav-links");
  if (hamburger && links) {
    hamburger.addEventListener("click", () => {
      hamburger.classList.toggle("open");
      links.classList.toggle("mobile-open");
      hamburger.setAttribute("aria-expanded", hamburger.classList.contains("open"));
    });
    links.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
      hamburger.classList.remove("open");
      links.classList.remove("mobile-open");
      hamburger.setAttribute("aria-expanded", "false");
    }));
  }
}

function initSharedChrome() {
  const preloader = document.getElementById("preloader");
  if (preloader) window.addEventListener("load", () => setTimeout(() => preloader.classList.add("loaded"), 260), { once: true });
  const progress = document.getElementById("scrollProgress");
  const backToTop = document.getElementById("backToTop");
  const updateScroll = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = `${scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0}%`;
    if (backToTop) backToTop.classList.toggle("visible", window.scrollY > 420);
  };
  window.addEventListener("scroll", updateScroll, { passive: true });
  updateScroll();
  if (backToTop) backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}


function initReveal() {
  const els = document.querySelectorAll("[data-reveal]");
  if (!els.length) return;
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const delay = entry.target.getAttribute("data-reveal-delay") || 0;
          setTimeout(() => entry.target.classList.add("revealed"), Number(delay));
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  els.forEach((el) => io.observe(el));
}


function animateCounter(el, target, duration = 1200) {
  const start = 0;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = target;
  }
  requestAnimationFrame(tick);
}
function initCounters(scope = document) {
  scope.querySelectorAll(".counter[data-target]").forEach((el) => {
    const target = Number(el.getAttribute("data-target")) || 0;
    animateCounter(el, target);
  });
}
window.initCounters = initCounters;
window.animateCounter = animateCounter;

function animateProgress(el, percent) {
  requestAnimationFrame(() => {
    el.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
  });
}
window.animateProgress = animateProgress;


function initParticles() {
  const canvas = document.getElementById("particle-canvas");
  if (!canvas) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  let particles = [];
  let w, h;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const count = window.innerWidth < 720 ? 26 : 55;
  const colors = ["#6366f1", "#06b6d4", "#a855f7", "#ec4899"];

  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.6 + 0.6,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      color: colors[i % colors.length],
      alpha: Math.random() * 0.5 + 0.2,
    });
  }

  if (reduceMotion) {
    ctx.clearRect(0, 0, w, h);
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.arc(p.x, p.y, p.r * 1.5, 0, Math.PI * 2);
      ctx.fill();
    });
    return;
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}


document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  initSharedChrome();
  initReveal();
  initParticles();
  initCounters();
  initFloatingLabels();
  initPasswordToggles();
});
