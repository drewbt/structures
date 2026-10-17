# Coral Concrete

Parametric design → engineering → fabrication → construction simulation for reinforced-concrete
buildings, starting from a published architectural drawing. Specification FI-CONC-006.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) for what exists, [REQUIREMENTS.md](REQUIREMENTS.md) for
status against the specification, and [NEXT_ACTION.md](NEXT_ACTION.md) for the next step.**

## Run

```
cmake -S . -B build && cmake --build build -j
./build/coral-service --db coral.db --app app --port 8790
```
Open http://127.0.0.1:8790/?project=section-haus. Pages: 00 Source (register the source, import a
drawing, or register the synthetic fixture), 01 Trace (Calibrate on a scale bar → Origin → Wall /
Column / Slab / Opening), 02 Architecture (3D, properties, section cut, export). Save commits a
revision to SQLite; Reload reads it back.

Needs a C++17 compiler, CMake ≥ 3.15 and the SQLite development library (`libsqlite3-dev` on Debian/
Ubuntu; the Xcode SDK on macOS; see ASSUMPTIONS.md A-05 for Windows).

## Test

```
./tests/run.sh
```
Runs the C++ service gate, the JavaScript unit tests (`node --test`) and the end-to-end slice in
headless Chromium (Playwright). Node and Playwright are development tools only; the product does not
need them. See TEST_REGISTRY.md.

## Layout

`service/` C++ local service (HTTP + SQLite) · `app/` the browser app (vanilla JS, web components,
WebGL) · `tests/` gates · the `*.md` standing records.
