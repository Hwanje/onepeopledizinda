import { h, esc, pad, nodeOf } from './common.js';

const HOLD = 6000;
const MIN_HOLD = 700;

export const bomb = {
  id: 'bomb',
  name: '시한폭탄',
  tag: 'TIME BOMB',
  line: '타이머는 보이지 않는다. 넘겨라.',
  rule: '폭탄을 받으면 다른 사람을 골라 넘긴다. 6초 안에 못 넘기면 아무에게나 넘어간다. 터지는 순간 들고 있던 사람이 죽는다.',

  async run(c) {
    const ids = c.alive();
    let holder = ids[c.rand(ids.length)];
    const fuse = 16000 + c.rand(22000);
    c.set({ ids, holder, passes: 0, lit: false });
    c.caption('도화선에 불을 붙입니다');
    await c.sleep(1800);
    const t0 = Date.now();
    c.set({ lit: true });
    c.emit('lit', { holder });
    let passes = 0;
    for (;;) {
      const remain = fuse - (Date.now() - t0);
      if (remain <= 0) break;
      const others = ids.filter((x) => x !== holder);
      c.caption(`${c.name(holder)}의 손에`);
      const got = Date.now();
      const d = await c.turn(holder, 'pass', {
        ms: Math.min(HOLD, remain),
        options: others,
        def: () => null,
        validate: (x) => x && others.includes(x.target),
      });
      const held = Date.now() - got;
      if (held < MIN_HOLD) await c.sleep(MIN_HOLD - held);
      if (Date.now() - t0 >= fuse) break;
      const to = d ? d.target : others[c.rand(others.length)];
      c.emit('pass', { from: holder, to, auto: !d });
      holder = to;
      passes++;
      c.set({ holder, passes });
      await c.sleep(380);
    }
    c.caption('');
    c.emit('boom', { holder });
    await c.sleep(300);
    await c.kill(holder, '시한폭탄 · 폭사');
  },

  View: class {
    constructor(root, api) {
      this.api = api;
      this.el = h(`
        <div class="g g-bomb">
          <div class="bm-table">
            <div class="bm-ring"></div>
            <div class="bm-bomb">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <defs><radialGradient id="bmG" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#4b4b4f"/><stop offset=".6" stop-color="#151517"/><stop offset="1" stop-color="#050505"/></radialGradient></defs>
                <path class="bm-fuse" d="M78 30 Q92 12 104 18 Q114 24 108 8" fill="none" stroke="#b49a6a" stroke-width="3" stroke-dasharray="3 2"/>
                <rect x="66" y="26" width="18" height="12" rx="2" transform="rotate(35 75 32)" fill="#2b2b2e"/>
                <circle cx="56" cy="70" r="40" fill="url(#bmG)"/>
                <rect x="40" y="62" width="32" height="14" rx="2" fill="#0a0a0a" stroke="#3a0a0a"/>
                <text class="bm-led" x="56" y="73" text-anchor="middle">--:--</text>
                <circle class="bm-spark" cx="108" cy="8" r="4"/>
              </svg>
            </div>
          </div>
          <div class="g-holder"></div>
          <div class="g-actions bm-actions"></div>
        </div>`);
      root.appendChild(this.el);
      this.ring = this.el.querySelector('.bm-ring');
      this.bombEl = this.el.querySelector('.bm-bomb');
      this.ticking = null;
    }

    layout(ids) {
      const key = ids.join(',');
      if (this.ring._k === key) return;
      this.ring._k = key;
      const n = ids.length;
      this.ring.innerHTML = ids.map((id, i) => {
        const p = this.api.player(id);
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return `<div class="bm-seat" data-pid="${esc(id)}" style="left:${50 + Math.cos(a) * 42}%;top:${50 + Math.sin(a) * 42}%"><b>${pad(p.num)}</b><span>${esc(p.name)}</span></div>`;
      }).join('');
    }

    moveBomb(id) {
      const seat = nodeOf(this.ring, id);
      if (!seat) return;
      this.bombEl.style.left = seat.style.left;
      this.bombEl.style.top = seat.style.top;
      this.ring.querySelectorAll('.bm-seat').forEach((s) => s.classList.toggle('has', s === seat));
    }

    update(S) {
      const g = S.game;
      const api = this.api;
      if (!g.ids) return;
      this.layout(g.ids);
      this.moveBomb(g.holder);
      if (g.lit && !this.ticking && !this.boomed) { this.el.classList.add('lit'); this.startTicking(); }
      this.ring.querySelectorAll('.bm-seat').forEach((s) => {
        const p = api.player(s.dataset.pid);
        s.classList.toggle('is-dead', !!p && !p.alive);
        s.classList.toggle('is-me', s.dataset.pid === api.me);
      });
      const p = api.player(g.holder);
      this.el.querySelector('.g-holder').innerHTML = p
        ? `<span class="gh-k">폭탄을 든 자</span><span class="gh-n">${pad(p.num)}</span><span class="gh-name">${esc(p.name)}</span><span class="gh-k">넘긴 횟수 ${g.passes}</span>`
        : '';
      const A = this.el.querySelector('.g-actions');
      if (api.canAct('pass') && g.lit) {
        const key = 'pass' + S.turn.id;
        if (A._k !== key) {
          A._k = key;
          A.innerHTML = `<div class="bm-hint">누구에게 넘길까</div>` + S.turn.options.map((id) => {
            const q = api.player(id);
            return `<button class="btn btn-ghost" data-t="${esc(id)}"><b>${pad(q.num)}</b> ${esc(q.name)}</button>`;
          }).join('');
          A.querySelectorAll('button').forEach((b) => (b.onclick = () => { api.act('pass', { target: b.dataset.t }); A.innerHTML = ''; A._k = null; }));
          if (api.player(g.holder) && g.holder === api.me) api.fx.glitch(200);
        }
      } else if (A._k) { A.innerHTML = ''; A._k = null; }
    }

    startTicking() {
      const t0 = performance.now();
      const led = this.el.querySelector('.bm-led');
      let last = 0;
      const step = () => {
        const el = (performance.now() - t0) / 1000;
        const gap = Math.max(90, 760 - el * 24);
        this.api.sfx.clock();
        if (Math.random() < 0.5) this.api.sfx.fuse();
        this.bombEl.classList.remove('beat');
        void this.bombEl.offsetWidth;
        this.bombEl.classList.add('beat');
        // 남은 시간은 보여주지 않는다. 대신 무작위 숫자
        if (el - last > 0.3) {
          last = el;
          led.textContent = `${String((Math.random() * 99) | 0).padStart(2, '0')}:${String((Math.random() * 99) | 0).padStart(2, '0')}`;
        }
        this.ticking = setTimeout(step, gap);
      };
      step();
    }

    event(ev) {
      const { sfx, fx } = this.api;
      switch (ev.type) {
        case 'lit':
          sfx.fuse();
          sfx.alarm();
          this.el.classList.add('lit');
          if (!this.ticking) this.startTicking();
          break;
        case 'pass':
          sfx.hover();
          if (ev.data.to === this.api.me) { sfx.alarm(); fx.flash('rgba(160,0,0,.6)', 80); }
          break;
        case 'boom': {
          this.boomed = true;
          clearTimeout(this.ticking);
          sfx.explosion();
          fx.flash('#ffe2a8', 220);
          fx.shake(3, 1300);
          const c = fx.centerOf(this.bombEl);
          fx.burst(c.x, c.y, { count: 160, speed: 16, life: 80, size: 4 });
          fx.burst(c.x, c.y, { count: 60, speed: 6, colors: ['#333', '#555', '#222'], gravity: -0.05, life: 120, size: 8 });
          fx.blood(c.x, c.y, 1.6);
          this.bombEl.classList.add('gone');
          break;
        }
      }
    }

    destroy() { clearTimeout(this.ticking); this.el.remove(); }
  },
};
