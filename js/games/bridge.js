import { h, roster, esc, pad } from './common.js';

const ROWS = 8;

export const bridge = {
  id: 'bridge',
  name: '유리 징검다리',
  tag: 'GLASS BRIDGE',
  line: '둘 중 하나는 강화유리. 나머지 하나는 바닥까지.',
  rule: '한 사람씩 다음 칸의 왼쪽 또는 오른쪽 유리로 뛴다. 일반 유리를 밟으면 추락한다.',

  async run(c) {
    const order = c.shuffle(c.alive());
    let safe = Array.from({ length: ROWS }, () => c.rand(2));
    let cells = Array(ROWS).fill(null);
    let pos = 0;
    c.set({ order, rows: ROWS, cells: cells.slice(), pos, cur: null, jump: null, bridgeNo: 1 });
    c.caption('강화유리는 한 칸에 하나뿐');
    await c.sleep(1800);
    for (let k = 0; ; k++) {
      const cur = order[k % order.length];
      c.set({ cur, pos, jump: null });
      c.caption(`${c.name(cur)} — ${pos + 1}번째 칸`);
      c.emit('ready', { cur });
      const d = await c.turn(cur, 'step', {
        def: () => ({ side: c.rand(2) }),
        validate: (x) => x && (x.side === 0 || x.side === 1),
      });
      const side = d.side;
      c.set({ jump: { row: pos, side } });
      c.emit('jump', { cur, row: pos, side });
      await c.sleep(1300);
      if (side === safe[pos]) {
        cells[pos] = { safe: side };
        c.set({ cells: cells.slice() });
        c.emit('land', { row: pos, side });
        c.caption('버텼다');
        pos++;
        await c.sleep(1000);
        if (pos >= ROWS) {
          c.caption(`${c.name(cur)} 도착. 다리가 새로 놓입니다.`);
          c.emit('cross', { cur });
          await c.sleep(2200);
          safe = Array.from({ length: ROWS }, () => c.rand(2));
          cells = Array(ROWS).fill(null);
          pos = 0;
          c.set({ cells: cells.slice(), pos, bridgeNo: (k % 97) + 2 });
        }
      } else {
        cells[pos] = { safe: safe[pos], broke: side };
        c.set({ cells: cells.slice() });
        c.emit('break', { cur, row: pos, side });
        c.caption('쨍그랑');
        await c.sleep(2200);
        await c.kill(cur, '유리 징검다리 · 추락');
        return;
      }
    }
  },

  View: class {
    constructor(root, api) {
      this.api = api;
      let rows = '';
      for (let r = ROWS - 1; r >= 0; r--) {
        rows += `<div class="br-row" data-r="${r}"><div class="br-panel" data-s="0"></div><span class="br-idx">${r + 1}</span><div class="br-panel" data-s="1"></div></div>`;
      }
      this.el = h(`
        <div class="g g-bridge">
          <div class="br-scene">
            <div class="br-abyss"></div>
            <div class="br-track">
              <div class="br-end">도착</div>
              ${rows}
              <div class="br-start">출발</div>
              <div class="br-token"></div>
            </div>
          </div>
          <div class="g-holder"></div>
          <div class="g-actions"></div>
          <div class="g-roster"></div>
        </div>`);
      root.appendChild(this.el);
      this.token = this.el.querySelector('.br-token');
    }

    panel(r, s) { return this.el.querySelector(`.br-row[data-r="${r}"] .br-panel[data-s="${s}"]`); }

    placeToken(row, side, mode = '') {
      // 트랙이 3D로 기울어져 있으므로 화면 좌표가 아닌 레이아웃 좌표를 쓴다
      const target = row < 0 ? this.el.querySelector('.br-start') : this.panel(row, side);
      if (!target) return;
      this.token.style.left = `${target.offsetLeft + target.offsetWidth / 2}px`;
      this.token.style.top = `${target.offsetTop + target.offsetHeight / 2}px`;
      this.token.className = 'br-token ' + mode;
    }

    update(S) {
      const g = S.game;
      const api = this.api;
      if (!g.cells) return;
      g.cells.forEach((cell, r) => {
        for (const s of [0, 1]) {
          const p = this.panel(r, s);
          p.classList.toggle('safe', !!cell && cell.safe === s);
          p.classList.toggle('broken', !!cell && cell.broke === s);
        }
      });
      this.el.querySelectorAll('.br-row').forEach((row) => row.classList.toggle('next', Number(row.dataset.r) === g.pos));
      const p = api.player(g.cur);
      this.token.textContent = p ? pad(p.num) : '';
      if (!g.jump) {
        const prev = g.pos - 1;
        this.placeToken(prev, prev >= 0 && g.cells[prev] ? g.cells[prev].safe : 0);
      }
      this.el.querySelector('.g-holder').innerHTML = p
        ? `<span class="gh-k">${g.pos + 1}번째 칸 앞</span><span class="gh-n">${pad(p.num)}</span><span class="gh-name">${esc(p.name)}</span>`
        : '';
      roster(this.el.querySelector('.g-roster'), api, g.order, { active: g.cur });
      const A = this.el.querySelector('.g-actions');
      if (api.canAct('step')) {
        const key = 'step' + S.turn.id;
        if (A._k !== key) {
          A._k = key;
          A.innerHTML = `<button class="btn btn-ghost btn-big" data-s="0">← 왼쪽</button><button class="btn btn-ghost btn-big" data-s="1">오른쪽 →</button>`;
          A.querySelectorAll('button').forEach((b) => (b.onclick = () => { api.act('step', { side: Number(b.dataset.s) }); A.innerHTML = ''; A._k = null; }));
        }
      } else if (A._k) { A.innerHTML = ''; A._k = null; }
    }

    event(ev) {
      const { sfx, fx, heart } = this.api;
      const d = ev.data;
      switch (ev.type) {
        case 'ready':
          sfx.ui();
          heart(96);
          break;
        case 'jump':
          heart(0);
          this.placeToken(d.row, d.side, 'jumping');
          setTimeout(() => sfx.step(), 520);
          break;
        case 'land':
          sfx.thud();
          this.panel(d.row, d.side)?.classList.add('flashok');
          break;
        case 'cross':
          sfx.survive();
          break;
        case 'break': {
          const p = this.panel(d.row, d.side);
          sfx.glass();
          fx.shake(1.4, 700);
          fx.flash('#bfe8ff', 80);
          if (p) {
            const r = p.getBoundingClientRect();
            fx.shards(r.left, r.top, r.width, r.height);
          }
          this.token.classList.add('falling');
          setTimeout(() => sfx.fall(), 250);
          break;
        }
      }
    }

    destroy() { this.api.heart(0); this.el.remove(); }
  },
};
