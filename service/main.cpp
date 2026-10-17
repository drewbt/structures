// main.cpp - coral-service: serves app/ and the model API on localhost, SQLite behind it.
//
//   coral-service [--db coral.db] [--app ./app] [--host 127.0.0.1] [--port 8790] [--verbose]
//
// API (all JSON unless stated):
//   GET  /api/health                         {ok, schema_version, sqlite}
//   GET  /api/projects                       [{id,name,created,rev}]
//   GET  /api/projects/:p/model              {project, rev, model_hash, elements[]}
//   POST /api/projects/:p/commit             body {parent_rev?, message, actor, model_hash?, elements[], events[]} -> {rev, model_hash, changed, client_hash_agrees} or {conflict, rev}
//   GET  /api/projects/:p/history            [{rev, parent_rev, time, message, actor, model_hash}]
//   GET  /api/projects/:p/events?since=seq   [events]
//   GET  /api/projects/:p/elements/:id/history
//   GET  /api/projects/:p/sources            [sources]
//   PUT  /api/projects/:p/sources/:id        body = source
//   POST /api/artifacts  (body = bytes, Content-Type = mime, X-Filename)  -> {sha, size}
//   GET  /api/artifacts/:sha                 the bytes with their mime
// Anything else: a file under --app, index.html for "/".
#include "http.h"
#include "json.h"
#include "store.h"
#include <cstdio>
#include <fstream>
#include <sstream>

static std::string mime_of(const std::string& path) {
    size_t d = path.rfind('.'); std::string ext = d == std::string::npos ? "" : path.substr(d);
    static const std::map<std::string, std::string> types = {
        { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".mjs", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" }, { ".json", "application/json" }, { ".svg", "image/svg+xml" }, { ".png", "image/png" },
        { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".wasm", "application/wasm" }, { ".md", "text/plain; charset=utf-8" }, { ".txt", "text/plain; charset=utf-8" } };
    auto it = types.find(ext); return it == types.end() ? "application/octet-stream" : it->second;
}
static bool read_file(const std::string& path, std::string& out) {
    std::ifstream f(path, std::ios::binary); if (!f) return false; std::ostringstream ss; ss << f.rdbuf(); out = ss.str(); return true;
}
static std::vector<std::string> split(const std::string& s, char c) {
    std::vector<std::string> out; size_t i = 0; while (i <= s.size()) { size_t e = s.find(c, i); if (e == std::string::npos) e = s.size(); if (e > i) out.push_back(s.substr(i, e - i)); i = e + 1; } return out;
}

int main(int argc, char** argv) {
    std::string db = "coral.db", app = "app", host = "127.0.0.1"; int port = 8790; bool verbose = false;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--db" && i + 1 < argc) db = argv[++i]; else if (a == "--app" && i + 1 < argc) app = argv[++i];
        else if (a == "--host" && i + 1 < argc) host = argv[++i]; else if (a == "--port" && i + 1 < argc) port = std::atoi(argv[++i]);
        else if (a == "--verbose") verbose = true;
        else { std::fprintf(stderr, "usage: coral-service [--db file] [--app dir] [--host ip] [--port n] [--verbose]\n"); return 2; }
    }
    store::Store st(db);
    http::Server srv; srv.verbose = verbose;
    if (!srv.listen(host, port)) { std::fprintf(stderr, "cannot listen on %s:%d\n", host.c_str(), port); return 1; }
    std::printf("coral-service: db %s, app %s, http://%s:%d/\n", db.c_str(), app.c_str(), host.c_str(), srv.port()); std::fflush(stdout);

    srv.run([&](const http::Request& r) -> http::Response {
        using http::Response;
        auto parts = split(r.path, '/');
        if (!parts.empty() && parts[0] == "api") {
            if (parts.size() == 2 && parts[1] == "health") {
                json::Value o = json::Value::object(); o.set("ok", true); o.set("schema_version", store::Store::schema_version()); o.set("sqlite", sqlite3_libversion()); return Response::json(json::dump(o, false));
            }
            if (parts.size() == 2 && parts[1] == "projects" && r.method == "GET") return Response::json(json::dump(st.list_projects(), false));
            if (parts.size() == 2 && parts[1] == "artifacts" && r.method == "POST") {
                std::string sha = st.put_artifact(r.header("content-type"), r.body, r.header("x-filename"));
                json::Value o = json::Value::object(); o.set("sha", sha); o.set("size", (double)r.body.size()); return Response::json(json::dump(o, false), 201);
            }
            if (parts.size() == 3 && parts[1] == "artifacts" && r.method == "GET") {
                std::string mime, bytes, fn; if (!st.get_artifact(parts[2], mime, bytes, fn)) return Response::error(404, "no such artifact");
                Response resp; resp.type = mime.empty() ? "application/octet-stream" : mime; resp.body = bytes; return resp;
            }
            if (parts.size() >= 4 && parts[1] == "projects") {
                const std::string& p = parts[2]; const std::string& verb = parts[3];
                if (verb == "model" && r.method == "GET") return Response::json(json::dump(st.load(p), false));
                if (verb == "commit" && r.method == "POST") { json::Value body = json::parse(r.body); json::Value out = st.commit(p, body); return Response::json(json::dump(out, false), out.has("conflict") ? 409 : 200); }
                if (verb == "history" && r.method == "GET") return Response::json(json::dump(st.history(p), false));
                if (verb == "events" && r.method == "GET") { long since = r.params.count("since") ? std::atol(r.params.at("since").c_str()) : 0; return Response::json(json::dump(st.events(p, since), false)); }
                if (verb == "elements" && parts.size() == 6 && parts[5] == "history" && r.method == "GET") return Response::json(json::dump(st.element_history(p, parts[4]), false));
                if (verb == "sources" && parts.size() == 4 && r.method == "GET") return Response::json(json::dump(st.list_sources(p), false));
                if (verb == "sources" && parts.size() == 5 && (r.method == "PUT" || r.method == "POST")) { json::Value src = json::parse(r.body); src.set("id", parts[4]); st.put_source(p, src); return Response::json("{\"ok\":true}"); }
            }
            return Response::error(404, "no such route");
        }
        // static files
        std::string rel = r.path == "/" ? "/index.html" : r.path;
        if (rel.find("..") != std::string::npos) return Response::error(404, "not found");
        std::string bytes; if (!read_file(app + rel, bytes)) return Response::text("not found", 404);
        Response resp; resp.type = mime_of(rel); resp.body = bytes; return resp;
    });
    return 0;
}
