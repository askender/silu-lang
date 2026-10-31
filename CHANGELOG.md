# Changelog

All notable changes, organized by version tag.

## v1.x — Self-Hosting Campaign (2026-10-16 → present)

### v1.16.2
Memory-leak fix and full self-hosting CI

- fixed a leak that made compiling very large single files need >15GB
  of memory (a leaked whole-source copy per field-slice assignment);
  the self-hosted front end now parses its own ~12k-line converter in
  about 1GB
- all four platform binaries rebuilt; the complete self-hosting gates
  (byte-identity fixed points, frontend parity corpus, driver parity)
  run in CI again

### v1.16.1
First public native toolchain release

- native `siluc`/`siluc1` archives for macOS (ARM64/x86_64) and Linux (ARM64/x86_64), with checksums and runnable examples
- portable target/linker selection, cold runtime-cache creation, and installed-wheel bootstrap outside the package directory
- bilingual language guide, semantics/prover limits, examples, and honest release positioning
- the native archive does not include the Python interpreter or `silu prove`

### v1.16.0
interprocedural contracts: require() - modular proof composition

- require(cond): a no-op in every runtime plane, proof-time only;
  the typed backend compiles it to constant true
- a function's proof stands ALONE under its declared domain - no
  caller narrowing, removing a caller never invalidates anything;
  call sites are separately verified against the contract
  (fresh-name instantiation, caller path conditions)
- spectral with require goes green end to end: a() proves safe
  under i>=0,j>=0; the loop-bound call sites satisfy the contract;
  safe_div(10, x-x) is a CONTRACT VIOLATION with witness
- and/or in the Z3 expression converter; empty domains are
  vacuously safe (pinned); prove suite 7 -> 24

### v1.15.2
distribution + prove v2 + transform equivalence: the roadmap closes

- silu bootstrap: one command builds the zero-Python toolchain from
  the package's own sources (mtime-incremental); prebuilt binaries
  ship on GitHub Releases (4 platforms), NOT pip'd; tools/ +
  selfhost/ join the wheel - clean-venv end-to-end verified
- prove v2 path sensitivity: obligations carry direction-applied
  path conditions + live env bindings; gcd's guarded a%b went
  false-positive -> PROVED SAFE; over-suppression checked both ways
- transform-equivalence proofs (roadmap Phase 3): borrowed-str
  callee contract + rawlist writeback guard discharged over Z3,
  mutation-verified - the three-phase symbolic roadmap is fully
  delivered
- legacy bare-word CLI layer now knows all subcommands (bootstrap
  was being eaten as a filename)

### v1.15.1
prove v1.1: real-code ready + release smoke

- assignment visibility: Silu assign/ann_assign fell through the
  executor's C-style AssignmentHandler - checked operations inside
  assignments were invisible; now evaluated and recorded everywhere
- loop-condition crash fixed: tuple-tree conditions converted back
  to infix before ast.parse; unparseable conditions skipped
  (conservative direction)
- two new abort families: subscript bounds (statically-known
  lengths, witness i=-1 / proved-safe i%3) and literal KeyError
- parse_number (the real jsonparse scanner) analyzes cleanly and
  proves ok - roadmap Phase 2 exit criterion material; prove suite
  7 -> 16
- release: clean-venv pip smoke (interpret/ir/prove/build), version
  drift fixed (1.15.0 everywhere), README gains the prove row

### v1.15.0
performance parity + panic-free proofs: copy-into endgame, silu prove

- P1 copy-semantics endgame: rawlist_str_copy_into (dst.cap >=
  src.byte_len verdict, geometric grow, null-dst allocate); wordcount
  24.8 -> 8.8ms = 1.74x vs Rust; suite geomean 1.0x vs Rust.
  Negative-index underflow bug in rawlist_str_get fixed en route
- P2 silu prove (Phase 2 v1): Z3 panic-free proofs for division/
  modulo; reachable aborts carry witness parameter values;
  a/(b*b+1) proved safe by algebraic reasoning; sound-in-safety-
  direction with the guard limitation pinned by test
- P3: exec plane json_* builtins (last plane gap closed); CI gates
  weekly; runtime slimming closed by LTO+dead_strip evidence

### v1.14.0
S4: sum-type ownership settled - reference model, explicit frees, Z3 pairing proofs

- ownership audit (RFC 8b): construction = owned, y = x = shared
  reference, container reads = borrowed; per-slot compiler drops
  formally rejected as unsound; json_free ships as move discipline
- static census pins every tagged_free to json_free or the
  recursive trio; probes cover pool-sentinel sharing, deep-tree
  teardown, borrowed-read survival
- Z3 pairing proofs: list walk frees exactly the pushed slots,
  dict walk exactly the live entries (tombstones never fire),
  dispatch routes each tag to exactly its own teardown -
  mutation-verified (the S1 dispatch-bug shape goes red)
- json_* argument paths and _build_raw_list route through the
  single-evaluation helper (str-constant elements were boxing);
  m4/ir2c plane skips the Json twin - closing the S3 round's
  'phantom' full-suite failure (it was this, not a race)
- full suite 1268 passed, zero failures

### v1.13.1
S3: jsonparse over the Json sum type, four planes agree

- the id/name WIP bug solved: tagged_dict_free read field 4 (the
  open-addressing table - small entry indices) as the value array;
  vals is field 6; freeing table entries as pointers segfaults on
  two-live-key dicts
- benchmarks/jsonparse_json.si: full parser on tagged blocks, all
  four planes (incl. the Rust twin) byte-agree on the 87KB doc
- measured honestly: Json twin 10.1ms vs class twin 8.9ms - net
  1.2ms SLOWER; per-read tag dispatch + checked unwrap outweigh
  the construction saving (RFC 7c); inline tag checks are the
  optional follow-up

### v1.13.0
S2: the built-in Json sum type lands on every plane

- `x: Json` / `list[Json]` / `dict[str, Json]` annotations: tagged
  blocks ride the raw container slots as pointer bits (no new
  container runtime); literal build, subscript read/write, append,
  for-iteration all channel through
- json_tag/int/float/bool/str/free builtins with checked unwrappers
  (loud TypeError on wrong member, the abort policy), fully
  open-coded emission (.si Rust nested-item semantics)
- interpreter + CPython planes agree byte-for-byte with the typed
  binary; S1 benefit measurement had revised the jsonparse
  projection to ~0.3-0.4ms (construction only 1.20x mixed) - this
  lands for expressive completeness
- two cross-plane bugs fixed en route: value re-evaluation in the
  coercion helper (read_stdin called twice -> silent empty output)
  and a nested-function capture violation

### v1.12.0
sum-type runtime, stage S1: the tagged emitters land (lazy, byte-identical)

- _emit_tagged_core/_emit_tagged_frees: 8 functions over the
  16-byte {tag, payload} block; three-tag dispatch frees; recursive
  list/dict teardowns modeled on rawdict_str_clear
- storage reuses rawlist/rawdict slots element-wise (8-byte
  patterns) - the RFC's rawlist_tagged family collapses to two
  free-walks
- lazy _ensure_tagged_runtime with a base-__init__ sentinel
  (getattr is not dual-valid); corpus 16/16 unchanged
- probe tests build/read/tear-down int+str+list trees and a dict
  tree; the probe caught a dispatch-chain bug (missing dict check
  segfaulted scalar frees) before any gate could

### v1.11.5
view materialization pooled: s[i] at parity with hand-written ord()

- v1.11.4 correction: the char pool sat on rawstr_char_at, a dead
  emitter (zero call sites; the dead-code scan's .si-text exclusion
  had masked it) - its 0.8ms was noise. Real hot path: the
  view->RAWSTR materialization (2 mallocs + memcpy + SIMD cp count
  per char)
- rawstr_char1(data, seq): one-byte code points from the shared
  pool, longer ones copy, one call at the expression site;
  rawstr_char_at deleted; phi dominance bug caught by llvm verify
  and fixed
- inline strategy measured and rejected: clang -O2 already inlines
  the small runtime fns; alwaysinline on char1 is negative
- jsonparse 9.8 -> 8.0-8.5ms (0.6x); scan probe at parity with the
  ord() idiom (~5ns/char). Residual gap == construction cost:
  sum-type RFC promoted to the closing move (share 12% -> ~24%)

### v1.11.4
single-code-point cache: s[i] stops mallocing (CPython latin-1 model)

- 256-entry lazy pool + cap=-1 immortal sentinel (rawstr_free
  skips), rebinding-safe; multi-byte code points keep the copy path
- llvmlite_text: aggregate None constant now spells
  zeroinitializer (was invalid IR); si twin synced
- jsonparse attribution revised by measurement: construction is
  only 12% of runtime, the per-char 1-byte str allocation was the
  real 5.4ms - pool removes it (9.8 -> 9.0ms official); residual
  is three non-inlined runtime calls per char, recorded as the
  next layer
- S0 probe (sum-type RFC): tagged construction 1.96x vs pyobj
  (tools/probes/), meets the go bar on construction; RFC outcome
  section revised with the 12% finding

### v1.11.3
subscript type inference + sum-type RFC + symbolic phase 1

- type inference: element/value kinds for subscript reads of
  annotated containers (list[int][i] is an int, xs[1:] is a
  container, s[i] a 1-byte str); int/dict paths lose the pyobj box;
  honest negative: the str-element path got slower (0.66x -> 0.61x
  on wordcount) because it exposed rawlist_str_get's copy semantics
  - two heap ops vs one; root fix is borrowed reads / buffer reuse,
  folded into the RFC
- rfc: docs/rfc_sum_types.md - tagged unions for heterogeneous
  containers (16-byte single-block values, rawlist/rawdict tagged
  element families, v1.7.1 borrow discipline generalized), staged
  S0-S4 with a >=2x go/no-go probe
- symbolic phase 1 (roadmap): invariant proofs for the raw families
  - rawstr_append capacity (incl. cap0==0 bootstrap), rawdict slot
  discipline (in-table first probe at every width, 3:2 load trigger
  with doubling, sentinel-safe encoding), utf8 cp bounds; mutation-
  checked

### v1.11.2
quality pass: dead code, docs archive, symbolic roadmap, subprocess coverage, _convert_call split

- dead code: 24 verified-unreferenced functions removed (AST-precise
  scan; visit_*/_execute_* protocol families and llvmlite_text's
  .si-plane references correctly exempted)
- docs: 8 superseded snapshots -> docs/history/; symbolic execution
  kept by decision with docs/symbolic_roadmap.md (Phase 1 raw-family
  invariant proofs, Phase 2 'silu verify', Phase 3 transform
  equivalence)
- coverage: subprocess measurement wired through gates (conftest sets
  COVERAGE_PROCESS_START, repo-root sitecustomize.py) -
  static_gate 0->100%, llvmlite_text 0->84%, runtime_cache 0->72%
- modularization: _convert_call 961 -> 61 lines + 4 _call_* methods
  (byte-identical; fall-through branches via None sentinel)

### v1.11.1
quality pass six-pack: emitters split, metadata, CI layers

- modularization: both runtime emitters split byte-identical
  (_create_raw_list_runtime 3480 -> 30 + 12 _emit_* families,
  _create_dict_runtime 1536 -> 8; panic-string globals promoted to
  self attributes, pure-type constants reconstructed per emitter)
- metadata: pyproject 0.10.0 -> 1.11.0, silu.__version__, silu
  --version, dead mlir dependency dropped
- negative finding: llvmlite_text.py is byte-locked to
  selfhost/llvmlite.si WITHOUT flattening - return annotations enter
  the IR there (func_def slot 6) and the typed backend gives them
  real semantics; the fixed point caught a 3.6KB numbering drift.
  Converter sources are safe (flatten strips annotations). Locked
  copies must stay unannotated.
- negative finding: typed_call <-> typed_codegen clone windows are
  emission idioms, not logic duplication - deliberately not harvested
- interpreter.process_control_flow complexity 52 -> 23 (class/enum
  definition and the for-loop variants extracted)
- repo hygiene: 115 untracked scratch files -> .attic/, build
  artifacts gitignored; working tree clean
- ci: two-layer workflow (fast 1133 tests / gates on dispatch), ruff
  baseline F403/F405 pinned in pyproject - 'ruff check' genuinely
  green

### v1.0.0
COMPLETE SELF-HOSTING: fixed point byte-identical


### v1.1.0
root-cause hardening: loud panics, flatten guards, scoped funcref table, boundary suite


### v1.2.0
modularization step A: runtime-emission methods -> silu/pyobj_runtime.py

- docs: post-self-hosting roadmap - P1 quality depth (scope audit CI, symbolic-execution invariants), P2 modularization plan (four byte-identical steps), P3 language gaps; trap list consolidated
- scope-discipline CI audit: static AST checks, mutation-tested

### v1.3.0
symbolic invariant proofs for the pyobj container runtime


### v1.4.0
runtime .o cache: silu build 0.72s -> 0.32s (2.2x), opt-in via SILU_RUNTIME_CACHE=1

- bench harness: three-toolchain timing (interp / silu build / rustc), converter stage isolated both planes

### v1.5.0
docs: post-self-hosting engineering summary - v1.1.0 through v1.5.0 (hardening, modularization step A, symbolic proofs, 2.2x compile cache, pyobj-free static print); three-plane speed table; pyobj consumption census

- print specialisation: static scalars/strings print without pyobj boxes
- docs: RFC on compiler staticisation - measured 1% raw-param potential today, three-tier value ranking, sum-type path deferred

### v1.5.1
lazy CLI imports + Silu in-body import syntax (v1.5.1)

- bench: four-pipeline compile comparison + rustc cache verdict

### v1.6.0
full-pipeline self-hosting: front-end completion + pipeline fixed point (v1.6.0)

- silu_fe: fold subscript aug-assign into aug_assign with subscript target
- silu_fe: parse 'import x as y' and register the alias (fe_register_alias)

### v1.6.1
siluc: the monolithic self-hosted compiler - one process, source to LLVM IR (v1.6.1)

- benchmarks: C twins for fib/mandelbrot (clang plane for language comparisons)

### v1.6.2
link-time dead_strip: binaries keep only referenced runtime functions


### v1.6.3
static gate: --static turns silent pyobj fallback into a loud error


### v1.7.0
match class patterns with narrowing: the cheap sum-type route (v1.7.0)


### v1.7.1
borrowed str parameters: jsonparse 78.7ms -> 8.3ms (9.5x, rust 1.9x)


### v1.8.0
siluc: a C driver - one command, zero Python, rustc-shaped (v1.8.0)

- benchmarks: fresh four-plane report - silu native 0.9x vs rust (geomean)
- ir interpreter: subscript/attribute aug-assign targets, n-ary and/or
- subset completion: set.discard + dict/set comprehensions on all planes
- typed backend: rawlist call aliasing writeback + instance-word locals
- daemon: measured a wash, removed; negative result recorded
- benchmarks: post-P0..P3 four-plane report

### v1.9.0
C ABI: @export + from c import - Silu calls C, C/Rust call Silu (v1.9.0)


### v1.9.1
quality: ruff-clean (F401/F841), tools/attic split

- docs: C interop + siluc usage in README (en/zh) and docs/interop.md
- docs: speed benchmarks page - run + compile tables, evolution, methodology
- docs: memory management - two disciplines, measured, and why no borrow checker
- docs: Rust vs Silu memory-safety comparison table in memory.md
- modularization step B: typed_expr.py mixin split (byte-identical)

### v1.10.0
quality: ruff tail + return-type annotations on the mixin families

- modularization step C: typed_match.py + typed_call.py (byte-identical)

### v1.11.0
modularization step D: _convert_node_scoped dispatch extraction (byte-identical)

- _convert_node_scoped 1891 -> 762 lines: the five largest branches
  (assign/ann_assign 386, subscript 309, aug_assign 170,
  subscript_assign 170, comprehension 98) extracted to _conv_* methods
  with one-line delegations; dynamic-getattr dispatch rejected (typed
  backend does not lower getattr calls; sequential delegation is fully
  inside the verified .si subset)
- acceptance: 16-program corpus .ll byte-identical across the refactor,
  converter + pipeline fixed points re-established, native parity green

## v0.x — Pre-Self-Hosting Foundation

Early development: interpreter, IR generator, symbolic executor,
typed backend construction, C analysis frontend. 53 tags from initial commit to v0.25.0.
