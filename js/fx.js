// 화면 효과: 섬광, 흔들림, 피, 파편

const $ = (s) => document.querySelector(s);
let parts = [];
let pcv, pctx, bcv, bctx, raf = null;

export function initFx() {
  pcv = $('#fx-particles');
  bcv = $('#fx-blood');
  pctx = pcv.getContext('2d');
  bctx = bcv.getContext('2d');
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [pcv, bcv]) {
      const snap = c === bcv && c.width ? c.toDataURL() : null;
      c.width = innerWidth * dpr;
      c.height = innerHeight * dpr;
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      if (snap) {
        const img = new Image();
        img.onload = () => bctx.drawImage(img, 0, 0, innerWidth, innerHeight);
        img.src = snap;
      }
    }
  };
  fit();
  addEventListener('resize', fit);
}

export function flash(color = '#fff', ms = 120) {
  const el = $('#fx-flash');
  el.style.transition = 'none';
  el.style.background = color;
  el.style.opacity = '1';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${ms * 4}ms ease-out`;
      el.style.opacity = '0';
    });
  });
}

export function shake(power = 1, ms = 600) {
  const el = $('#app');
  el.style.setProperty('--shake', `${power * 14}px`);
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  clearTimeout(el._sk);
  el._sk = setTimeout(() => el.classList.remove('shake'), ms);
}

export function glitch(ms = 500) {
  document.body.classList.add('glitching');
  clearTimeout(document.body._gl);
  document.body._gl = setTimeout(() => document.body.classList.remove('glitching'), ms);
}

// 피 튀김: 캔버스에 남는 자국
export function blood(x = innerWidth / 2, y = innerHeight / 2, amount = 1) {
  const ctx = bctx;
  const reds = ['#5c0008', '#7a000b', '#8f0712', '#a3000f', '#3d0005'];
  const blobs = Math.round(40 * amount);
  ctx.save();
  // 중심 덩어리
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = reds[i % reds.length];
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    const r = 20 + Math.random() * 50 * amount;
    ctx.ellipse(x + rnd(30), y + rnd(30), r, r * (0.6 + Math.random() * 0.5), Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < blobs; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.pow(Math.random(), 0.6) * 380 * amount;
    const bx = x + Math.cos(ang) * dist;
    const by = y + Math.sin(ang) * dist;
    const r = Math.max(1.5, (1 - dist / (420 * amount)) * 14 * Math.random() + 1);
    ctx.fillStyle = reds[(Math.random() * reds.length) | 0];
    ctx.globalAlpha = 0.75 + Math.random() * 0.25;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    // 흐르는 자국
    if (Math.random() < 0.18) {
      const len = 30 + Math.random() * 160;
      ctx.fillRect(bx - r * 0.35, by, r * 0.7, len);
      ctx.beginPath();
      ctx.arc(bx, by + len, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    // 방사형 줄기
    if (Math.random() < 0.12) {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
  ctx.restore();
  bcv.classList.add('show');
}

export function clearBlood(fade = true) {
  if (!bctx) return;
  if (!fade) {
    bctx.clearRect(0, 0, innerWidth, innerHeight);
    return;
  }
  bcv.classList.remove('show');
  setTimeout(() => {
    if (!bcv.classList.contains('show')) bctx.clearRect(0, 0, innerWidth, innerHeight);
  }, 1600);
}

function rnd(n) { return (Math.random() * 2 - 1) * n; }

// 파편/불꽃
export function burst(x, y, { count = 60, colors = ['#ffcf70', '#ff6a00', '#ff2a00', '#fff'], speed = 9, gravity = 0.25, life = 60, size = 3 } = {}) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = Math.random() * speed;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.2, g: gravity, life: life * (0.5 + Math.random() * 0.5), max: life, c: colors[(Math.random() * colors.length) | 0], s: size * (0.5 + Math.random()) });
  }
  if (!raf) loop();
}

export function shards(x, y, w, h) {
  for (let i = 0; i < 40; i++) {
    parts.push({
      x: x + Math.random() * w, y: y + Math.random() * h,
      vx: rnd(3), vy: -Math.random() * 3, g: 0.4, life: 80, max: 80,
      c: Math.random() < 0.5 ? 'rgba(180,230,255,.9)' : 'rgba(255,255,255,.8)',
      s: 2 + Math.random() * 6, poly: true, rot: Math.random() * 6, vr: rnd(0.3),
    });
  }
  if (!raf) loop();
}

function loop() {
  pctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.985; p.life--;
    pctx.globalAlpha = Math.max(0, p.life / p.max);
    pctx.fillStyle = p.c;
    if (p.poly) {
      p.rot += p.vr;
      pctx.save();
      pctx.translate(p.x, p.y);
      pctx.rotate(p.rot);
      pctx.beginPath();
      pctx.moveTo(0, -p.s);
      pctx.lineTo(p.s * 0.8, p.s * 0.6);
      pctx.lineTo(-p.s * 0.6, p.s * 0.4);
      pctx.closePath();
      pctx.fill();
      pctx.restore();
    } else {
      pctx.fillRect(p.x, p.y, p.s, p.s);
    }
  }
  pctx.globalAlpha = 1;
  raf = parts.length ? requestAnimationFrame(loop) : (pctx.clearRect(0, 0, innerWidth, innerHeight), null);
}

export function centerOf(el) {
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
