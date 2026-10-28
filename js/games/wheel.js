import { h, roster, esc, pad } from './common.js';

export const wheel = {
  id: 'wheel',
  name: '사신의 바퀴',
  tag: 'REAPER’S WHEEL',
  line: '바퀴는 공평하다. 멈춘 곳이 끝이다.',
  rule: '무작위로 뽑힌 한 명이 바퀴를 돌린다. 바늘이 가리키는 사람이 탈락한다. 자기 자신일 수도 있다.',

  async run(c) {
    const segs = c.shuffle(c.alive());
    const spinner = segs[c.rand(segs.length)];
    c.set({ segs, spinner, final: 0, dur: 0, phase: 'ready' });
    c.caption(`바퀴를 돌릴 자: ${c.name(spinner)}`);
    c.emit('chosen', { spinner });
    await c.sleep(1500);
    await c.turn(spinner, 'spin', { def: () => ({}), validate: () => true });
    const n = segs.length;
    const loser = c.rand(n);
    const seg = 360 / n;
    const jitter = ((c.rand(1000) / 1000) - 0.5) * seg * 0.76;
    const final = 360 * (7 + c.rand(3)) + (360 - (loser * seg + seg / 2 + jitter));
    const dur = 7500 + c.rand(2500);
    c.set({ phase: 'spin', final, dur });
    c.caption('돌아간다');
    c.emit('spin', { final, dur });
    await c.sleep(dur + 700);
    c.set({ phase: 'stop' });
    c.emit('stop', { id: segs[loser] });
    c.caption(`${c.name(segs[loser])}`);
    await c.sleep(1400);
    await c.kill(segs[loser], '사신의 바퀴 · 지목');
  },

  View: class {
    constructor(root, api) {
      this.api = api;
      this.angle = 0;
      this.el = h(`
        <div class="g g-wheel">
          <div class="wh-box">
            <div class="wh-needle"></div>
            <canvas class="wh-canvas" width="640" height="640"></canvas>
            <div class="wh-hub"></div>
          </div>
          <div class="g-holder"></div>
          <div class="g-actions"></div>
          <div class="g-roster"></div>
        </div>`);
      root.appendChild(this.el);
      this.cv = this.el.querySelector('.wh-canvas');
      this.ctx = this.cv.getContext('2d');
      this.segs = [];
      this.raf = null;
    }

    draw(winner = null) {
      const ctx = this.ctx;
      const n = this.segs.length;
      const R = 310;
      ctx.clearRect(0, 0, 640, 640);
      ctx.save();
      ctx.translate(320, 320);
      ctx.rotate((this.angle * Math.PI) / 180);
      const seg = (Math.PI * 2) / n;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + i * seg;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, a0, a0 + seg);
        ctx.closePath();
        const id = this.segs[i];
        const p = this.api.player(id);
        ctx.fillStyle = id === winner ? '#d1101f' : i % 2 ? '#141414' : '#2a0306';
        ctx.fill();
        ctx.strokeStyle = '#5a0a0f';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.save();
        ctx.rotate(a0 + seg / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = id === winner ? '#fff' : id === this.api.me ? '#ffcf70' : '#e8e2d6';
        const fs = Math.max(14, Math.min(34, 260 / n + 10));
        ctx.font = `700 ${fs}px "Black Han Sans", "Noto Sans KR", sans-serif`;
        const label = p ? `${p.name.slice(0, 6)}  ${pad(p.num)}` : '?';
        ctx.fillText(label, R - 18, 0);
        ctx.restore();
      }
      ctx.restore();
      // 테두리 볼트
      ctx.save();
      ctx.translate(320, 320);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (R + 2), Math.sin(a) * (R + 2), 4, 0, Math.PI * 2);
        ctx.fillStyle = '#6b6b6b';
        ctx.fill();
      }
      ctx.restore();
    }

    update(S) {
      const g = S.game;
      const api = this.api;
      if (!g.segs) return;
      if (this.segs.join() !== g.segs.join()) {
        this.segs = g.segs;
        this.draw();
      }
      if (g.phase === 'stop' && !this.raf && this.angle !== g.final) {
        this.angle = g.final;
        this.draw();
      }
      const p = api.player(g.spinner);
      this.el.querySelector('.g-holder').innerHTML = p
        ? `<span class="gh-k">바퀴를 돌리는 자</span><span class="gh-n">${pad(p.num)}</span><span class="gh-name">${esc(p.name)}</span>`
        : '';
      roster(this.el.querySelector('.g-roster'), api, g.segs, { active: g.spinner });
      const A = this.el.querySelector('.g-actions');
      if (api.canAct('spin')) {
        const key = 'spin' + S.turn.id;
        if (A._k !== key) {
          A._k = key;
          A.innerHTML = '<button class="btn btn-blood btn-big">바퀴를 돌린다</button>';
          A.querySelector('button').onclick = () => { api.act('spin', {}); A.innerHTML = ''; A._k = null; };
        }
      } else if (A._k) { A.innerHTML = ''; A._k = null; }
    }

    spin(final, dur) {
      const from = this.angle % 360;
      const to = final;
      const t0 = performance.now();
      const n = this.segs.length;
      const segDeg = 360 / n;
      let lastIdx = Math.floor(from / segDeg);
      // 끝에서 살짝 머뭇거리는 이징
      const ease = (t) => 1 - Math.pow(1 - t, 4);
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        this.angle = from + (to - from) * ease(t);
        const idx = Math.floor(this.angle / segDeg);
        if (idx !== lastIdx) {
          lastIdx = idx;
          this.api.sfx.reel();
          this.el.querySelector('.wh-needle').classList.remove('flick');
          void this.el.offsetWidth;
          this.el.querySelector('.wh-needle').classList.add('flick');
        }
        this.draw();
        if (t < 1) this.raf = requestAnimationFrame(frame);
        else this.raf = null;
      };
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(frame);
    }

    event(ev) {
      const { sfx, fx, heart } = this.api;
      switch (ev.type) {
        case 'chosen':
          sfx.stinger();
          break;
        case 'spin':
          sfx.cock();
          heart(80);
          this.spin(ev.data.final, ev.data.dur);
          setTimeout(() => heart(140), ev.data.dur * 0.6);
          break;
        case 'stop': {
          heart(0);
          sfx.thud();
          this.draw(ev.data.id);
          fx.glitch(600);
          fx.shake(1.2, 600);
          break;
        }
      }
    }

    destroy() { cancelAnimationFrame(this.raf); this.api.heart(0); this.el.remove(); }
  },
};
