// source.js - <page-source> (PAGE 00): register architectural sources, import drawings, keep the
// attribution and the missing-information register. A source is a row in the service's sources
// table; a drawing is an element of type "drawing" in the model (so its calibration is part of the
// authoritative state and is versioned with everything else).
//
// The first candidate source is Section Haus (Debaixo do Bloco Arquitetura) on ArchDaily. Its page
// is NOT fetched by this app: images on ArchDaily are the photographers' and the architects', and
// this environment could not reach the site at all (ASSUMPTIONS A-01). The person imports a drawing
// they are authorised to use; the source record keeps the URL, the attribution and what is missing.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const ARCHDAILY_SOURCE = {
  id: 'src-archdaily-975178', kind: 'archdaily', title: 'Section Haus', author: 'Debaixo do Bloco Arquitetura',
  url: 'https://www.archdaily.com/975178/section-haus-debaixo-do-bloco-arquitetura',
  license: 'unknown — ArchDaily publication; images © their credited authors; not licensed for redistribution unless stated',
  status: 'not-acquired',
  attribution: 'Section Haus, Debaixo do Bloco Arquitetura, published on ArchDaily (975178). Drawings and photographs © their credited authors.',
  meta: { location: 'unknown (read from the source page before use)', year: 'unknown', area_m2: 'unknown', structural_engineer: 'unknown',
    drawings_available: 'unknown until the page is inspected', missing: ['floor plans', 'sections', 'elevations', 'dimensions', 'structural information', 'licence terms'],
    assumptions: ['none yet: no dimension has been taken from this source'] },
};
export const FIXTURE_SOURCE = {
  id: 'src-fixture-plan-v1', kind: 'fixture', title: 'Synthetic calibration fixture (plan)', author: 'Coral Concrete (generated)',
  url: '/fixtures/plan-fixture.svg', license: 'MIT (this repository)', status: 'synthetic',
  attribution: 'Generated test drawing with known dimensions; not an architectural source. 100 px = 1 m; 5 m scale bar = 500 px.',
  meta: { known: { scale_m_per_px: 0.01, outer_walls_m: [12, 8], wall_thickness_mm: 200, origin_px: [150, 850], columns_m: [[3, 4], [9, 4]] }, missing: [] },
};

export class PageSource extends HTMLElement {
  connectedCallback() {
    this.app = this.closest('coral-app'); this.classList.add('page-scroll');
    this.app.addEventListener('sources', () => this.render()); this.app.addEventListener('model', () => this.render());
    this.render();
  }
  render() {
    const m = this.app.model; const drawings = m.byType('drawing');
    const srcRows = this.app.sources.map(s => `<tr><td><b>${esc(s.title)}</b><br><span class="mono">${esc(s.id)}</span></td><td>${esc(s.kind)}</td><td>${esc(s.author)}</td><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></td><td><span class="pill ${s.status === 'synthetic' ? 'warn' : s.status === 'not-acquired' ? 'bad' : 'ok'}">${esc(s.status)}</span></td><td>${esc(s.license)}</td><td>${(s.meta?.missing || []).map(x => `<div>• ${esc(x)}</div>`).join('') || '—'}</td></tr>`).join('');
    const drRows = drawings.map(d => { const r = m.result(d.id); const err = this.app.lastRegenerate?.errors?.[d.id]; return `<tr><td>${esc(d.name)}<br><span class="mono">${esc(d.id)}</span></td><td class="mono">${esc(d.params.source?.value)}</td><td class="mono">${esc(d.params.image_url?.value)}</td><td>${r ? `<span class="pill ok">calibrated ${r.scale.toPrecision(4)} m/px</span>` : `<span class="pill warn">${esc(err || 'not calibrated')}</span>`}</td><td><a href="#trace" class="btn">Trace</a></td></tr>`; }).join('');
    this.innerHTML = `
      <h2>00 · Source</h2>
      <div class="card"><h3>Registered sources</h3>
        <table><thead><tr><th>Source</th><th>Kind</th><th>Author</th><th>URL</th><th>Status</th><th>Licence</th><th>Missing information</th></tr></thead><tbody>${srcRows || '<tr><td colspan="7" class="hint">No sources registered.</td></tr>'}</tbody></table>
        <div class="actions" style="margin-top:10px">
          <button id="reg-archdaily">Register ArchDaily source (Section Haus)</button>
          <button id="reg-fixture">Register synthetic fixture drawing</button>
        </div>
        <div class="hint">The ArchDaily record carries the URL and attribution only. Its drawings must be imported below from a copy you are authorised to use; nothing is downloaded from ArchDaily.</div>
      </div>
      <div class="card"><h3>Import a drawing</h3>
        <div class="form">
          <label>Source</label><select id="imp-src">${this.app.sources.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select>
          <label>Drawing title</label><input id="imp-title" placeholder="Ground floor plan">
          <label>Image file</label><input id="imp-file" type="file" accept="image/*,.svg,.pdf">
          <label>Level</label><select id="imp-level">${m.byType('level').map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}<option value="__new">+ new level “Ground” (assumed 0.000, h 3.000)</option></select>
        </div>
        <div class="actions" style="margin-top:10px"><button id="imp-go" class="primary" ${this.app.sources.length ? '' : 'disabled'}>Import and register drawing</button></div>
        <div class="hint">The file is stored by its SHA-256 in the service's artifacts table; the drawing element records which source it came from. Scale, origin and axis are set on the Trace page.</div>
      </div>
      <div class="card"><h3>Drawings in the model (${drawings.length})</h3>
        <table><thead><tr><th>Drawing</th><th>Source</th><th>Image</th><th>Calibration</th><th></th></tr></thead><tbody>${drRows || '<tr><td colspan="5" class="hint">No drawings yet.</td></tr>'}</tbody></table>
      </div>
      <div class="card"><h3>Source quality and uncertainty</h3>
        <div class="hint">Every traced element records its method: <b>measured</b> (read off a calibrated drawing), <b>inferred</b> (derived from other measured values) or <b>assumed</b> (no source; stated here and in ASSUMPTIONS.md). Level heights created on import are <b>assumed</b> until a section is traced.</div>
      </div>`;
    this.querySelector('#reg-archdaily').onclick = async () => { await this.app.api.putSource(this.app.project, ARCHDAILY_SOURCE); await this.app.refreshSources(); };
    this.querySelector('#reg-fixture').onclick = () => this.registerFixture();
    this.querySelector('#imp-go').onclick = () => this.importDrawing();
  }
  ensureLevel(id) {
    const m = this.app.model;
    if (id && id !== '__new' && m.get(id)) return id;
    const existing = m.byType('level')[0]; if (existing && id !== '__new') return existing.id;
    const l = m.create({ type: 'level', name: 'Ground', params: { elevation: { value: 0, unit: 'm' }, height: { value: 3, unit: 'm' } }, provenance: { source: '', trace: '', method: 'assumed', note: 'level created on drawing import; elevation 0 and height 3.000 m are assumptions until a section is traced' } });
    return l.id;
  }
  async registerFixture() {
    const m = this.app.model;
    await this.app.api.putSource(this.app.project, FIXTURE_SOURCE);
    await this.app.refreshSources();
    const level = this.ensureLevel('__new_if_none');
    if (!m.byType('drawing').some(d => d.params.image_url?.value === FIXTURE_SOURCE.url)) {
      m.create({ type: 'drawing', name: 'Fixture plan (synthetic)', parent: '', params: { source: { value: FIXTURE_SOURCE.id, unit: 'id' }, image_url: { value: FIXTURE_SOURCE.url, unit: '' }, level: { value: level, unit: 'id' }, origin_px: { value: [0, 0], unit: 'px' }, rotation: { value: 0, unit: 'deg' } },
        provenance: { source: FIXTURE_SOURCE.id, trace: '', method: 'measured', note: 'synthetic fixture; calibration pending' } });
    }
    this.app.regenerate();
  }
  async importDrawing() {
    const f = this.querySelector('#imp-file').files[0]; if (!f) { alert('Choose an image file first.'); return; }
    const src = this.querySelector('#imp-src').value; const title = this.querySelector('#imp-title').value || f.name;
    const { sha } = await this.app.api.putArtifact(f, f.name);
    const level = this.ensureLevel(this.querySelector('#imp-level').value);
    this.app.model.create({ type: 'drawing', name: title, params: { source: { value: src, unit: 'id' }, image_url: { value: this.app.api.artifactUrl(sha), unit: '' }, artifact_sha: { value: sha, unit: '' }, filename: { value: f.name, unit: '' }, level: { value: level, unit: 'id' }, origin_px: { value: [0, 0], unit: 'px' }, rotation: { value: 0, unit: 'deg' } },
      provenance: { source: src, trace: '', method: 'measured', note: `imported ${f.name} (${f.size} bytes)` } });
    this.app.regenerate();
  }
}
customElements.define('page-source', PageSource);
