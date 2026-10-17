// timeline.js - <coral-timeline>: pending events (the append-only log awaiting commit), validation
// results from the last regenerate, and execution status. Reads the model; writes nothing.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export class CoralTimeline extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app');
    for (const ev of ['model', 'regenerate', 'sources']) this.app.addEventListener(ev, () => this.render());
    this.render();
  }
  render() {
    const m = this.app.model, r = this.app.lastRegenerate; const errs = Object.entries(r?.errors || {});
    const evs = m.events.slice(-8).reverse().map(e => `<div class="ev">${esc(e.time.slice(11, 19))} ${esc(e.type)} ${esc(e.element || '')}${e.payload?.name ? ' ' + esc(e.payload.name) : ''}</div>`).join('');
    this.innerHTML = `
      <div><h4>Events (${m.events.length} pending commit)</h4>${evs || '<div class="ev">none</div>'}</div>
      <div><h4>Validation</h4>${errs.length ? errs.map(([id, msg]) => `<div class="ev err">${esc(id)}: ${esc(msg)}</div>`).join('') : '<div class="ev ok">all generated elements valid</div>'}</div>
      <div><h4>Execution</h4><div class="ev">last regenerate: ${r ? `${r.recomputed.length} recomputed, ${r.cached.length} from cache` : '—'}</div>
        <div class="ev">service: ${this.app.status.health ? `sqlite ${esc(this.app.status.health.sqlite)}, schema ${esc(this.app.status.health.schema_version)}` : 'not reached'}</div>
        <div class="ev">model hash ${esc(m.hash().slice(0, 16))}…</div></div>`;
  }
}
customElements.define('coral-timeline', CoralTimeline);
