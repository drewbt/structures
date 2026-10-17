// gate.cpp - the service gate: SHA-256 against FIPS vectors, the store's round trip, revision
// chain, only-changed-rows, deletion as history, tombstoned parameters, conflict detection, and
// the canonical model hash. Exit 0 all pass, 1 otherwise. Each line is a claim with its evidence.
#include "sha256.h"
#include "store.h"
#include <cstdio>
#include <cstdlib>
#include <string>
#ifndef _WIN32
#include <unistd.h>
#endif

static int fails = 0, passes = 0;
static void check(bool ok, const std::string& what, const std::string& evidence) {
    std::printf("%s  %s: %s\n", ok ? "pass" : "FAIL", what.c_str(), evidence.c_str()); (ok ? passes : fails)++;
}
static std::string tmpdb() {
#ifdef _WIN32
    const char* t = std::getenv("TEMP"); std::string d = t ? t : "."; return d + "\\coral-gate.db";
#else
    const char* t = std::getenv("TMPDIR"); std::string d = t ? t : "/tmp"; return d + "/coral-gate-" + std::to_string((long)getpid()) + ".db";
#endif
}

int main() {
    // ---- SHA-256: FIPS 180-4 vectors (the same three in tests/unit/hash.test.mjs) ------------------
    check(sha256::of("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 'abc'", sha256::of("abc"));
    check(sha256::of("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256 ''", sha256::of(""));
    check(sha256::of("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") == "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", "sha256 56-byte block boundary", "FIPS vector 2");
    std::string million(1000000, 'a');
    check(sha256::of(million) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "sha256 one million 'a'", "FIPS vector 3");

    // ---- the store ----------------------------------------------------------------------------------
    std::string path = tmpdb(); std::remove(path.c_str()); std::remove((path + "-wal").c_str()); std::remove((path + "-shm").c_str());
    {
        store::Store st(path);
        st.ensure_project("gate", "Gate project");
        check(st.latest_rev("gate") == 0, "empty project has rev 0", std::to_string(st.latest_rev("gate")));
        check(st.model_hash("gate") == sha256::of(""), "empty model hashes the empty canonical text", st.model_hash("gate"));

        // commit 1: a level and a wall with provenance
        json::Value body = json::parse(R"({
          "message": "first trace", "actor": "gate", "events": [{"type":"element.create","element":"L0"},{"type":"element.create","element":"W1"}],
          "elements": [
            {"id":"L0","type":"level","name":"Ground","parent":"","params":{"elevation":{"v":"0","unit":"m"},"height":{"v":"3","unit":"m"}}},
            {"id":"W1","type":"wall","name":"W1","parent":"L0","params":{"start":{"v":"[0,0]","unit":"m"},"end":{"v":"[6,0]","unit":"m"},"thickness":{"v":"0.2","unit":"m"}},
             "provenance":{"source":"src-fixture","trace":"T1","method":"measured","note":"traced on the fixture"}}
          ]})");
        json::Value r1 = st.commit("gate", body);
        check(r1.at("rev").as_int() == 1, "first commit is rev 1", json::dump(r1, false));
        check(r1.at("changed").as_int() == 8, "first commit wrote 2 element rows + 5 parameter rows + 1 provenance row", std::to_string(r1.at("changed").as_int()));
        // The expected canonical text, written by hand, not by the code under test:
        std::string canon = "L0\tlevel\tGround\t\n\televation\t0\tm\n\theight\t3\tm\n"
                            "W1\twall\tW1\tL0\n\tend\t[6,0]\tm\n\tstart\t[0,0]\tm\n\tthickness\t0.2\tm\n\t@prov\tsrc-fixture\tT1\tmeasured\n";
        check(r1.at("model_hash").as_string() == sha256::of(canon), "model hash is sha256 of the hand-written canonical text", r1.at("model_hash").as_string().substr(0, 16) + "…");

        json::Value m = st.load("gate");
        check(m.at("elements").size() == 2 && m.at("rev").as_int() == 1, "load returns both elements at rev 1", std::to_string(m.at("elements").size()));
        const json::Value& w = m.at("elements")[1];
        check(w.at("id").as_string() == "W1" && w.at("params").at("thickness").at("v").as_string() == "0.2" && w.at("params").at("thickness").at("unit").as_string() == "m", "wall thickness round-trips as the exact text '0.2' m", w.at("params").at("thickness").at("v").as_string());
        check(w.at("provenance").at("method").as_string() == "measured" && w.at("provenance").at("trace").as_string() == "T1", "provenance round-trips", json::dump(w.at("provenance"), false));

        // commit 2: change one parameter only -> one new parameter row, nothing else
        json::Value body2 = json::parse(json::dump(body, false));
        body2.set("message", "thicken W1"); body2.set("events", json::Value::array());
        json::Value& wall2 = (*body2.at("elements").arr)[1];
        json::Value params2 = json::Value::object();
        for (auto& kv : *wall2.at("params").obj) params2.set(kv.first, kv.second);
        json::Value thick = json::Value::object(); thick.set("v", "0.25"); thick.set("unit", "m");
        params2.set("thickness", thick); wall2.set("params", params2); body2.set("parent_rev", 1);
        json::Value r2 = st.commit("gate", body2);
        check(r2.at("rev").as_int() == 2 && r2.at("changed").as_int() == 1, "changing one parameter writes exactly one row at rev 2", json::dump(r2, false));
        json::Value h = st.element_history("gate", "W1");
        check(h.size() == 4 && h[3].at("rev").as_int() == 2 && h[3].at("value_json").as_string() == "0.25", "W1 history holds 3 rows at rev 1 and the new thickness at rev 2", std::to_string(h.size()));
        check(st.load("gate").at("elements")[1].at("params").at("thickness").at("v").as_string() == "0.25", "latest value is read back", "0.25");

        // stale parent -> conflict, nothing written
        body2.set("parent_rev", 1);
        json::Value r3 = st.commit("gate", body2);
        check(r3.has("conflict") && r3.at("rev").as_int() == 2 && st.latest_rev("gate") == 2, "a commit against a stale parent_rev is refused and writes nothing", json::dump(r3, false));

        // commit 3: drop the wall -> deleted_rev set, history kept, hash is the level alone
        json::Value body3 = json::parse(R"({"message":"remove W1","elements":[{"id":"L0","type":"level","name":"Ground","parent":"","params":{"elevation":{"v":"0","unit":"m"},"height":{"v":"3","unit":"m"}}}]})");
        json::Value r4 = st.commit("gate", body3);
        check(r4.at("rev").as_int() == 3 && st.load("gate").at("elements").size() == 1, "deleting an element hides it from load at rev 3", std::to_string(st.load("gate").at("elements").size()));
        check(st.element_history("gate", "W1").size() == 4, "the deleted element's parameter history is kept", "4 rows");
        check(r4.at("model_hash").as_string() == sha256::of("L0\tlevel\tGround\t\n\televation\t0\tm\n\theight\t3\tm\n"), "hash after deletion is the level's canonical text alone", r4.at("model_hash").as_string().substr(0, 16) + "…");

        // commit 4: a parameter removed from an element is tombstoned, not resurrected
        json::Value body4 = json::parse(R"({"message":"drop height","elements":[{"id":"L0","type":"level","name":"Ground","parent":"","params":{"elevation":{"v":"0","unit":"m"}}}]})");
        st.commit("gate", body4);
        json::Value l = st.load("gate");
        check(!l.at("elements")[0].at("params").has("height"), "a parameter the client dropped does not come back on load", json::dump(l.at("elements")[0].at("params"), false));

        json::Value hist = st.history("gate");
        check(hist.size() == 4 && hist[3].at("parent_rev").as_int() == 3, "history lists 4 revisions chained by parent_rev", std::to_string(hist.size()));
        json::Value ev = st.events("gate");
        check(ev.size() == 2 && ev[0].at("type").as_string() == "element.create", "events are appended and read back in order", std::to_string(ev.size()));

        // sources and artifacts
        json::Value src = json::parse(R"({"kind":"archdaily","title":"Section Haus","url":"https://www.archdaily.com/975178/section-haus-debaixo-do-bloco-arquitetura","author":"Debaixo do Bloco Arquitetura","license":"unknown","status":"not-acquired","attribution":"ArchDaily","meta":{"missing":["plans","sections"]}})");
        src.set("id", "src-archdaily"); st.put_source("gate", src);
        json::Value ss = st.list_sources("gate");
        check(ss.size() == 1 && ss[0].at("status").as_string() == "not-acquired" && ss[0].at("meta").at("missing").size() == 2, "a source registers with its status and meta", json::dump(ss[0].at("meta"), false));
        std::string sha = st.put_artifact("image/svg+xml", "<svg/>", "fixture.svg");
        std::string mime, bytes, fn; bool got = st.get_artifact(sha, mime, bytes, fn);
        check(got && bytes == "<svg/>" && mime == "image/svg+xml" && sha == sha256::of("<svg/>"), "an artifact is stored by its content hash and read back", sha.substr(0, 16) + "…");
    }
    // reopen: everything persists across process lifetime
    {
        store::Store st(path);
        check(st.latest_rev("gate") == 4 && st.load("gate").at("elements").size() == 1, "reopening the file finds rev 4 and the one live element", "persisted");
    }
    std::remove(path.c_str()); std::remove((path + "-wal").c_str()); std::remove((path + "-shm").c_str());
    std::printf("\n%d pass, %d fail\n", passes, fails);
    return fails ? 1 : 0;
}
