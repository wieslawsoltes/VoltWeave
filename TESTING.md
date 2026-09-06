# Verification record

## Delivered automated results

**51 Node tests passed, 0 failed.**

- 40 core tests cover semantic connectivity, identity preservation, crossings versus junctions, scoped potentials, terminal bonding, atomic invalid edits, undo/redo, cross-reference cache invalidation, shared-device BOM counting, deletion cleanup, import validation, numbering, ERC, macro remapping, routing, transforms, spatial indexing, custom symbols and export escaping.
- 11 storage-adapter tests cover monotonic save intent, local fallback, storage-denied failure, database-only saving, latest-record restoration, corrupt-copy recovery, unload checkpoint ordering, stale database writes and legacy storage migration. These tests intentionally use explicit fake storage adapters.

Run `npm test`. The exact TAP output is in `test-results/unit-tests.txt`; the tests themselves are in `tests/core.test.mjs` and `tests/persistence.test.mjs`.

**22 Chromium integration checks passed, 0 failed, with no unhandled page errors.**

The test operated on the actual built single-file application. It used real DOM events and pointer gestures for symbol placement, pin-to-pin wiring, explicit wire tapping, drag movement, keyboard undo/redo, form editing and page/reference navigation. It additionally checked terminal/cable creation, PLC duplicate-address diagnostics and undo, project/SVG/HTML/CSV payload generation, reopening exported JSON, command search and a 430-pixel viewport without page overflow.

Some setup/navigation calls use the documented `window.voltweave` developer surface. Export verification captures the real generated Blob payload before OS download initiation; it does **not** test the browser's download shelf or OS permission UI. Project import uses the actual file input.

Run the normal-origin version while the local server is running:

```sh
CHROMIUM=/path/to/chromium BASE_URL=http://localhost:8080 python tests/browser-integration.py
```

The Python test requires Playwright. Node tests and the application have no installed package dependencies. Set `CHROMIUM` to your installed executable; the supplied Linux default is `/usr/bin/chromium`.

## Environment and scope

The available Chromium environment blocked URL navigation under managed browser policy. No policy was changed. Browser integration was therefore run with `page.set_content()` against the bundled HTML in an opaque about:blank origin:

```sh
python tests/browser-integration.py --inline
```

This origin reported `isSecureContext === false` and did not expose `navigator.gpu`. The app correctly reported **Canvas 2D** and continued operating. Both browser storage APIs were denied on that origin; the app visibly reported storage failure rather than showing a false successful save.

Consequently:

| Capability | Verification status |
|---|---|
| Semantic model, numbering, ERC, routing, IDs, history | Automated Node coverage; key operations also exercised in Chromium. |
| Canvas rendering and real editor interaction | Executed in Chromium at desktop and narrow viewport sizes. |
| Single-file build | Executed by the browser integration suite. |
| Project JSON, SVG, CSV and HTML generation | Actual payloads checked, with core escaping tests. |
| IndexedDB / localStorage ordering logic | Tested with explicit adapters; real browser durability needs a normal-origin run. |
| WebGPU adapter, WGSL compilation and GPU draw output | Implemented, but **not runtime-validated in this environment**. |
| Actual hardware frame rate, GPU completion timings | Not benchmarked; status milliseconds are CPU submission work only. |
| Native EPLAN formats / standards certification | Not implemented and not claimed. |
| Electrical safety of a real installation | Not established by these tests or the example. |

`test-results/browser-integration.json` records the exact Chromium version, test origin, backend, assertion names, console warnings and verification limits. Running the browser test script produces `desktop-workspace.png` and `mobile-workspace.png` in `test-results/`. The original screenshots also accompany the downloadable source archive. Generated screenshots are not required to run the application.

## Normal-origin GPU acceptance procedure

For hardware acceptance, use the supplied source on localhost or an HTTPS deployment, then confirm all of the following on the intended target machine:

1. The backend indicator says **WebGPU**, not Canvas 2D. Browser developer tools expose `navigator.gpu` and a working adapter. Initialization failures should report a reason and retain Canvas editing.
2. All three sample sheets show complete symbols, pins, wire numbers, cross-references and title blocks. Compare the same project with `?renderer=canvas` and SVG output. Check thin strokes at several zoom levels and pixel ratios.
3. Insert, wire, branch, rotate and move a circuit; verify its endpoints and net membership, and exercise undo/redo. Pan/zoom repeatedly and resize the window without stale geometry or validation errors.
4. Verify actual normal-origin persistence by editing, reloading, and reopening a saved project. Check denied-storage behavior separately rather than treating denial as persistence success.
5. Inspect GPU validation messages, memory and frame timing on representative project sizes. Establish explicit target-specific performance criteria before making throughput or latency claims.

This procedure is supplied for reproducibility. It was not represented as executed in the delivered environment.
