// api.js - the client of coral-service (service/main.cpp). Thin: fetch in, JSON out, errors thrown.
export class Api {
  constructor(base = '') { this.base = base; }
  async _json(path, init) {
    const r = await fetch(this.base + path, init);
    const text = await r.text();
    let body; try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    if (!r.ok && r.status !== 409) throw new Error(body?.error || `${r.status} on ${path}`);
    return body;
  }
  health() { return this._json('/api/health'); }
  projects() { return this._json('/api/projects'); }
  loadModel(project) { return this._json(`/api/projects/${encodeURIComponent(project)}/model`); }
  commit(project, body) { return this._json(`/api/projects/${encodeURIComponent(project)}/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  history(project) { return this._json(`/api/projects/${encodeURIComponent(project)}/history`); }
  events(project, since = 0) { return this._json(`/api/projects/${encodeURIComponent(project)}/events?since=${since}`); }
  elementHistory(project, id) { return this._json(`/api/projects/${encodeURIComponent(project)}/elements/${encodeURIComponent(id)}/history`); }
  sources(project) { return this._json(`/api/projects/${encodeURIComponent(project)}/sources`); }
  putSource(project, src) { return this._json(`/api/projects/${encodeURIComponent(project)}/sources/${encodeURIComponent(src.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(src) }); }
  async putArtifact(blob, filename) {
    const r = await fetch(this.base + '/api/artifacts', { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream', 'x-filename': filename || '' }, body: blob });
    if (!r.ok) throw new Error(`artifact upload failed: ${r.status}`);
    return r.json();
  }
  artifactUrl(sha) { return `${this.base}/api/artifacts/${sha}`; }
}
