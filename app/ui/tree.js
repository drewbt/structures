// tree.js - <coral-tree>: the model as a hierarchy. Project → Sources → drawings; Levels → elements
// grouped by type. It renders FROM the model and selects INTO the app; it holds no data of its own.
const TYPE_ORDER = ['wall', 'column', 'beam', 'slab', 'pilecap', 'opening', 'drawing', 'trace'];
const LABEL = { wall: 'Walls', column: 'Columns', beam: 'Beams', slab: 'Slabs', pilecap: 'Pile caps', opening: 'Openings', drawing: 'Drawings', trace: 'Traces', rebar: 'Reinforcement' };

export class CoralTree extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app');
    this.open = new Set(['project', 'levels', 'sources', 'drawings', 'ground']); this.closed = new Set();   // levels and type groups are open unless closed
    this.app.addEventListener('model', () => this.render());
    this.app.addEventListener('regenerate', () => this.render());
    this.app.addEventListener('select', () => this.render());
    this.app.addEventListener('sources', () => this.render());
    this.render();
  }
  isOpen(key) { if (key.endsWith(':rebar')) return this.open.has(key); if (key.startsWith('el:')) return this.open.has(key); return key.startsWith('lvl:') || key.startsWith('grp:') ? !this.closed.has(key) : this.open.has(key); }
  toggle(key) { const set = (key.startsWith('lvl:') || key.startsWith('grp:')) && !key.endsWith(':rebar') ? this.closed : this.open; set.has(key) ? set.delete(key) : set.add(key); this.render(); }
  node(key, label, { type = '', kids = null, id = null, bad = false, depth = 0 } = {}) {
    const isOpen = this.isOpen(key), sel = id && this.app.selection.has(id);
    const tw = kids ? `<span class="tw">${isOpen ? '▾' : '▸'}</span>` : '<span class="tw"></span>';
    let html = `<div class="node ${sel ? 'sel' : ''}" data-key="${key}" data-id="${id ?? ''}" style="padding-left:${4 + depth * 10}px">${tw}<span class="label ${bad ? 'bad' : ''}">${label}</span>${type ? `<span class="ty">${type}</span>` : ''}</div>`;
    if (kids && isOpen) html += `<div class="kids">${kids}</div>`;
    return html;
  }
  render() {
    const m = this.app.model, errors = this.app.lastRegenerate?.errors || {};
    const el = e => {
      const kids = m.children(e.id), bars = kids.filter(k => k.type === 'rebar'), parts = kids.filter(k => k.type === 'pile' || k.type === 'drop_panel'), zones = kids.filter(k => k.type === 'punching_zone');
      const sub = [
        parts.length ? this.node(`grp:${e.id}:parts`, `${parts[0].type === 'pile' ? 'Piles' : 'Drop panels'} (${parts.length})`, { kids: parts.map(pp => this.node('el:' + pp.id, pp.name, { type: pp.type, id: pp.id })).join(''), depth: 2 }) : '',
        zones.length ? this.node(`grp:${e.id}:zones:rebar`, `Punching zones (${zones.length})`, { kids: zones.map(z => this.node('el:' + z.id, z.name, { type: `util ${z.params.util?.value}`, id: z.id, bad: (z.params.util?.value ?? 0) > 1 })).join(''), depth: 2 }) : '',
        bars.length ? this.node(`grp:${e.id}:rebar`, `Reinforcement (${bars.length})`, { kids: (this.open.has(`grp:${e.id}:rebar`) ? bars.slice(0, 400) : []).map(b => this.node('el:' + b.id, b.name, { type: b.params.designation?.value, id: b.id })).join('') + (bars.length > 400 ? `<div class="hint">… ${bars.length - 400} more (select in 3D)</div>` : ''), depth: 2 }) : '',
      ].join('');
      return this.node('el:' + e.id, e.name, { type: e.type, id: e.id, bad: !!errors[e.id], kids: sub || null });
    };
    const sources = this.app.sources.map(s => `<div class="node" style="padding-left:14px"><span class="tw"></span><span class="label">${s.title || s.id}</span><span class="ty">${s.status}</span></div>`).join('');
    const drawings = m.byType('drawing').map(el).join('');
    const levels = m.byType('level').sort((a, b) => (a.params.elevation?.value ?? 0) - (b.params.elevation?.value ?? 0)).map(l => {
      const kids = m.children(l.id);
      const groups = TYPE_ORDER.filter(t => kids.some(k => k.type === t)).map(t => this.node(`grp:${l.id}:${t}`, `${LABEL[t]} (${kids.filter(k => k.type === t).length})`, { kids: kids.filter(k => k.type === t).map(el).join(''), depth: 1 })).join('');
      return this.node('lvl:' + l.id, l.name, { type: `${l.params.elevation?.value ?? 0} m`, id: l.id, kids: groups || '<div class="hint">empty</div>' });
    }).join('');
    const orphans = m.all().filter(e => !['level', 'drawing', 'rebar', 'pile', 'drop_panel', 'punching_zone', 'soil', 'soil_layer'].includes(e.type) && !m.get(e.parent)).map(el).join('');   // rebar's parent is its beam, so it is never an orphan
    const ground = m.byType('soil').map(sp => this.node('el:' + sp.id, sp.name, { type: `water ${sp.params.water_depth?.value ?? '—'} m`, id: sp.id, bad: !!errors[sp.id], kids: m.children(sp.id).filter(k => k.type === 'soil_layer').sort((a, b) => (a.params.top?.value ?? 0) - (b.params.top?.value ?? 0)).map(l => this.node('el:' + l.id, l.name, { type: `${l.params.kind?.value} ${l.params.top?.value}–${l.params.bottom?.value} m`, id: l.id, bad: !!errors[l.id], depth: 1 })).join('') || null })).join('');
    this.innerHTML = `<div class="collapse" title="Collapse the tree">${this.classList.contains('collapsed') ? '»' : '« tree'}</div>` +
      this.node('project', this.app.project, { kids: this.node('sources', `Sources (${this.app.sources.length})`, { kids: sources || '<div class="hint">none</div>', depth: 1 }) + this.node('drawings', `Drawings (${m.byType('drawing').length})`, { kids: drawings || '<div class="hint">none</div>', depth: 1 }) }) +
      (ground ? this.node('ground', 'Ground (assumed soil)', { kids: ground }) : '') +
      this.node('levels', `Levels (${m.byType('level').length})`, { kids: levels || '<div class="hint">no levels yet</div>' }) +
      (orphans ? this.node('orphans', 'Unparented', { kids: orphans, bad: true }) : '');
    this.querySelector('.collapse').onclick = () => { this.classList.toggle('collapsed'); this.app.classList.toggle('tree-collapsed'); this.render(); };
    for (const n of this.querySelectorAll('.node')) n.onclick = (e) => {
      const key = n.dataset.key, id = n.dataset.id;
      if (id) this.app.select([id], { toggle: e.ctrlKey || e.metaKey });
      if (e.target.classList.contains('tw') || !id) this.toggle(key);
    };
  }
}
customElements.define('coral-tree', CoralTree);
