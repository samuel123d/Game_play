(() => {
  let canvas = null;
  let ctx = null;
  let rafId = 0;
  let particles = [];
  let stopTimer = 0;

  const COLORS = ["#38E8D6", "#F5B841", "#34D399", "#CBD5E1", "#F4F6FB", "#60A5FA"];

  function ensureCanvas() {
    if (canvas && document.body.contains(canvas)) return canvas;
    canvas = document.createElement("canvas");
    canvas.className = "confetti-overlay";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    return canvas;
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnParticles(count = 110, fromTop = true) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: fromTop ? -20 - Math.random() * (h * 0.45) : h * 0.35 + (Math.random() - 0.5) * 80,
        vx: (Math.random() - 0.5) * 3.4,
        vy: fromTop ? 2.1 + Math.random() * 3.2 : -4 - Math.random() * 5,
        size: 6 + Math.random() * 7,
        aspect: 0.45 + Math.random() * 0.45,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.14,
        wobble: Math.random() * Math.PI * 2,
        color: COLORS[i % COLORS.length],
        alpha: 0.92
      });
    }
  }

  function loop() {
    if (!ctx || !canvas) return;
    const w = window.innerWidth