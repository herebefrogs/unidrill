# unidrill — Game Design

JS13KGames 2026 entry. Built on top of [gamejam-boilerplate](README.md).

This doc describes the current design. It's living — when an implementation
decision contradicts it, update the relevant section here directly (no
changelog, no "was X, now Y" notes). `TODO.md` tracks build status; this
doc doesn't.

## Premise

Rainbows don't appear in the sky — they sprout from the ground. Unicorns drill
underground with their horn, hunting for rainbow dust. Bring enough dust back to
the surface and a new rainbow spawns.

## Core loop

Push-your-luck, one decision per second: **drill deeper for more dust, or head
back to the surface with what you've got before you run out of momentum.**

- Unicorn starts at the surface with momentum (fixed amount, or possibly
  imparted by an aim-and-throw a la Angry Birds — **TBD**).
- The underground is **completely solid soil** — no pre-existing caves or
  tunnel network. The player carves their own path by drilling, like *Where's
  My Water* or *Roottown*'s root growth. The pleasure of the game is in
  carving the shape, not navigating existing passages.
- Material type affects momentum: some soil types deplete it faster, others
  deflect the unicorn (rock, once added).
- Rainbow dust comes in sparse patches (small yield) and dense patches
  (bigger yield + temporary momentum boost).
- Carrying more dust drains momentum faster — the deeper/greedier you go,
  the more precarious the trip back.

## Win / lose

- **Win:** resurface. Dust carried scales rainbow size and score.
- **Lose:** momentum hits zero underground ("bingo fuel") — no rainbow.

## Tracked state

Current momentum, dust collected, depth achieved, time elapsed.

## Controls

The drill thrusts forward along its heading at a constant speed — no
throttle. Steering only:

- Keyboard: Left / Right arrows, or A / D (plus Q for AZERTY), bank the
  heading at a fixed turn rate.
- Pointer (mobile): the drill heads in the direction the finger is
  currently dragging (drag direction sets the heading outright; drag
  magnitude is ignored). The direction-tracking logic in
  `src/js/inputs/pointer.js` works around a touch quirk and is deliberately
  unusual — get the full context from Jerome before changing it. Direction
  changes currently feel abrupt; a smoothing pass is planned.

## Graphics

2D side view, pixel art. Dust cycles through rainbow hues via palette
rotation. Heavy hit-stop and camera shake for impact.

Stretch goal: anaglyph red/cyan mode — requires background/entity depth-plane
separation for parallax.

## Music

Chiptune, via ZzFXM (already vendored in `src/js/sound.js`).

## Replayability

The underground has its own dedicated seeded generator, separate from every
other use of randomness in the game — it must not draw from the shared
`utils.js` PRNG; anything else needing randomness gets its own generator.
It's seeded from a string: default `JS13K2026`, with `RAINBOWS` and
`UNICORNS` shipped as alternates, plus title-screen options to share the
current seed (`share.js`) and roll a fresh one. Per-seed high scores are
kept under the `2026.unidrill` storage key (`storage.js`) so a player can
reload an old seed to beat their score.

---

## Procedural generation

### Terrain model

No connectivity problem to solve: the ground starts **fully solid**, and the
player's own drilling *is* the path. Reachability is guaranteed by
construction — you can only ever be where you've already carved.

```
                    surface
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   ░░░░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ████ = carved (delta overlay)
   ░░░░░░░░██░░░●dust░░░░░░░░░░░░░░░░░░░░░░   ● = dust patch (from sampleMaterial())
   ░░░░░░░░░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ░ = solid soil (from sampleMaterial())
   ░░░░░░░░░░░██◄unicorn░░░░░░░░░░░░░░░░░░░
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

```
 (x,y) ──► sampleMaterial(x,y) ──► SAND | CLAY   (pure fn, deterministic hash, nothing stored)
                                    │
                                    ▼
 unicorn position ──► digShaft() stamps a fixed-radius circle of cells each tick:
                        • add each cell to the DUG set  (persistent delta, only mutable state)
                        • punch it out of the MAP buffer immediately
                                    │
                                    ▼
              render / collision = DUG.has(cell) ? carved : sampleMaterial(x,y)
```

**Tunnel shape: fixed-width.** The drill carves a fixed-radius circle/capsule
along its path — no variable-width state to track. (Decided over
variable-width-by-momentum for lower implementation cost.)

### `sampleMaterial(x, y)` — the terrain generator

Pure function, evaluated on demand, nothing precomputed or stored for the
"base" terrain — that's what makes depth unbounded for free. Everything keys
off `hash2D`, a deterministic hash of an integer coordinate pair returning a
value in `[0, 1)`; the run's seed is mixed into that hash (see
Replayability). Two passes:

**Macro pattern pass.** The world is cut into large square sections
(`SECTION_SIZE`, currently 480px). Each section deterministically rolls one
of four density categories from fixed weights — CLEAR / SPARSE / DENSE /
FILLED. This is a Spelunky-style room-category pass applied to a continuous
field: direct control over how obstacle-heavy an area is, instead of leaving
density fully emergent from the blob field. FILLED sections are
unconditionally solid; CLEAR sections spawn no blobs.

**Rock blob pass.** A finer grid (`ROCK_CELL`, currently 170px, sized to be
>= the largest possible blob so a blob can never reach past its immediate
neighbour) scatters at most one blob per cell — a jittered centre + radius.
Its size and spawn chance come from the macro pattern of *that cell's own*
section, **not** the section asking about a given pixel — which is what lets
a blob spill naturally across a section border instead of cutting off at the
edge. SPARSE reads as "many small blobs", DENSE as "few big ones". Each
blob's radius wobbles with angle (two sine harmonics) so its silhouette is a
lumpy rock outline, not a circular arc; overlapping blobs union into bigger
irregular clusters.

```
 world sections (480px)              blob cells (170px)
 ┌────────┬────────┬────────┐        · · ·  · · ·  · ● ·  · · ·
 │ SPARSE │ DENSE  │ CLEAR  │        · ∘ ·  ·(●) · ●●●●● · · ·      ∘  small blob (SPARSE cell)
 │  ∘  ∘  │        │        │        · · ·  ·●●●● ·●●●● · · · ·     ●  big blob (DENSE cell)
 ├────────┼────────┼────────┤        ▓▓▓▓▓▓ ·●●● ·  · ● ·  · · ·   (●) blob whose params came
 │ FILLED │ SPARSE │ DENSE  │        ▓▓▓▓▓▓ · · ·  · ∘ ·  ·●●● ·       from its own DENSE cell,
 │▓▓▓▓▓▓▓▓│ ∘ ∘  ∘ │  ●●●   │        ▓▓▓▓▓▓ · ∘ ·  ∘ · ∘  ●●●●●        spilling left into SPARSE
 └────────┴────────┴────────┘        ▓▓▓▓▓▓ · · ·  · ∘ ·  ·●●● ·   ▓  FILLED section: all solid
```

```
 sampleMaterial(x, y):
   section is FILLED?    → CLAY
   (x,y) inside a blob?  → CLAY
   otherwise             → SAND
```

Only two materials so far — **SAND** (traversable / background) and **CLAY**
(the dense blob/FILLED material). A distinct rock material with deflection
behaviour is still a future addition (see Open questions); the blob pass is
named "rock" in the code but currently emits `CLAY`.

Dust (a separate richness field — none / sparse / dense patches, dense ones
rarer and clustered) is not built yet. Whatever generates it gets its own
pass; it must not reuse the blob field.

Depth-bias idea (not yet decided): bias the pattern weights / blob chance by
a slow function of depth, so dense/solid terrain (and later dense dust)
grows more likely the deeper you go — tying generation to the risk/reward
curve instead of being depth-agnostic decoration.

### Storing the mutable state

The generated terrain is never stored — it's recomputed from
`sampleMaterial()` on demand. What **must** persist is only the player's
mutations (carved cells, and collected dust once that exists), because the
player backtracks through their own tunnel to resurface and it has to stay
consistent.

- **Delta overlay** (`DUG`): a `Set` of carved cells, string key
  `x + '_' + undergroundY`, both `CELL_SIZE`-aligned. Coordinates are in
  **underground space** — measured from `SURFACE_Y` and offset by
  `mapOffset` (the running total the paging buffer has scrolled), not world
  space — so a cell keeps its identity after the buffer pages away and back.
  Naturally bounded by how far the unicorn travels before momentum runs out;
  no eviction logic for a jam-length session.
- **MAP buffer**: an offscreen canvas 2× the camera size. It is *not* rebuilt
  from `sampleMaterial()` each frame — it's paged: `scrollMap()` self-blits
  the existing pixels by the scroll delta, then `paintRow()` repaints only
  the newly-exposed `CELL_SIZE` strip (sky above `SURFACE_Y`, else
  `DUG.has(cell)` ? tunnel : material colour). The 2× size is the lookahead
  margin that lets paging happen in occasional jumps, not every frame.
- Drilling: `digShaft()` stamps a fixed-radius circle of cells each tick;
  `dig()` adds each new cell to `DUG` **and** immediately punches a hole in
  the MAP buffer, so a cell stays carved when you scroll away and back.
  (Collecting dust at newly-carved cells is TODO.)

## Open questions

- Camera tracking: target model is **position-locking + lerp-smoothing** —
  the camera aims to hold the hero at the exact screen centre, but lets the
  hero drift off-centre temporarily (e.g. a dense-dust velocity boost) and
  each frame lerps the centre-to-hero gap back toward zero. Currently it
  hard-locks to the hero's centre (`followCamera()`), which reads as
  jittery/robotic. Also still vertical-only — camera x is pinned to 0. See
  https://gamedesignskills.com/game-design/camera-design-2d-side-scroller-games/
  (warning: heavy with animated gifs) for a survey of options.
- Momentum at start: fixed amount vs. aim-and-throw (Angry Birds style)?
- Rock deflection behavior (once rock is added) — bounce angle, momentum
  cost, or both?
- Depth-bias formula for the generator (see above) — not yet decided.
- Endless generation is solved for *sequential* depth access (player only
  ever extends from the surface downward); no random-access-to-arbitrary-depth
  requirement has come up yet (e.g. minimap). Revisit if one does.
