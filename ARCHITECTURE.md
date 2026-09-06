# VoltWeave architecture

## 1. Source of truth

The project is a normalized, JSON-serializable semantic document. Geometry is a separate representation of electrical functions. There is no hidden electrical state in a canvas, SVG element, screen coordinate or routing path.

```text
Project
  pages[pageUUID]
  devices[deviceUUID]              physical asset / purchasing identity
  functions[functionUUID]          electrical function belonging to a device
  pins[pinUUID]                   persistent electrical connection point
  placements[placementUUID]       page + function + x/y/rotation
  connections[connectionUUID]     pinUUID -> pinUUID, with separate route metadata
  strips[stripUUID]
  cables[cableUUID]
  symbols[symbolDefinitionID]
  macros[macroUUID]
```

A physical contactor can own a coil function, a three-pole contact function and several auxiliary-contact functions. They share a device ID, not their electrical pins. A linked graphical representation shares the *same function*, hence exactly the same pin IDs. A duplicate or circuit-macro insertion creates fresh identities instead.

Tags, part numbers, descriptions, terminal designations, locations and page numbers are mutable attributes. None is a primary key. Cross-references group by physical UUID and BOM quantities count physical records, so another drawing of a device does not purchase another device.

### Connection representation

```js
{
  id: 'connection-uuid',
  from: 'source-pin-uuid',
  to: 'target-pin-uuid',
  number: 'W0001',
  locked: false,
  color: '#245c77',
  crossSection: '1.5',
  cableId: null,
  core: '',
  route: {
    pageId: 'page-uuid',
    fromPlacementId: 'source-placement-uuid',
    toPlacementId: 'target-placement-uuid',
    waypoints: []
  }
}
```

The route's placement references choose the graphical representation to draw. They do not define the connection's electrical endpoints. Moving or rotating a placement invalidates routing geometry, not connectivity.

## 2. Connectivity and electrical function boundaries

`buildGraph()` uses an iterative path-compressed disjoint-set structure. Its electrical unions are limited to:

- Explicit connection records between pin UUIDs.
- Explicit internal hard bonds in a symbol definition, such as both sides of a feed-through terminal.
- Matching potential/interruption names within their declared project or location scope.

Coils, loads, breakers and contacts are not collapsed into hard-wired nets. This is net extraction, not resistance solving or switch-state simulation. In particular, a drawn normally closed contact is not treated as a permanent wire bond.

Two lines crossing, a wire passing through an unrelated pin, or two symbols overlapping creates no electrical union. Tapping an existing wire is a specific editing action: split the connection into two edges through a new persistent junction pin, then create the branch edge, all in one transaction. Canceling a proposed tap leaves the original wire untouched.

Component identifiers are deterministic for the current pin set, derived from pin identities. They are not separately persisted net UUIDs and may change when the component's membership changes. Wire numbering preserves existing numbers where possible, retains locked numbers, and allocates fresh numbers after splits rather than treating a derived component ID as a conductor label.

Cross-page drawing is represented by scoped potentials or linked function views. A single drawn connection must have two representations on the same sheet; the renderer does not draw one path through separate pages.

## 3. Atomic editing and undo

All UI mutations enter `ProjectStore.edit(label, mutation)`:

```text
clone committed project
  -> apply proposed mutation to draft
  -> validate references, data bounds and invariants
  -> compare entity collections / project metadata
  -> produce sparse before/after patches
  -> atomically publish draft
  -> update cross-reference caches
  -> notify UI, schedule analysis and save
```

Validation failure commits nothing and creates no undo entry. Undo applies inverse patches and redo applies the original patches. A new edit invalidates the redo branch. Undo history is bounded by both entry count (200) and an estimated 32 MiB patch budget. A runtime revision increases monotonically, including undo/redo; the user's drawing revision string is a separate project attribute.

Pointer moves update transient placement overrides, not the semantic document. Pointer-up produces one snapped movement transaction regardless of the number of pointermove events. Pointer cancellation discards the preview. Routes are rebuilt against the transient positions for visual feedback, and against committed positions afterward.

**Complexity boundary:** staging and diffing still traverse/clone the project. Sparse history is not equivalent to a persistent-data-structure implementation. This is a deliberate correctness-first transaction boundary; structural sharing or field-level command records can later replace staging without changing the identity model.

## 4. Cross-reference invalidation and worker analysis

`CrossReferenceIndex` maintains device occurrence caches and an inverted function-to-placement index. Device/function/placement/page patches identify affected device caches. An unrelated device's cached occurrence list remains the same object. Cache invalidation is scoped, although rebuilding supporting indexes may still scan project functions; this is not claimed to be constant-time incremental maintenance.

Electrical checks and report rows run in `analysis-worker.js`. The UI allows one in-flight request plus one coalesced pending request for the latest revision. Results are accepted only when their revision matches the current committed document. An older result cannot overwrite newer engineering state. The worker performs a complete graph/report rebuild rather than a fully dynamic connectivity algorithm supporting local deletions.

Direct report export can synchronously obtain the latest analysis when the worker is behind. Worker startup failure switches to the same pure analysis implementation on the UI thread and displays a notice. Thus results do not depend on a second incompatible analysis engine.

Cross-reference annotations update from the store immediately; engineering tables update from current analysis. No rendering geometry is sent back as electrical truth.

## 5. Routing, hit testing and editing

The orthogonal router first tries inexpensive Manhattan candidates, then a bounded A* search with bend costs and rectangular symbol obstacles. It honors pin escape directions, incorporates manual waypoint anchors and simplifies redundant collinear points. The A* work budget prevents an unconstrained route search from monopolizing the UI.

When no route is found within the budget, an orthogonal fallback remains editable but is flagged for review and rendered in a warning color. A fallback is not certified collision-free. Routing warnings are distinct from semantic ERC because they concern drawing layout, not net equivalence.

A uniform-cell spatial index stores symbol boxes, pin points and wire segments. Hit testing queries local cells, prioritizes nearby pins, then symbols and conductor segments. The index is a rendering/editing acceleration structure only. It never creates electrical connectivity.

## 6. Rendering path

`buildScene()` creates a shared display list of line segments, texts and paper fills. Canvas rendering, WebGPU rendering and SVG export consume the same schematic primitives. Rotated symbol geometry is transformed in world space; readable annotations remain upright.

### WebGPU

Each segment occupies 48 bytes:

```text
byte  0: a        vec2<f32>
byte  8: b        vec2<f32>
byte 16: color    vec4<f32>
byte 32: params   vec4<f32>  (width in x)
stride: 48 bytes
```

A 32-byte uniform holds physical canvas resolution, pan, zoom, pixel ratio and padding. A vertex shader expands each segment to a six-vertex capsule-aligned quad; a fragment shader computes anti-aliased coverage with premultiplied-alpha blending. A single instanced draw submits the current sheet's line geometry.

The storage buffer grows in power-of-two capacities and is reused. Geometry is uploaded when the display list changes; pan and zoom primarily update view uniforms. Rendering is requestAnimationFrame-coalesced and demand-driven, not an idle animation loop. Pixel ratio is capped and constrained by the device's maximum texture dimension.

Paper/grid, typography and transient editing overlays are separate Canvas 2D layers. This is a hybrid renderer, not a claim that every UI pixel or glyph is drawn by WebGPU. The fallback has a separate canvas, avoiding attempts to acquire incompatible context types from a previously configured canvas.

Shader/pipeline initialization errors and device loss activate Canvas fallback. The visible backend indicator reports the selected path. Displayed CPU milliseconds measure the host draw/submission work; GPU timing queries, frame-rate guarantees and large-project benchmarks are not implemented.

**Verification boundary:** the WebGPU source and WGSL pipeline are implemented but were not executed by the provided browser test environment, which did not expose `navigator.gpu` on its test origin. The tested rendering/editing path is Canvas 2D.

## 7. Storage and interchange

The active workspace uses a versioned envelope around project JSON:

```js
{
  format: 'voltweave/workspace',
  savedAt: 1788717600000,
  project: '{"format":"voltweave/project", ...}'
}
```

Save-intent timestamps are captured before enqueuing a save. Writes arbitrate by timestamp, including the read/check/write inside the IndexedDB transaction. A later unload checkpoint cannot be overwritten by an older queued save. Restore validates both candidates and chooses the latest valid record. Legacy raw-project records are accepted. Autosave is serialized and debounced; explicit project JSON export remains independent of local-storage availability.

This protects save ordering within the application; it is not multi-user or multi-tab conflict-free replication. Concurrent tabs can still overwrite different semantic edits. Browser quota, private browsing, blocked storage and user-cleared data remain external failure conditions. The UI exposes storage failure rather than announcing a successful save.

Project JSON imports are version-checked, capped at 30 MiB, validated for references and bounded geometry, and reject prototype-polluting keys. Symbol libraries are declarative and reject unknown drawing primitive types. Documents escape user-controlled HTML/SVG text. CSV output quotes fields, includes a UTF-8 BOM and neutralizes formula-leading text. Portable projects contain no executable user code.

## 8. Reports and engineering limits

Reports are projections from physical-device records, connections and current analysis. The BOM counts physical devices once and includes defined cable quantities; it does not infer real manufacturer's compatibility or procurement availability. Terminal and cable tables list modeled connectivity and allocation, not automatically verified field wiring. PLC tables model addresses/labels, not controller programs.

Printable HTML contains all SVG sheets and six report sections. Printing uses the browser's print engine and landscape paper rules; there is no scale-certified plotting or dedicated PDF kernel. SVG is a drawing export, not the editable semantic project interchange format.

ERC is advisory and incomplete as an electrical compliance analysis. In particular, safe emergency-stop architecture, protection coordination, conductor ampacity, fault-current ratings, isolation, electromagnetic compatibility and installation compliance are not proven by this tool. Device ratings are engineering metadata, not simulated behavior. Use independent engineering review before any real installation.
