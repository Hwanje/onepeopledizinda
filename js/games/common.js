export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pad = (n) => String(n).padStart(3, '0');

// 목숨 표시: 남은 목숨은 채운 칸, 잃은 목숨은 빈 칸
export const pips = (lives, deaths) => '<i class="pip on"></i>'.repeat(Math.max(0, lives - deaths)) + '<i class="pip"></i>'.repeat(Math.min(lives, deaths));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function tag(p, extra = '') {
  if (!p) return '';
  return `<span class="tag ${p.alive ? '' : 'is-dead'} ${extra}" data-pid="${esc(p.id)}"><b>${pad(p.num)}</b>${esc(p.name)}</span>`;
}

// 참가자 줄. active: 강조할 id, marks: {id: '라벨'}
export function roster(el, api, ids, { active = null, marks = {} } = {}) {
  const html = ids.map((id) => {
    const p = api.player(id);
    if (!p) return '';
    const cls = [p.alive ? '' : 'is-dead', id === active ? 'is-active' : '', id === api.me ? 'is-me' : ''].join(' ');
    const life = api.lives > 1 ? `<span class="pips">${pips(api.lives, p.deaths || 0)}</span>` : '';
    return `<div class="rp ${cls}" data-pid="${esc(id)}"><span class="rp-num">${pad(p.num)}</span><span class="rp-name">${esc(p.name)}</span>${life}${marks[id] ? `<span class="rp-mark">${esc(marks[id])}</span>` : ''}</div>`;
  }).join('');
  if (el._last !== html) { el.innerHTML = html; el._last = html; }
}

export function nodeOf(root, id) {
  return root.querySelector(`[data-pid="${CSS.escape(id)}"]`);
}
