# VoltWeave

**Semantic electrical engineering, not just lines on a canvas.**

VoltWeave is a runnable, original EPLAN Electric P8-inspired electrical schematic workbench written in plain HTML, CSS and JavaScript. It includes an editable three-page example, persistent electrical identities, a connection graph, engineering tables, exports, a WebGPU vector pipeline and a Canvas 2D fallback. There are no runtime packages, frameworks, CDN assets, accounts or remote APIs.

This is an independent implementation, not an EPLAN product or a native EPLAN file reader. The implemented features work against the same project model; it is not a screenshot or static UI prototype. It is not a claim of commercial P8 feature parity or certified electrical engineering software.

## Live application and deployment

**[Open VoltWeave](https://wieslawsoltes.github.io/VoltWeave/)** · [Source repository](https://github.com/wieslawsoltes/VoltWeave) · [Build and deployment history](https://github.com/wieslawsoltes/VoltWeave/actions)

Every push to `main` runs the Node test suite, rebuilds the standalone application and publishes the static site to GitHub Pages. Pull requests run validation without publishing. The app has no backend or CDN dependencies; project data stays in your browser unless you explicitly export it.

To reproduce the static build locally:

```sh
npm test
npm run build:pages
```

The `_site/` directory contains the complete deployable website, including `index.html`, a downloadable `voltweave.html`, example documentation and a `version.json` deployment identifier. All assets are self-contained or relative, so the `/VoltWeave/` project path works without a custom domain.

## Run

### Single-file application

Open **`dist/voltweave.html`** in a browser that permits local HTML applications. Everything, including the worker, styles, symbols and example, is contained in that file. Some browsers and managed environments restrict local-file scripting or storage; the local server is the preferred route for development and WebGPU use.

### Modular source application

Use Node.js 20 or newer. The delivered tests were run with Node.js 22.

```sh
cd voltweave
npm start
```

Open `http://localhost:8080`. **There is no `npm install` step.**

An alternative port:

```sh
# macOS / Linux
PORT=8765 npm start

# Windows PowerShell
$env:PORT=8765; npm start
```

The development server binds to loopback by default. `HOST=0.0.0.0` explicitly exposes it to the local network; do not treat it as an authenticated production server. For public hosting, upload the static files to an HTTPS host, retaining the `src/` directory, or host the single HTML file. No backend is required.

Use `?renderer=canvas` to select the fallback explicitly. Use `?demo=1` only when intentionally replacing the active workspace with a newly generated example.

WebGPU is feature-detected at runtime. An available API, secure context and functioning adapter/device are required; the status bar reports the backend actually in use. Localhost or HTTPS is preferred. Adapter refusal, shader/pipeline initialization failure and device loss switch to Canvas 2D rather than disabling editing. Browser support must not be inferred from the existence of a browser brand alone.

## Included functionality

| Area | Implementation |
|---|---|
| Workspace | Ribbon, menus, page tabs, page/device navigator, symbol insert center, live properties, resizable engineering dock, command palette, focus mode and narrow-screen layout. |
| Schematic editing | Selection, shift-selection, box selection, snapped dragging/nudging, orthogonal rotations, copy/paste, duplicate, page creation/duplication/deletion, pan, cursor-anchored zoom and touch pinch. |
| Symbols | 22 built-in declarative definitions, named connection points, per-function terminal designations, intentionally spare pins, JSON symbol creation/import/export, reusable circuit macros. |
| Connections | Persistent pin UUID endpoints; automatic orthogonal routing with obstacle avoidance and a bounded A* fallback; manual waypoints; explicit wire-tap junctions; whole-net highlighting. |
| Engineering | Shared physical device identities, coil/contact references, linked views of the same function, project/location-scoped interruption points, automatic net or individual-wire numbering and number locks. |
| Equipment data | Device tags, locations, articles, ratings, terminal strips and positions, cable definitions and core assignments, editable PLC addresses/symbolic names/descriptions. |
| Verification | Advisory checks for dangling required pins, duplicate tags/designations, potential conflicts, multiple outputs, numbering conflicts, missing articles, invalid conductors, PLC assignments, strip positions and cable-core allocation. |
| Documentation | Physical-device BOM, connection list, terminal schedule, cable-core schedule, PLC assignment list and rule results; CSV, vector SVG and standalone printable HTML exports. |
| Persistence | Local IndexedDB with localStorage backup, timestamped save arbitration, synchronous unload checkpoint, portable versioned JSON projects, bounded undo/redo. |

The supplied **Conveyor drive · MCC-01** example has three pages, **21 physical devices, 96 pins, 49 wire records and 26 wired nets**. It demonstrates a three-phase motor feeder, relay control/interlocks, a shared contactor across sheets, terminal strips, a four-core cable and PLC field signals. It passes the implemented rule set, which is not equivalent to proving a safe design.

## First editing session

1. Choose a symbol in the left insert center and click inside the sheet. **R** rotates the insertion; **Escape** ends insertion. Select a placed symbol to edit its tag, article, rating, coordinates or terminal designations.
2. Press **W**, click a connection point, optionally click blank areas for manual bends, then click a second point. To branch, click an existing wire and then another pin. Merely crossing, overlapping or touching drawn lines does **not** connect them.
3. Use **Number wires** and **Check project**, then inspect the bottom engineering tabs. Click a diagnostic, device or reference to navigate to the relevant placement.
4. Use **Reports → Generate engineering documentation** for the complete project document, or export the active table to CSV/current sheet to SVG. **Project → Save** exports a portable `.vw.json` project independently of autosave.

### Devices versus functions versus reference views

A contactor coil and auxiliary contact are different electrical functions belonging to the same physical device. Insert the additional contact, then choose the existing device under **Function identity → Link to physical device**. The physical device is counted once in the BOM and all its occurrences appear in cross-references.

Another view of the *same function* is different: use **Reference view**. Its pin IDs are deliberately shared with the original. Do not use this to model a second independent physical contact. For multiple auxiliary contacts, create separate functions and give them distinct terminal designations, such as 13/14 and 23/24.

### Terminal strips, cables and PLCs

**Project data → Terminal strip** creates and places separate feed-through terminals. Each terminal is a physical item with its own UUID; its two connection points are explicitly internally bonded. Edit strip position in Properties or the terminal table.

Create a cable definition, select wires using Shift-click, and run **Assign cable cores**. Core count, cross-section, length, article and core-to-connection assignments feed the schedules and BOM. Allocation conflicts are reported rather than silently reassigned.

Insert a PLC or use the example. The PLC tab edits addresses such as `%I0.0` / `%Q0.0`, symbolic names and descriptions. Required but unused channels should be marked spare in the pin editor. The initial built-in module has four digital inputs and four digital outputs; custom symbols and the model can be extended, but PLC firmware programming and hardware communication are not implemented.

### Circuit macros and custom symbols

Select symbols and create a circuit macro. Internal wires are captured automatically. Inserting it creates fresh physical-device, function, pin, placement, strip and cable UUIDs while preserving shared-device relationships *inside* the macro. Drawings are not aliased to the source circuit. Global potential names intentionally retain their connectivity semantics. PLC addresses are copied verbatim and must be reviewed/reassigned; duplicates are reported.

Custom symbols are declarative JSON containing `id`, `name`, `category`, `prefix`, `bounds`, `pins`, `shapes`, optional `internal` pin bonds and default part properties. Supported primitives are lines, rectangles, circles, dots and text. No arbitrary JavaScript executes from a symbol definition. Use **Create / edit symbol JSON** to start from a selected symbol; `examples/custom-relay-symbol.json` is also supplied. Imported changes to the pin-key set of an in-use symbol are rejected unless existing functions remain valid.

## Keyboard commands

| Operation | Shortcut |
|---|---|
| Select / wire / pan | V / W / H |
| Temporary pan | Hold Space and drag |
| Rotate / fit page | R / F |
| Grid / snapping | G / X |
| Undo / redo | Ctrl or Command + Z / Shift + Z |
| Copy / paste / duplicate | Ctrl or Command + C / V / D |
| Select all | Ctrl or Command + A |
| Save / open | Ctrl or Command + S / O |
| Commands / properties | Ctrl or Command + K / Enter |
| Delete / cancel | Delete / Escape |
| Nudge / coarse nudge | Arrow / Shift + Arrow |
| Previous / next sheet | Page Up / Page Down |

On a narrow screen the side inspector is hidden; use Enter, double-click, or the Properties command. Focus mode hides the surrounding navigators to maximize the drawing area. Desktop mouse/keyboard use remains the primary engineering workflow.

## Build and test

```sh
npm test        # 51 Node core and storage-adapter tests
npm run build   # Regenerate dist/voltweave.html from the modular sources
npm run examples
```

`build-standalone.mjs` is a small, deliberately restricted bundler for this repository's known module graph, not a general JavaScript bundler. Always regenerate the standalone HTML after editing source modules.

Optional real-browser integration tests use Python Playwright and a Chromium executable:

```sh
pip install playwright
# With the app server running and a Chromium executable installed:
CHROMIUM=/path/to/chromium BASE_URL=http://localhost:8080 python tests/browser-integration.py
# Restricted environments that cannot navigate to local URLs:
python tests/browser-integration.py --inline
```

The delivered run passed **51 Node tests and 22 Chromium integration checks**, including real pointer-based wiring, wire branching, snapped dragging, keyboard undo/redo, navigation, engineering dialogs, PLC diagnostics, export payloads and project file import. See `TESTING.md` and `test-results/` for recorded results and precise boundaries. **WebGPU execution was not validated in this environment**: the browser test origin did not expose `navigator.gpu`. Real IndexedDB behavior also needs a normal-origin browser pass; storage ordering/recovery has unit coverage using explicit test adapters.

## Source map

```text
index.html / styles.css       Workspace shell and responsive styling
src/model.js                 Project entities, validation, transactions, undo, xrefs
src/symbols.js               Declarative electrical symbol library and transforms
src/graph.js                 Semantic nets, numbering, ERC and engineering tables
src/routing.js               Orthogonal router, A*, snapping and spatial hit index
src/scene.js                 Shared vector display list, sheet layout and SVG
src/renderer.js              WebGPU instancing and separate Canvas fallback
src/app.js                   Editing gestures, forms, commands and worker scheduling
src/analysis-worker.js       Off-main-thread graph/report analysis
src/persistence.js           Browser stores, save ordering and portable downloads
src/reports.js               CSV table schemas and printable HTML documentation
src/demo.js                  Connected three-sheet example
build-standalone.mjs          Dependency-free single-file build
server.mjs                   Optional local static server
```

## Scope and review boundaries

The geometry path uses WebGPU; typography, paper and editing overlays use Canvas 2D. The fallback uses Canvas 2D for geometry as well. The displayed milliseconds are CPU draw-submission time, **not GPU completion time or a performance benchmark**. No particular frame rate or large-project capacity is promised.

Cross-reference caches are incrementally invalidated by affected device identity. Graph analysis is a complete rebuild for the current revision in a coalesced worker; this is not a fully dynamic graph algorithm. Transactions stage a full project clone before computing sparse undo patches. These trade-offs and extension points are detailed in `ARCHITECTURE.md`.

Native EPLAN project/macro formats, vendor parts databases, collaborative editing, multi-tab merge, protection coordination, fault-current calculations, ladder/PLC execution, electrical simulation, certified IEC/NFPA rule coverage, panel manufacturing and scale-certified plotting are outside this implementation. Custom JSON, SVG and CSV are the interchange formats. Symbol geometry is original and illustrative, not a licensed or certified IEC symbol library.

Autosave is recovery convenience, not a substitute for exported versioned backups. The browser may deny storage, clear data or exhaust quota; failures are visible. Only one active workspace is stored per origin. Avoid simultaneous edits to the same origin in multiple tabs: timestamps prevent stale queued saves, not concurrent semantic merge.

**Do not use the example as construction documentation without independent engineering review.** A clean implemented ERC result does not certify safety, ratings, regulatory compliance or suitability for installation.

## References and license

MIT-licensed original application code; see `LICENSE`. EPLAN is mentioned only to identify the requested workflow inspiration; no affiliation is claimed and no proprietary EPLAN assets are included.

Primary design references: W3C WebGPU and WGSL specifications (`https://www.w3.org/TR/webgpu/`, `https://www.w3.org/TR/WGSL/`), W3C Secure Contexts (`https://www.w3.org/TR/secure-contexts/`), and EPLAN's public 2026 help page “Defining the Project Structure” (`https://www.eplan.help/en-us/Infoportal/Content/Plattform/2026/Content/htm/projectstructure_h_prjstrukturdefinieren.htm`). The implementation and sample data are original; these references do not imply compatibility or certification.
