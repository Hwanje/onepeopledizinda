import { h, roster, esc, pad, nodeOf } from './common.js';

export const roulette = {
  id: 'roulette',
  name: '러시안 룰렛',
  tag: 'RUSSIAN ROULETTE',
  line: '여섯 개의 약실, 한 발의 실탄.',
  rule: '리볼버가 차례대로 돈다. 방아쇠를 당기거나, 한 번에 한해 탄창을 다시 돌리고 당길 수 있다.',

  async run(c) {
    const order = c.shuffle(c.alive());
    let bullet = c.rand(6);
    let sinceSpin = 0;
    const spun = [];
    c.set({ order, holder: null, shots: 0, sinceSpin: 0, spun: [], phase: 'load' });
    c.caption('실탄 한 발을 장전합니다');
    await c.sleep(900);
    c.emit('load');
    await c.sleep(1100);
    c.caption('탄창을 돌립니다');
    c.emit('spin');
    await c.sleep(2200);
    let k = 0;
    for (;;) {
      const holder = order[k % order.length];
      c.set({ holder, phase: 'aim', sinceSpin });
      c.caption(`${c.name(holder)}의 차례`);
      c.emit('pass', { holder });
      const d = await c.turn(holder, 'pull', {
        options: { canSpin: !spun.includes(holder) },
        def: () => ({ spin: false }),
        validate: (x) => !!x,
      });
      if (d && d.spin && !spun.includes(holder)) {
        spun.push(holder);
        bullet = c.rand(6);
        sinceSpin = 0;
        c.set({ spun: spun.slice(), sinceSpin, phase: 'respin' });
        c.caption(`${c.name(holder)} — 탄창을 다시 돌린다`);
        c.emit('spin');
        await c.sleep(2000);
      }
      c.set({ phase: 'pull' });
      c.caption('...');
      c.emit('tension', { holder });
      await c.sleep(1500 + c.rand(1500));
      if (sinceSpin === bullet) {
        c.emit('bang', { holder });
        await c.sleep(250);
        await c.kill(holder, '러시안 룰렛 · 실탄');
        return;
      }
      sinceSpin++;
      c.set({ sinceSpin, phase: 'click' });
      c.caption('찰칵. 빈 약실.');
      c.emit('click', { holder });
      await c.sleep(1400);
      k++;
    }
  },

  View: class {
    constructor(root, api) {
      this.api = api;
      this.rot = 0;
      this.el = h(`
        <div class="g g-roulette">
          <div class="rv-wrap">
            <svg class="rv-gun" viewBox="0 0 420 220" aria-hidden="true">
              <defs>
                <linearGradient id="rvMetal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#5b5e63"/><stop offset=".45" stop-color="#2a2c30"/><stop offset="1" stop-color="#121315"/>
                </linearGradient>
                <linearGradient id="rvGrip" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="#4a2a17"/><stop offset="1" stop-color="#1f0f07"/>
                </linearGradient>
              </defs>
              <rect x="190" y="64" width="200" height="22" rx="3" fill="url(#rvMetal)"/>
              <rect x="190" y="86" width="150" height="10" rx="2" fill="#1b1c1f"/>
              <rect x="372" y="56" width="8" height="10" fill="#2a2c30"/>
              <path d="M98 56 L200 56 L206 112 L150 122 L126 140 L104 120 Z" fill="url(#rvMetal)"/>
              <rect class="rv-cyl" x="128" y="60" width="66" height="54" rx="8" fill="#2f3135" stroke="#0c0c0d" stroke-width="2"/>
              <line x1="140" y1="64" x2="140" y2="110" stroke="#18191b" stroke-width="3"/>
              <line x1="161" y1="64" x2="161" y2="110" stroke="#18191b" stroke-width="3"/>
              <line x1="182" y1="64" x2="182" y2="110" stroke="#18191b" stroke-width="3"/>
              <path class="rv-hammer" d="M96 58 L84 38 L94 34 L110 56 Z" fill="#26282b"/>
              <path d="M124 124 Q132 168 168 150 L164 140 Q140 152 136 124 Z" fill="#1d1e21"/>
              <path class="rv-trigger" d="M140 122 Q146 140 154 142 L152 132 Q148 128 148 122 Z" fill="#46494e"/>
              <path d="M104 118 L126 138 L100 210 Q70 216 52 200 L74 120 Z" fill="url(#rvGrip)"/>
              <path d="M78 140 L92 144 M74 156 L88 160 M70 172 L84 176" stroke="#120804" stroke-width="2"/>
              <circle class="rv-muzzle" cx="392" cy="75" r="0" fill="#fff6c9"/>
            </svg>
            <div class="rv-cylinder">
              <svg viewBox="-100 -100 200 200" aria-hidden="true">
                <circle r="92" fill="#1e1f22" stroke="#3c3e43" stroke-width="4"/>
                <circle r="18" fill="#0d0d0e" stroke="#3c3e43" stroke-width="3"/>
                <g class="rv-chambers"></g>
              </svg>
              <div class="rv-pin"></div>
            </div>
          </div>
          <div class="g-readout">
            <div class="ro-label">이번 격발 확률</div>
            <div class="ro-value rv-odds">1 / 6</div>
          </div>
          <div class="g-holder"></div>
          <div class="g-actions"></div>
          <div class="g-roster"></div>
        </div>`);
      root.appendChild(this.el);
      this.cyl = this.el.querySelector('.rv-cylinder svg');
      const ch = this.el.querySelector('.rv-chambers');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        ch.insertAdjacentHTML('beforeend', `<circle class="rv-ch" data-i="${i}" cx="${Math.cos(a) * 58}" cy="${Math.sin(a) * 58}" r="22"/>`);
      }
    }

    update(S) {
      const g = S.game;
      const api = this.api;
      if (!g.order) return;
      roster(this.el.querySelector('.g-roster'), api, g.order, { active: g.holder, marks: Object.fromEntries((g.spun || []).map((id) => [id, '회전 사용'])) });
      const left = Math.max(1, 6 - (g.sinceSpin || 0));
      this.el.querySelector('.rv-odds').textContent = `1 / ${left}`;
      this.el.querySelector('.rv-odds').classList.toggle('hot', left <= 2);
      this.el.querySelectorAll('.rv-ch').forEach((c, i) => c.classList.toggle('spent', i < (g.sinceSpin || 0)));
      const p = api.player(g.holder);
      this.el.querySelector('.g-holder').innerHTML = p
        ? `<span class="gh-k">총을 쥔 자</span><span class="gh-n">${pad(p.num)}</span><span class="gh-name">${esc(p.name)}</span>`
        : '';
      const A = this.el.querySelector('.g-actions');
      if (api.canAct('pull')) {
        const canSpin = S.turn.options && S.turn.options.canSpin;
        const key = 'pull' + S.turn.id + canSpin;
        if (A._k !== key) {
          A._k = key;
          A.innerHTML = `<button class="btn btn-blood btn-big" data-a="pull">방아쇠를 당긴다</button>${canSpin ? '<button class="btn btn-ghost" data-a="spin">탄창을 다시 돌리고 당긴다</button>' : ''}`;
          A.querySelector('[data-a=pull]').onclick = () => { api.act('pull', { spin: false }); A.innerHTML = ''; A._k = null; };
          const s = A.querySelector('[data-a=spin]');
          if (s) s.onclick = () => { api.act('pull', { spin: true }); A.innerHTML = ''; A._k = null; };
        }
      } else if (A._k) { A.innerHTML = ''; A._k = null; }
    }

    event(ev) {
      const { sfx, fx, heart } = this.api;
      const gun = this.el.querySelector('.rv-gun');
      switch (ev.type) {
        case 'load':
          sfx.load();
          this.el.querySelector('.rv-ch[data-i="0"]').classList.add('loaded');
          setTimeout(() => this.el.querySelector('.rv-ch[data-i="0"]')?.classList.remove('loaded'), 900);
          break;
        case 'spin':
          sfx.spin(1.8);
          this.rot += 360 * 3 + Math.floor(Math.random() * 6) * 60;
          this.cyl.style.transition = 'transform 1.9s cubic-bezier(.15,.9,.3,1)';
          this.cyl.style.transform = `rotate(${this.rot}deg)`;
          break;
        case 'pass':
          sfx.cock();
          gun.classList.remove('aim');
          void gun.offsetWidth;
          gun.classList.add('aim');
          break;
        case 'tension':
          heart(130);
          gun.classList.add('shiver');
          break;
        case 'click': {
          heart(0);
          gun.classList.remove('shiver');
          sfx.click();
          this.rot += 60;
          this.cyl.style.transition = 'transform .25s ease-out';
          this.cyl.style.transform = `rotate(${this.rot}deg)`;
          gun.classList.add('recoil-dry');
          setTimeout(() => gun.classList.remove('recoil-dry'), 300);
          setTimeout(() => sfx.sigh(), 400);
          break;
        }
        case 'bang': {
          heart(0);
          gun.classList.remove('shiver');
          sfx.gunshot();
          fx.flash('#fff', 90);
          fx.shake(2.2, 900);
          const m = this.el.querySelector('.rv-muzzle');
          m.setAttribute('r', '40');
          setTimeout(() => m.setAttribute('r', '0'), 90);
          gun.classList.add('recoil');
          const r = this.el.querySelector('.rv-muzzle').getBoundingClientRect();
          fx.burst(r.left, r.top, { count: 50, speed: 12, colors: ['#fff6c9', '#ffb347', '#ff5a1f'] });
          const n = nodeOf(this.el, ev.data.holder);
          const c = fx.centerOf(n || this.el.querySelector('.g-holder'));
          fx.blood(c.x, c.y, 1.3);
          break;
        }
      }
    }

    destroy() { this.api.heart(0); this.el.remove(); }
  },
};
