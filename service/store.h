// store.h - the authoritative project store: one SQLite file per installation, normalized.
//
// Domains (REQUIREMENTS §7): projects, sources, artifacts, revisions, elements, parameters,
// provenance, events, functions, results. Element identities are stable strings minted by the
// client; every parameter value is stored as the exact JSON text the client sent (`value_json`),
// never re-serialised, so the model hash computed in the browser (app/core/hash.js, canonical()) is
// the hash recomputed here (Store::model_hash) byte for byte. That equality is the gate.
//
// Revisions are append-only. A commit writes a new revision and only the parameter rows that
// changed against the latest; reading the model takes the latest row per (element, parameter).
// Deleting an element sets deleted_rev; its history stays. Events are append-only; a correction
// is a new event.
#pragma once
#include "json.h"
#include "sha256.h"
#include <sqlite3.h>
#include <algorithm>
#include <ctime>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

namespace store {

inline std::string now_iso() {
    std::time_t t = std::time(nullptr); char b[32]; std::strftime(b, sizeof b, "%Y-%m-%dT%H:%M:%SZ", std::gmtime(&t)); return b;
}

struct Param { std::string name, value_json, unit; };
struct Prov { std::string source_id, trace_id, method, note; };
struct Element {
    std::string id, type, name, parent;
    std::vector<Param> params;   // sorted by name
    Prov prov; bool has_prov = false;
    long created_rev = 0, deleted_rev = 0;
};

// The canonical text both sides hash. Elements sorted by id, params by name, tabs between fields.
inline std::string canonical(std::vector<Element> els) {
    std::sort(els.begin(), els.end(), [](const Element& a, const Element& b) { return a.id < b.id; });
    std::string s;
    for (auto& e : els) {
        if (e.deleted_rev) continue;
        s += e.id + "\t" + e.type + "\t" + e.name + "\t" + e.parent + "\n";
        auto ps = e.params; std::sort(ps.begin(), ps.end(), [](const Param& a, const Param& b) { return a.name < b.name; });
        for (auto& p : ps) s += "\t" + p.name + "\t" + p.value_json + "\t" + p.unit + "\n";
        if (e.has_prov) s += "\t@prov\t" + e.prov.source_id + "\t" + e.prov.trace_id + "\t" + e.prov.method + "\n";
    }
    return s;
}

class Store {
public:
    explicit Store(const std::string& path) {
        if (sqlite3_open(path.c_str(), &db_) != SQLITE_OK) throw std::runtime_error("sqlite: cannot open " + path);
        exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;");
        schema();
    }
    ~Store() { if (db_) sqlite3_close(db_); }
    Store(const Store&) = delete; Store& operator=(const Store&) = delete;

    static const char* schema_version() { return "1"; }

    // ---- projects ------------------------------------------------------------------------------------
    void ensure_project(const std::string& id, const std::string& name) {
        Stmt s(db_, "INSERT OR IGNORE INTO projects(id,name,created) VALUES(?,?,?)");
        s.bind(1, id).bind(2, name).bind(3, now_iso()).step();
    }
    json::Value list_projects() {
        json::Value out = json::Value::array();
        Stmt s(db_, "SELECT p.id,p.name,p.created,(SELECT MAX(rev) FROM revisions r WHERE r.project_id=p.id) FROM projects p ORDER BY created");
        while (s.step()) { json::Value o = json::Value::object(); o.set("id", s.text(0)); o.set("name", s.text(1)); o.set("created", s.text(2)); o.set("rev", (double)s.i64(3)); out.push(o); }
        return out;
    }

    // ---- sources and artifacts ------------------------------------------------------------------------
    void put_source(const std::string& project, const json::Value& src) {
        ensure_project(project, project);
        Stmt s(db_, "INSERT OR REPLACE INTO sources(id,project_id,kind,title,url,author,license,status,attribution,artifact_sha,meta_json,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
        s.bind(1, str(src, "id")).bind(2, project).bind(3, str(src, "kind")).bind(4, str(src, "title")).bind(5, str(src, "url"))
         .bind(6, str(src, "author")).bind(7, str(src, "license")).bind(8, str(src, "status")).bind(9, str(src, "attribution"))
         .bind(10, str(src, "artifact_sha")).bind(11, src.has("meta") ? json::dump(src.at("meta"), false) : "{}").bind(12, now_iso()).step();
    }
    json::Value list_sources(const std::string& project) {
        json::Value out = json::Value::array();
        Stmt s(db_, "SELECT id,kind,title,url,author,license,status,attribution,artifact_sha,meta_json,updated FROM sources WHERE project_id=? ORDER BY id");
        s.bind(1, project);
        while (s.step()) {
            json::Value o = json::Value::object();
            const char* k[] = { "id", "kind", "title", "url", "author", "license", "status", "attribution", "artifact_sha" };
            for (int i = 0; i < 9; ++i) o.set(k[i], s.text(i));
            o.set("meta", json::parse(s.text(9).empty() ? "{}" : s.text(9))); o.set("updated", s.text(10)); out.push(o);
        }
        return out;
    }
    std::string put_artifact(const std::string& mime, const std::string& bytes, const std::string& filename) {
        std::string sha = sha256::of(bytes);
        Stmt s(db_, "INSERT OR IGNORE INTO artifacts(sha,mime,filename,bytes,size,created) VALUES(?,?,?,?,?,?)");
        s.bind(1, sha).bind(2, mime).bind(3, filename).bind_blob(4, bytes).bind(5, (long long)bytes.size()).bind(6, now_iso()).step();
        return sha;
    }
    bool get_artifact(const std::string& sha, std::string& mime, std::string& bytes, std::string& filename) {
        Stmt s(db_, "SELECT mime,bytes,filename FROM artifacts WHERE sha=?"); s.bind(1, sha);
        if (!s.step()) return false;
        mime = s.text(0); bytes = s.blob(1); filename = s.text(2); return true;
    }

    // ---- the model ------------------------------------------------------------------------------------
    std::vector<Element> load_elements(const std::string& project, bool include_deleted = false) {
        std::map<std::string, Element> els;
        {
            Stmt s(db_, "SELECT id,type,name,parent_id,created_rev,deleted_rev FROM elements WHERE project_id=?"); s.bind(1, project);
            while (s.step()) {
                Element e; e.id = s.text(0); e.type = s.text(1); e.name = s.text(2); e.parent = s.text(3); e.created_rev = (long)s.i64(4); e.deleted_rev = (long)s.i64(5);
                if (e.deleted_rev && !include_deleted) continue;
                els[e.id] = e;
            }
        }
        {
            // latest row per (element, name)
            Stmt s(db_, "SELECT p.element_id,p.name,p.value_json,p.unit FROM parameters p WHERE p.project_id=? AND p.rev=(SELECT MAX(rev) FROM parameters q WHERE q.project_id=p.project_id AND q.element_id=p.element_id AND q.name=p.name) ORDER BY p.element_id,p.name");
            s.bind(1, project);
            while (s.step()) {
                auto it = els.find(s.text(0));
                if (it == els.end() || s.text(2) == "\x01removed") continue;
                it->second.params.push_back({ s.text(1), s.text(2), s.text(3) });
            }
        }
        {
            Stmt s(db_, "SELECT v.element_id,v.source_id,v.trace_id,v.method,v.note FROM provenance v WHERE v.project_id=? AND v.rev=(SELECT MAX(rev) FROM provenance w WHERE w.project_id=v.project_id AND w.element_id=v.element_id)");
            s.bind(1, project);
            while (s.step()) { auto it = els.find(s.text(0)); if (it == els.end()) continue; it->second.has_prov = true; it->second.prov = { s.text(1), s.text(2), s.text(3), s.text(4) }; }
        }
        std::vector<Element> out; for (auto& kv : els) out.push_back(kv.second); return out;
    }
    long latest_rev(const std::string& project) {
        Stmt s(db_, "SELECT COALESCE(MAX(rev),0) FROM revisions WHERE project_id=?"); s.bind(1, project); s.step(); return (long)s.i64(0);
    }
    std::string model_hash(const std::string& project) { return sha256::of(canonical(load_elements(project))); }

    // Commit a full element set (the client's authoritative state) as one new revision.
    // Only differences against the latest stored state are written. Returns {rev, model_hash}.
    json::Value commit(const std::string& project, const json::Value& body) {
        ensure_project(project, project);
        std::vector<Element> incoming = parse_elements(body.at("elements"));
        std::string client_hash = body.has("model_hash") ? body.at("model_hash").as_string() : "";
        std::string expected_parent = body.has("parent_rev") ? std::to_string(body.at("parent_rev").as_int()) : "";
        exec("BEGIN IMMEDIATE");
        try {
            long parent = latest_rev(project);
            if (!expected_parent.empty() && expected_parent != std::to_string(parent)) { exec("ROLLBACK"); json::Value r = json::Value::object(); r.set("conflict", true); r.set("rev", (double)parent); return r; }
            long rev = parent + 1;
            std::string msg = body.has("message") ? body.at("message").as_string() : "";
            std::string actor = body.has("actor") ? body.at("actor").as_string() : "";
            { Stmt s(db_, "INSERT INTO revisions(rev,project_id,parent_rev,time,message,actor,model_hash) VALUES(?,?,?,?,?,?,?)");
              s.bind(1, (long long)rev).bind(2, project).bind(3, (long long)parent).bind(4, now_iso()).bind(5, msg).bind(6, actor).bind(7, "").step(); }
            std::map<std::string, Element> current; for (auto& e : load_elements(project, true)) current[e.id] = e;
            std::map<std::string, bool> seen;
            int changed = 0;
            for (auto& e : incoming) {
                seen[e.id] = true;
                auto it = current.find(e.id);
                if (it == current.end()) {
                    Stmt s(db_, "INSERT INTO elements(project_id,id,type,name,parent_id,created_rev,deleted_rev) VALUES(?,?,?,?,?,?,0)");
                    s.bind(1, project).bind(2, e.id).bind(3, e.type).bind(4, e.name).bind(5, e.parent).bind(6, (long long)rev).step(); ++changed;
                } else if (it->second.type != e.type || it->second.name != e.name || it->second.parent != e.parent || it->second.deleted_rev) {
                    Stmt s(db_, "UPDATE elements SET type=?,name=?,parent_id=?,deleted_rev=0 WHERE project_id=? AND id=?");
                    s.bind(1, e.type).bind(2, e.name).bind(3, e.parent).bind(4, project).bind(5, e.id).step(); ++changed;
                }
                std::map<std::string, Param> old; if (it != current.end()) for (auto& p : it->second.params) old[p.name] = p;
                for (auto& p : e.params) {
                    auto o = old.find(p.name);
                    if (o != old.end() && o->second.value_json == p.value_json && o->second.unit == p.unit) { old.erase(o); continue; }
                    if (o != old.end()) old.erase(o);
                    Stmt s(db_, "INSERT INTO parameters(project_id,element_id,name,value_json,unit,rev) VALUES(?,?,?,?,?,?)");
                    s.bind(1, project).bind(2, e.id).bind(3, p.name).bind(4, p.value_json).bind(5, p.unit).bind(6, (long long)rev).step(); ++changed;
                }
                for (auto& o : old) {   // a parameter the client no longer carries: tombstone it
                    Stmt s(db_, "INSERT INTO parameters(project_id,element_id,name,value_json,unit,rev) VALUES(?,?,?,?,?,?)");
                    s.bind(1, project).bind(2, e.id).bind(3, o.first).bind(4, "\x01removed").bind(5, "").bind(6, (long long)rev).step(); ++changed;
                }
                if (e.has_prov && (it == current.end() || !it->second.has_prov || it->second.prov.source_id != e.prov.source_id || it->second.prov.trace_id != e.prov.trace_id || it->second.prov.method != e.prov.method || it->second.prov.note != e.prov.note)) {
                    Stmt s(db_, "INSERT INTO provenance(project_id,element_id,rev,source_id,trace_id,method,note) VALUES(?,?,?,?,?,?,?)");
                    s.bind(1, project).bind(2, e.id).bind(3, (long long)rev).bind(4, e.prov.source_id).bind(5, e.prov.trace_id).bind(6, e.prov.method).bind(7, e.prov.note).step(); ++changed;
                }
            }
            for (auto& kv : current) if (!seen.count(kv.first) && !kv.second.deleted_rev) {
                Stmt s(db_, "UPDATE elements SET deleted_rev=? WHERE project_id=? AND id=?"); s.bind(1, (long long)rev).bind(2, project).bind(3, kv.first).step(); ++changed;
            }
            if (body.has("events")) for (size_t i = 0; i < body.at("events").size(); ++i) {
                const json::Value& ev = body.at("events")[i];
                Stmt s(db_, "INSERT INTO events(project_id,rev,time,type,element_id,payload_json) VALUES(?,?,?,?,?,?)");
                s.bind(1, project).bind(2, (long long)rev).bind(3, str(ev, "time").empty() ? now_iso() : str(ev, "time")).bind(4, str(ev, "type")).bind(5, str(ev, "element")).bind(6, json::dump(ev, false)).step();
            }
            std::string hash = model_hash(project);
            { Stmt s(db_, "UPDATE revisions SET model_hash=? WHERE project_id=? AND rev=?"); s.bind(1, hash).bind(2, project).bind(3, (long long)rev).step(); }
            exec("COMMIT");
            json::Value r = json::Value::object(); r.set("rev", (double)rev); r.set("parent_rev", (double)parent); r.set("model_hash", hash); r.set("changed", changed);
            r.set("client_hash_agrees", client_hash.empty() ? json::Value() : json::Value(client_hash == hash));
            return r;
        } catch (...) { exec("ROLLBACK"); throw; }
    }

    json::Value load(const std::string& project) {
        json::Value out = json::Value::object();
        out.set("project", project); out.set("rev", (double)latest_rev(project));
        auto els = load_elements(project);
        out.set("model_hash", sha256::of(canonical(els)));
        out.set("elements", elements_json(els));
        return out;
    }
    json::Value history(const std::string& project) {
        json::Value out = json::Value::array();
        Stmt s(db_, "SELECT rev,parent_rev,time,message,actor,model_hash FROM revisions WHERE project_id=? ORDER BY rev"); s.bind(1, project);
        while (s.step()) { json::Value o = json::Value::object(); o.set("rev", (double)s.i64(0)); o.set("parent_rev", (double)s.i64(1)); o.set("time", s.text(2)); o.set("message", s.text(3)); o.set("actor", s.text(4)); o.set("model_hash", s.text(5)); out.push(o); }
        return out;
    }
    json::Value events(const std::string& project, long since_seq = 0) {
        json::Value out = json::Value::array();
        Stmt s(db_, "SELECT seq,rev,time,type,element_id,payload_json FROM events WHERE project_id=? AND seq>? ORDER BY seq"); s.bind(1, project).bind(2, (long long)since_seq);
        while (s.step()) { json::Value o = json::parse(s.text(5)); o.set("seq", (double)s.i64(0)); o.set("rev", (double)s.i64(1)); out.push(o); }
        return out;
    }
    // Parameter history of one element: every row ever written, oldest first.
    json::Value element_history(const std::string& project, const std::string& id) {
        json::Value out = json::Value::array();
        Stmt s(db_, "SELECT rev,name,value_json,unit FROM parameters WHERE project_id=? AND element_id=? ORDER BY rev,name"); s.bind(1, project).bind(2, id);
        while (s.step()) { json::Value o = json::Value::object(); o.set("rev", (double)s.i64(0)); o.set("name", s.text(1)); o.set("value_json", s.text(2)); o.set("unit", s.text(3)); out.push(o); }
        return out;
    }

    static json::Value elements_json(const std::vector<Element>& els) {
        json::Value arr = json::Value::array();
        for (auto& e : els) {
            json::Value o = json::Value::object(); o.set("id", e.id); o.set("type", e.type); o.set("name", e.name); o.set("parent", e.parent);
            o.set("created_rev", (double)e.created_rev);
            json::Value ps = json::Value::object();
            for (auto& p : e.params) { json::Value pv = json::Value::object(); pv.set("v", p.value_json); pv.set("unit", p.unit); ps.set(p.name, pv); }
            o.set("params", ps);
            if (e.has_prov) { json::Value pv = json::Value::object(); pv.set("source", e.prov.source_id); pv.set("trace", e.prov.trace_id); pv.set("method", e.prov.method); pv.set("note", e.prov.note); o.set("provenance", pv); }
            arr.push(o);
        }
        return arr;
    }
    static std::vector<Element> parse_elements(const json::Value& arr) {
        std::vector<Element> out;
        for (size_t i = 0; i < arr.size(); ++i) {
            const json::Value& o = arr[i]; Element e;
            e.id = str(o, "id"); e.type = str(o, "type"); e.name = str(o, "name"); e.parent = str(o, "parent");
            if (e.id.empty() || e.type.empty()) throw std::runtime_error("element needs id and type");
            if (o.has("params") && o.at("params").is_object()) {
                const json::Value& ps = o.at("params");
                for (auto& kv : *ps.obj) {
                    const json::Value& pv = kv.second;
                    if (!pv.is_object() || !pv.has("v") || !pv.at("v").is_string()) throw std::runtime_error("parameter " + kv.first + " must be {v: <json text>, unit}");
                    e.params.push_back({ kv.first, pv.at("v").as_string(), str(pv, "unit") });
                }
                std::sort(e.params.begin(), e.params.end(), [](const Param& a, const Param& b) { return a.name < b.name; });
            }
            if (o.has("provenance") && o.at("provenance").is_object()) { const json::Value& p = o.at("provenance"); e.has_prov = true; e.prov = { str(p, "source"), str(p, "trace"), str(p, "method"), str(p, "note") }; }
            out.push_back(e);
        }
        return out;
    }

private:
    sqlite3* db_ = nullptr;

    static std::string str(const json::Value& o, const char* k) { const json::Value* v = o.find(k); return v && v->is_string() ? v->as_string() : ""; }

    void exec(const char* sql) { char* err = nullptr; if (sqlite3_exec(db_, sql, nullptr, nullptr, &err) != SQLITE_OK) { std::string m = err ? err : "?"; sqlite3_free(err); throw std::runtime_error("sqlite: " + m); } }

    struct Stmt {
        sqlite3_stmt* s = nullptr;
        Stmt(sqlite3* db, const char* sql) { if (sqlite3_prepare_v2(db, sql, -1, &s, nullptr) != SQLITE_OK) throw std::runtime_error(std::string("sqlite prepare: ") + sqlite3_errmsg(db) + " in " + sql); }
        ~Stmt() { sqlite3_finalize(s); }
        Stmt& bind(int i, const std::string& v) { sqlite3_bind_text(s, i, v.c_str(), (int)v.size(), SQLITE_TRANSIENT); return *this; }
        Stmt& bind(int i, long long v) { sqlite3_bind_int64(s, i, v); return *this; }
        Stmt& bind_blob(int i, const std::string& v) { sqlite3_bind_blob(s, i, v.data(), (int)v.size(), SQLITE_TRANSIENT); return *this; }
        bool step() { int r = sqlite3_step(s); if (r == SQLITE_ROW) return true; if (r == SQLITE_DONE) return false; throw std::runtime_error(std::string("sqlite step: ") + sqlite3_errmsg(sqlite3_db_handle(s))); }
        std::string text(int c) { const unsigned char* t = sqlite3_column_text(s, c); return t ? (const char*)t : ""; }
        std::string blob(int c) { const void* p = sqlite3_column_blob(s, c); int n = sqlite3_column_bytes(s, c); return p ? std::string((const char*)p, n) : ""; }
        long long i64(int c) { return sqlite3_column_int64(s, c); }
    };

    void schema() {
        exec(R"SQL(
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO meta(key,value) VALUES('schema_version','1');
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources(id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT, title TEXT, url TEXT, author TEXT, license TEXT, status TEXT, attribution TEXT, artifact_sha TEXT, meta_json TEXT, updated TEXT, PRIMARY KEY(project_id,id));
CREATE TABLE IF NOT EXISTS artifacts(sha TEXT PRIMARY KEY, mime TEXT, filename TEXT, bytes BLOB, size INTEGER, created TEXT);
CREATE TABLE IF NOT EXISTS revisions(rev INTEGER NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), parent_rev INTEGER, time TEXT, message TEXT, actor TEXT, model_hash TEXT, PRIMARY KEY(project_id,rev));
CREATE TABLE IF NOT EXISTS elements(project_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, name TEXT, parent_id TEXT, created_rev INTEGER NOT NULL, deleted_rev INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id,id));
CREATE TABLE IF NOT EXISTS parameters(project_id TEXT NOT NULL, element_id TEXT NOT NULL, name TEXT NOT NULL, value_json TEXT NOT NULL, unit TEXT, rev INTEGER NOT NULL, PRIMARY KEY(project_id,element_id,name,rev));
CREATE INDEX IF NOT EXISTS parameters_latest ON parameters(project_id,element_id,name,rev);
CREATE TABLE IF NOT EXISTS provenance(project_id TEXT NOT NULL, element_id TEXT NOT NULL, rev INTEGER NOT NULL, source_id TEXT, trace_id TEXT, method TEXT, note TEXT, PRIMARY KEY(project_id,element_id,rev));
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, rev INTEGER, time TEXT, type TEXT, element_id TEXT, payload_json TEXT);
CREATE TABLE IF NOT EXISTS functions(name TEXT NOT NULL, version TEXT NOT NULL, hash TEXT, created TEXT, PRIMARY KEY(name,version));
CREATE TABLE IF NOT EXISTS results(project_id TEXT NOT NULL, element_id TEXT NOT NULL, function TEXT NOT NULL, version TEXT NOT NULL, input_hash TEXT NOT NULL, output_json TEXT, rev INTEGER, PRIMARY KEY(project_id,element_id,function,version,input_hash));
)SQL");
    }
};

}
