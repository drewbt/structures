// Vendored verbatim from drewbt/stiffness src/json.h at commit d836c1fb28c6c32f7e91f4620c1db52962b2b6de (2026-10-17).
// Reused, not rewritten (DECISIONS.md D-03). Fix upstream first, then re-vendor.
// json.h — a small JSON reader and writer, no dependencies.
// Numbers are kept as double and written with 17 significant digits so a solve round-trips exactly.
#pragma once
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace json {

struct Value;
using Array = std::vector<Value>;
using Object = std::vector<std::pair<std::string, Value>>;   // insertion order kept

struct Value {
    enum Kind { Null, Bool, Number, String, ArrayK, ObjectK } kind = Null;
    bool b = false;
    double num = 0;
    std::string str;
    std::shared_ptr<Array> arr;
    std::shared_ptr<Object> obj;

    Value() = default;
    Value(bool v) : kind(Bool), b(v) {}
    Value(int v) : kind(Number), num(v) {}
    Value(double v) : kind(Number), num(v) {}
    Value(const char* s) : kind(String), str(s) {}
    Value(std::string s) : kind(String), str(std::move(s)) {}
    Value(Array a) : kind(ArrayK), arr(std::make_shared<Array>(std::move(a))) {}
    Value(Object o) : kind(ObjectK), obj(std::make_shared<Object>(std::move(o))) {}
    static Value array() { return Value(Array{}); }
    static Value object() { return Value(Object{}); }

    // a flag written by a module of ours is a JSON true, but a module that wrote 1 meant the same
    // thing; both read as a flag here, and anything else is false rather than an exception, because
    // a missing flag is not an error in a file we did not write
    bool as_bool() const { return kind == Bool ? b : kind == Number ? num != 0 : false; }
    bool is_null() const { return kind == Null; }
    bool is_array() const { return kind == ArrayK; }
    bool is_object() const { return kind == ObjectK; }
    bool is_number() const { return kind == Number; }
    bool is_string() const { return kind == String; }

    // object access
    const Value* find(const std::string& key) const {
        if (kind != ObjectK) return nullptr;
        for (auto& kv : *obj) if (kv.first == key) return &kv.second;
        return nullptr;
    }
    const Value& at(const std::string& key) const {
        const Value* v = find(key);
        if (!v) throw std::runtime_error("json: missing key \"" + key + "\"");
        return *v;
    }
    bool has(const std::string& key) const { return find(key) != nullptr; }
    Value& set(const std::string& key, Value v) {
        if (kind != ObjectK) { kind = ObjectK; obj = std::make_shared<Object>(); }
        for (auto& kv : *obj) if (kv.first == key) { kv.second = std::move(v); return kv.second; }
        obj->emplace_back(key, std::move(v));
        return obj->back().second;
    }
    // array access
    size_t size() const { return kind == ArrayK ? arr->size() : kind == ObjectK ? obj->size() : 0; }
    const Value& operator[](size_t i) const { return (*arr)[i]; }
    void push(Value v) { if (kind != ArrayK) { kind = ArrayK; arr = std::make_shared<Array>(); } arr->push_back(std::move(v)); }

    double as_number() const { if (kind != Number) throw std::runtime_error("json: not a number"); return num; }
    int as_int() const { return (int)std::lround(as_number()); }
    const std::string& as_string() const { if (kind != String) throw std::runtime_error("json: not a string"); return str; }
    std::vector<double> as_doubles() const {
        if (kind != ArrayK) throw std::runtime_error("json: not an array");
        std::vector<double> out; out.reserve(arr->size());
        for (auto& v : *arr) out.push_back(v.as_number());
        return out;
    }
    std::vector<int> as_ints() const {
        if (kind != ArrayK) throw std::runtime_error("json: not an array");
        std::vector<int> out; out.reserve(arr->size());
        for (auto& v : *arr) out.push_back(v.as_int());
        return out;
    }
    static Value from_doubles(const std::vector<double>& xs) { Array a; a.reserve(xs.size()); for (double x : xs) a.emplace_back(x); return Value(std::move(a)); }
    static Value from_ints(const std::vector<int>& xs) { Array a; a.reserve(xs.size()); for (int x : xs) a.emplace_back(x); return Value(std::move(a)); }
};

// ---------------------------------------------------------------- parse
class Parser {
public:
    explicit Parser(const char* text) : p(text), start(text) {}
    Value parse() { Value v = value(); ws(); if (*p) fail("trailing characters"); return v; }
private:
    const char* p; const char* start;
    [[noreturn]] void fail(const char* what) {
        char buf[128]; std::snprintf(buf, sizeof buf, "json: %s at offset %ld", what, (long)(p - start));
        throw std::runtime_error(buf);
    }
    void ws() { while (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t') ++p; }
    bool lit(const char* s) { size_t n = std::strlen(s); if (std::strncmp(p, s, n) == 0) { p += n; return true; } return false; }
    Value value() {
        ws();
        switch (*p) {
            case '{': return object();
            case '[': return array();
            case '"': return Value(string());
            case 't': if (lit("true")) return Value(true); fail("bad literal");
            case 'f': if (lit("false")) return Value(false); fail("bad literal");
            case 'n': if (lit("null")) return Value(); fail("bad literal");
            default: return number();
        }
    }
    Value number() {
        char* end; double d = std::strtod(p, &end);
        if (end == p) fail("expected a value");
        p = end; return Value(d);
    }
    std::string string() {
        ++p; std::string s;
        while (*p && *p != '"') {
            if (*p == '\\') {
                ++p;
                switch (*p) {
                    case '"': s += '"'; break; case '\\': s += '\\'; break; case '/': s += '/'; break;
                    case 'b': s += '\b'; break; case 'f': s += '\f'; break; case 'n': s += '\n'; break;
                    case 'r': s += '\r'; break; case 't': s += '\t'; break;
                    case 'u': {
                        unsigned code = 0; for (int i = 0; i < 4; ++i) { ++p; code = code * 16 + (unsigned)(std::isdigit((unsigned char)*p) ? *p - '0' : (std::tolower((unsigned char)*p) - 'a' + 10)); }
                        if (code < 0x80) s += (char)code;
                        else if (code < 0x800) { s += (char)(0xC0 | (code >> 6)); s += (char)(0x80 | (code & 0x3F)); }
                        else { s += (char)(0xE0 | (code >> 12)); s += (char)(0x80 | ((code >> 6) & 0x3F)); s += (char)(0x80 | (code & 0x3F)); }
                        break;
                    }
                    default: fail("bad escape");
                }
                ++p;
            } else s += *p++;
        }
        if (*p != '"') fail("unterminated string");
        ++p; return s;
    }
    Value array() {
        ++p; Array a; ws();
        if (*p == ']') { ++p; return Value(std::move(a)); }
        for (;;) { a.push_back(value()); ws(); if (*p == ',') { ++p; continue; } if (*p == ']') { ++p; break; } fail("expected , or ]"); }
        return Value(std::move(a));
    }
    Value object() {
        ++p; Object o; ws();
        if (*p == '}') { ++p; return Value(std::move(o)); }
        for (;;) {
            ws(); if (*p != '"') fail("expected a key");
            std::string k = string(); ws(); if (*p != ':') fail("expected :"); ++p;
            o.emplace_back(std::move(k), value()); ws();
            if (*p == ',') { ++p; continue; } if (*p == '}') { ++p; break; } fail("expected , or }");
        }
        return Value(std::move(o));
    }
};

inline Value parse(const std::string& text) { return Parser(text.c_str()).parse(); }

// ---------------------------------------------------------------- write
inline void write_string(std::string& out, const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break; case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break; case '\r': out += "\\r"; break; case '\t': out += "\\t"; break;
            default: if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); out += b; } else out += (char)c;
        }
    }
    out += '"';
}
inline void write_number(std::string& out, double d) {
    if (!std::isfinite(d)) { out += "null"; return; }
    if (d == std::floor(d) && std::fabs(d) < 1e15) { char b[32]; std::snprintf(b, sizeof b, "%.0f", d); out += b; return; }
    char b[32]; std::snprintf(b, sizeof b, "%.17g", d); out += b;
}
// pretty: objects one key per line; arrays of scalars on one line
inline void write(std::string& out, const Value& v, int indent = 0, bool pretty = true) {
    auto nl = [&](int n) { if (pretty) { out += '\n'; out.append((size_t)n, ' '); } };
    switch (v.kind) {
        case Value::Null: out += "null"; break;
        case Value::Bool: out += v.b ? "true" : "false"; break;
        case Value::Number: write_number(out, v.num); break;
        case Value::String: write_string(out, v.str); break;
        case Value::ArrayK: {
            out += '[';
            bool nested = false; for (auto& e : *v.arr) if (e.is_array() || e.is_object()) { nested = true; break; }
            for (size_t i = 0; i < v.arr->size(); ++i) {
                if (i) out += ',';
                if (nested) nl(indent + 1);
                write(out, (*v.arr)[i], indent + 1, pretty);
            }
            if (nested && !v.arr->empty()) nl(indent);
            out += ']'; break;
        }
        case Value::ObjectK: {
            out += '{';
            for (size_t i = 0; i < v.obj->size(); ++i) {
                if (i) out += ',';
                nl(indent + 1);
                write_string(out, (*v.obj)[i].first); out += pretty ? ": " : ":";
                write(out, (*v.obj)[i].second, indent + 1, pretty);
            }
            if (!v.obj->empty()) nl(indent);
            out += '}'; break;
        }
    }
}
inline std::string dump(const Value& v, bool pretty = true) { std::string s; write(s, v, 0, pretty); return s; }

inline std::string read_file(const std::string& path) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) throw std::runtime_error("cannot open " + path);
    std::string s; char buf[1 << 16]; size_t n;
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) s.append(buf, n);
    std::fclose(f); return s;
}
inline void write_file(const std::string& path, const std::string& text) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) throw std::runtime_error("cannot write " + path);
    std::fwrite(text.data(), 1, text.size(), f); std::fclose(f);
}

} // namespace json
