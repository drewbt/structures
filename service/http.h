// http.h - a small HTTP/1.1 server, blocking, one request at a time, POSIX sockets or Winsock.
//
// Why a server in C++ and not a node script: ARCHITECTURE.md rules no Node.js runtime dependency.
// The service serves the app's static files and the SQLite-backed model API on localhost. It is
// local-first: the same binary can bind a non-loopback address for optional remote execution.
//
// Scope, deliberately: GET/POST/PUT/DELETE, Content-Length bodies up to `max_body`, no chunked
// upload, no keep-alive negotiation beyond honouring Connection: close. Enough for one browser tab
// on one machine; a second user is a second process.
#pragma once
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <map>
#include <string>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
typedef SOCKET sock_t;
#define SOCK_INVALID INVALID_SOCKET
inline void sock_close(sock_t s) { closesocket(s); }
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
typedef int sock_t;
#define SOCK_INVALID (-1)
inline void sock_close(sock_t s) { ::close(s); }
#endif

namespace http {

struct Request {
    std::string method, path, query, body;
    std::map<std::string, std::string> headers;   // lower-case keys
    std::map<std::string, std::string> params;    // from the query string
    std::string header(const std::string& k) const { auto it = headers.find(k); return it == headers.end() ? "" : it->second; }
};
struct Response {
    int status = 200;
    std::string type = "application/json; charset=utf-8";
    std::string body;
    std::map<std::string, std::string> headers;
    static Response json(const std::string& b, int s = 200) { Response r; r.status = s; r.body = b; return r; }
    static Response text(const std::string& b, int s = 200) { Response r; r.status = s; r.type = "text/plain; charset=utf-8"; r.body = b; return r; }
    static Response error(int s, const std::string& msg) { return json("{\"error\":\"" + msg + "\"}", s); }
};
using Handler = std::function<Response(const Request&)>;

inline std::string url_decode(const std::string& s) {
    std::string o; for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size()) { o += (char)std::strtol(s.substr(i + 1, 2).c_str(), nullptr, 16); i += 2; }
        else if (s[i] == '+') o += ' '; else o += s[i];
    } return o;
}
inline const char* reason(int s) {
    switch (s) { case 200: return "OK"; case 201: return "Created"; case 204: return "No Content"; case 304: return "Not Modified";
        case 400: return "Bad Request"; case 404: return "Not Found"; case 405: return "Method Not Allowed"; case 409: return "Conflict";
        case 413: return "Payload Too Large"; case 500: return "Internal Server Error"; default: return "Status"; }
}

class Server {
public:
    size_t max_body = 256u << 20;   // 256 MB: a scanned drawing set fits
    bool verbose = false;

    bool listen(const std::string& host, int port) {
#ifdef _WIN32
        WSADATA w; WSAStartup(MAKEWORD(2, 2), &w);
#endif
        srv_ = ::socket(AF_INET, SOCK_STREAM, 0);
        if (srv_ == SOCK_INVALID) return false;
        int one = 1;
#ifdef _WIN32
        setsockopt(srv_, SOL_SOCKET, SO_REUSEADDR, (const char*)&one, sizeof one);
#else
        setsockopt(srv_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
#endif
        sockaddr_in a; std::memset(&a, 0, sizeof a); a.sin_family = AF_INET; a.sin_port = htons((unsigned short)port);
        if (inet_pton(AF_INET, host.c_str(), &a.sin_addr) != 1) return false;
        if (::bind(srv_, (sockaddr*)&a, sizeof a) != 0) return false;
        if (::listen(srv_, 16) != 0) return false;
        return true;
    }
    int port() const {
        sockaddr_in a; socklen_t n = sizeof a; if (getsockname(srv_, (sockaddr*)&a, &n) != 0) return 0; return ntohs(a.sin_port);
    }
    // Serve forever (or until `stop` returns true between requests).
    void run(const Handler& h, const std::function<bool()>& stop = nullptr) {
        for (;;) {
            if (stop && stop()) break;
            sock_t c = ::accept(srv_, nullptr, nullptr);
            if (c == SOCK_INVALID) continue;
            handle(c, h);
            sock_close(c);
        }
    }
    void close() { if (srv_ != SOCK_INVALID) sock_close(srv_); srv_ = SOCK_INVALID; }

private:
    sock_t srv_ = SOCK_INVALID;

    static bool recv_until_headers(sock_t c, std::string& buf, size_t& hdr_end) {
        char tmp[16384];
        for (;;) {
            size_t p = buf.find("\r\n\r\n"); if (p != std::string::npos) { hdr_end = p + 4; return true; }
            if (buf.size() > 1u << 20) return false;
            int n = (int)::recv(c, tmp, sizeof tmp, 0); if (n <= 0) return false; buf.append(tmp, n);
        }
    }
    static void send_all(sock_t c, const std::string& s) {
        size_t off = 0; while (off < s.size()) { int n = (int)::send(c, s.data() + off, (int)(s.size() - off), 0); if (n <= 0) return; off += n; }
    }
    void handle(sock_t c, const Handler& h) {
        std::string buf; size_t hdr_end = 0;
        if (!recv_until_headers(c, buf, hdr_end)) return;
        Request r;
        size_t line_end = buf.find("\r\n");
        std::string line = buf.substr(0, line_end);
        size_t s1 = line.find(' '), s2 = line.find(' ', s1 + 1);
        if (s1 == std::string::npos || s2 == std::string::npos) { respond(c, Response::error(400, "bad request line"), r); return; }
        r.method = line.substr(0, s1);
        std::string target = line.substr(s1 + 1, s2 - s1 - 1);
        size_t q = target.find('?');
        r.path = url_decode(q == std::string::npos ? target : target.substr(0, q));
        if (q != std::string::npos) {
            r.query = target.substr(q + 1);
            size_t i = 0; while (i <= r.query.size()) { size_t e = r.query.find('&', i); if (e == std::string::npos) e = r.query.size();
                std::string kv = r.query.substr(i, e - i); size_t eq = kv.find('=');
                if (!kv.empty()) r.params[url_decode(kv.substr(0, eq))] = eq == std::string::npos ? "" : url_decode(kv.substr(eq + 1));
                i = e + 1; }
        }
        size_t pos = line_end + 2;
        while (pos < hdr_end - 2) {
            size_t e = buf.find("\r\n", pos); std::string hl = buf.substr(pos, e - pos); pos = e + 2;
            size_t col = hl.find(':'); if (col == std::string::npos) continue;
            std::string k = hl.substr(0, col), v = hl.substr(col + 1);
            for (auto& ch : k) ch = (char)tolower((unsigned char)ch);
            size_t a = v.find_first_not_of(" \t"); v = a == std::string::npos ? "" : v.substr(a);
            r.headers[k] = v;
        }
        size_t len = (size_t)std::strtoull(r.header("content-length").c_str(), nullptr, 10);
        if (len > max_body) { respond(c, Response::error(413, "body too large"), r); return; }
        r.body = buf.substr(hdr_end);
        char tmp[65536];
        while (r.body.size() < len) { int n = (int)::recv(c, tmp, sizeof tmp, 0); if (n <= 0) return; r.body.append(tmp, n); }
        r.body.resize(len);
        Response resp;
        try { resp = h(r); } catch (const std::exception& e) { resp = Response::error(500, e.what()); }
        if (verbose) std::fprintf(stderr, "%s %s -> %d (%zu bytes)\n", r.method.c_str(), r.path.c_str(), resp.status, resp.body.size());
        respond(c, resp, r);
    }
    static void respond(sock_t c, const Response& resp, const Request& r) {
        std::string out = "HTTP/1.1 " + std::to_string(resp.status) + " " + reason(resp.status) + "\r\n";
        out += "Content-Type: " + resp.type + "\r\n";
        out += "Content-Length: " + std::to_string(resp.body.size()) + "\r\n";
        out += "Cache-Control: no-store\r\nConnection: close\r\n";
        for (auto& kv : resp.headers) out += kv.first + ": " + kv.second + "\r\n";
        out += "\r\n";
        if (r.method != "HEAD") out += resp.body;
        send_all(c, out);
    }
};

}
