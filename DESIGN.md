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

- Unicorn launches from the surface with a fixed downward impulse of
  momentum. Momentum only ever decays (drag + entropy, below); the only way
  to top it back up is a dense dust patch.
- The underground is **completely solid soil** — no pre-existing caves or
  tunnel network. The player carves their own path by drilling, like *Where's
  My Water* or *Roottown*'s root growth. The pleasure of the game is in
  carving the shape, not navigating existing passages.
- Material type affects momentum: each material has its own drag
  (deceleration) — sand barely bites, clay eats momentum fast — on top of a
  small material-independent entropy that always applies underground.
  Backtracking up an already-carved tunnel is cheap (tunnel drag + entropy
  only), which is what makes the return trip affordable. Rock, once added,
  deflects the unicorn instead of dragging.
- Rainbow dust comes in sparse patches (small yield, dust cells scattered
  on a dither mask) and dense patches (bigger yield + momentum boost, dust
  cells packed in a jittered blob). Dust is an **orthogonal field** laid
  over the terrain — it sits on sand and clay alike, it is not a third
  material. A dense patch is the only thing that tops momentum back up.
- Collecting dust carries no weight penalty — it's pure upside. The cost of
  a greedy deep run is only the extra terrain drag over the longer route
  there and back, and the risk of not threading enough dense patches to
  keep momentum up. One source of slowdown (terrain), one source of speed
  (dense dust). (A dust-count carry drag was prototyped and rejected — see
  TODO.md "Won't do".)

## Win / lose

Evaluated every frame from `depth` (px below the surface) and current
momentum:

- **Win:** reach the surface (`depth` back to 0) with momentum still to
  spare, after having drilled at least a minimum depth (so an instant
  frame-1 pull-up doesn't count). Dust carried scales rainbow size and
  score.
- **Lose:** momentum hits exactly zero while still underground ("bingo
  fuel", shown to the player as "tapped out!") — no rainbow. Running out at
  or above the surface without a qualifying dive is also a loss.

Dense dust tops momentum back up (`MOMENTUM.denseBoost` px/sec per dense
cell dug — `digShaft()` clears several cells per tick, so entering a patch
gives a jolt), so a deeper dive is winnable when the drilled route threads
through dense patches. The boost is allowed to punch *past* the soft cap
`MOMENTUM.max` (up to a hard `MOMENTUM.overMax`) so the kick still lands
when you enter a patch already at top speed; the excess then bleeds back to
`max` exponentially (`MOMENTUM.overBleed`, ~0.25s), so it reads as a surge
that settles rather than a new plateau. A dive that misses the dense
patches decays on drag + entropy alone, and the only safe line is a shallow
pull-up (a full 180° turn takes ~0.5s at the current turn rate).

## Tracked state

Speed, depth, dust collected. The HUD shows them top-left, left-aligned, at
3x the bitmap font. Speed and depth are converted from the pixel-space sim
values to metric for display only (`PX_PER_M` = 32 px/m → `speed` in m/s,
`depth` in m); the sim itself never leaves pixels. The speed *value* (the
number only, not the `speed:` label — drawn separately, centred on itself)
swells up to 2x while momentum is in the overspeed band, scaled by how far
between `MOMENTUM.max` and `overMax` it sits — so the pop rides a dense
patch's boost up and its bleed back down, no separate timer. The metric scale only
reads as meaningful while the surface is on screen — once deep there's no
reference frame — so it's tuned for that: the drill is ~0.9 m, a dust cell
~0.25 m, a straight sand dive bottoms out around 48 m, a there-and-back win
around 24 m.

## Controls

The drill thrusts forward along its heading at a speed equal to its current
momentum (which starts high and decays — see Core loop) — no throttle.
Steering only. Both input paths work the same way: they pick an **absolute
target heading**, and the drill's heading eases toward it at a fixed turn
rate (`TURN_SPEED`, ~0.25s for a full 180°). Absolute, not relative — Up is
up whether descending or climbing, no inversion between the legs.

- Keyboard: Arrow keys or WASD (plus Q for AZERTY-left), one per cardinal
  direction. Opposing keys cancel; adjacent keys combine to a diagonal.
  No key held → the drill coasts on its current heading.
- Pointer (mobile): the target heading is whichever direction the finger is
  currently dragging (drag direction only; magnitude ignored). The
  direction-tracking logic in `src/js/inputs/pointer.js` works around a
  touch quirk and is deliberately unusual — get the full context from
  Jerome before changing it.

**World edges.** The drill can't cross the map's boundaries; both cases feed
a corrected target heading through the same `TURN_SPEED` ease, never a hard
stop:

- Left/right walls: the into-wall component of the input is dropped. If
  that leaves no input at all, the drill is redirected along the wall —
  full up if it was heading above horizontal, full down otherwise. The
  wall positions are the viewport edges, and the viewport width is derived
  from the window (see Graphics), so the playfield is genuinely narrower on
  a phone than on desktop. Restoring a device-independent playfield needs
  horizontal camera panning (TODO.md) — until then the wider horizontal
  room on desktop is an accepted inconsistency.
- Surface: no hard ceiling. Before the resurface win is armed
  (`heroWentDeep`), breaching more than one drill-height above the surface
  forces a full dive on the vertical input, so the drill porpoises back
  under instead of coasting off into the drag-free sky (holding Up just
  skips it along the surface, bleeding momentum, until it goes deep or taps
  out). Once `heroWentDeep`, reaching the surface wins before this triggers.

`TURN_SPEED` is still being tuned against playtests (see TODO.md); the
model itself — absolute heading vs. the old bank — is also provisional
until playtesters weigh in.

## Graphics

2D side view, pixel art. Camera shake for impact. (Hit-stop on dense-patch
entry was prototyped and dropped — a few frozen frames read as jank, not
juice; the dense-boost surge now carries that beat instead, see Win/lose.)

**Viewport.** One fixed knob, `RENDER_SCALE` (screen px per world px), sets
how big everything renders — dust cell, HUD glyph, drill — and it is the
same on every device, so a phone never gets a shrunken-looking game. The
viewport dimensions in world px are then derived from the live window
(`window / RENDER_SCALE`, clamped, snapped to the cell grid) and every
offscreen buffer is reallocated to match on resize/rotate. The trade: a
smaller window shows fewer world px, so the horizontal playfield shrinks on
mobile (see Controls → World edges). Vertical is the tension axis and gets
whatever height the window gives; the sky band above the surface stays a
fixed height, all extra vertical space goes underground.

**Dust rainbow.** Dust cells are coloured by sampling a **repeating diagonal
rainbow** (↘, top-left → bottom-right) — `DUST_PALETTE`, the 7 rainbow hues
(hand-picked hex, kept a touch muted so no band flares), `DUST_BAND` px per
band. The rainbow is anchored to **underground position** so it reads as
painted onto the terrain, plus a steady time phase (`DUST_SPEED` px/sec, a
divisor of the tile size so a point cycles the full palette in a round
number of seconds). The drift rate is deliberately **independent of descent
speed** — an earlier screen-anchored version coupled the apparent motion to
the drill's vertical velocity, which was distracting.

Implemented with a **dust mask buffer** (`DUST_MASK`): dust-cell *shapes*
only, opaque white on transparent, paged in lockstep with `MAP` by
`scrollMap()` and stamped by `paintRow()` (skipping `DUG` cells so collected
dust stops shimmering). A seamless `DUST_P`-square tile of the rainbow is
baked once (rotate 45°, lay down stripes) and used as a repeating pattern.
Per frame, `renderDust()` lifts the camera slice of the mask into a scratch
canvas, keeps the rainbow only where the mask is opaque (`source-in`,
pattern offset by the camera's underground origin + time phase), and
composites onto the backbuffer between the `MAP` blit and the hero — fixed
cost regardless of how much dust is on screen, no per-cell work in the frame
loop. Dust must stay *out* of `MAP` (rows freeze colour as the buffer pages).

**Collection animation.** When a dust cell is dug, it detaches in two
stages. Stage 0 ("takeoff"): the cell doubles in size in place, pushed
radially outward from the drill so it clears the freshly-dug tunnel instead
of sitting on top of it — tracked in **world/underground space**, same as
the terrain, so it rides the camera scroll (including the buffer's
self-blit paging jumps) exactly like the cell it detached from. Stage 1
("flight"): it eases toward the dust counter in the screen corner under
linear acceleration (ease-in), then vanishes on arrival. This stage
switches to **screen space** — the camera re-centers on the hero every
frame, so a particle still tracked in world space would drift off the
(screen-fixed) counter instead of flying to it. The counter ticks up when
the particle lands, not when the cell is dug — juicier, but it means a run
that ends (bingo fuel or resurfacing) while particles are still mid-flight
must tally their dust instantly rather than let the score depend on how
much of the animation had time to finish; those particles keep flying
visually after the tally, they just don't double-count on arrival. On each
tick the counter *value* (the number only, not the `dust:` label) briefly
swells to 2x and back (`DUST_POP_DURATION`), scaling about its own centre;
re-triggers aren't debounced, so a dense-patch burst reads as a rapid
pulse.

**Layer order** (far → near):

```
  MAP layer         baked terrain + carved tunnel (paged buffer)
  animation layer    live dust cells (DUST_MASK shapes, rainbow-masked per frame) + in-flight collection particles
  HUD layer          speed, depth, dust counter (TEXT buffer)
```

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
off `hash2D`, a *stateless* deterministic hash of an integer coordinate
pair returning a value in `[0, 1)` — output depends only on the coords, so
call order and count never matter (this is why terrain and dust can share
it freely, and why transient randomness must **not** — it belongs in
`utils.js`'s stateful PRNG). The run's seed will be mixed into `hash2D`
(see Replayability) — not wired yet, so every run currently generates the
same map. Two passes:

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

Depth-bias idea (not yet decided): bias the pattern weights / blob chance by
a slow function of depth, so dense/solid terrain (and later dense dust)
grows more likely the deeper you go — tying generation to the risk/reward
curve instead of being depth-agnostic decoration.

### Dust field — `sampleDust(x, y)`

A **separate pass, parallel to `sampleMaterial()`**, not a new material.
Same shape — a pure deterministic function off the same stateless `hash2D`
— but its **own microgrid**, never touching the rock-blob grid or the macro
sections. It answers, per `CELL_SIZE` cell:

```
 sampleDust(x, y):
   cell inside a dense patch?   → DENSE
   cell lit by the dither mask
     of a sparse patch?         → SPARSE
   otherwise                    → NONE
```

`sampleMaterial` and `sampleDust` are independent — a cell can be
`(CLAY, DENSE)`, `(SAND, SPARSE)`, `(CLAY, NONE)`, etc. Dust overlays
whatever substrate is there.

**Patch placement.** Each dust microgrid cell (`DUST_CELL`, its own grid)
deterministically rolls NONE / SPARSE / DENSE from fixed weights (DENSE
rarest). A cell that rolls a patch gets a jittered centre + radius, and its
boundary **wobbles with angle** (two sine harmonics, same trick as the rock
blobs) so the patch reads as an irregular splat, not a circle. SPARSE
patches are wider, DENSE tighter. On overlap, DENSE wins.

**Sparse = dither mask, not a coin flip.** Inside a sparse patch's
footprint, dust cells are lit by a fixed **quarter-grid** mask (every other
cell on every other row, ~25% fill) keyed to the cell's `(x, y)` —
deliberately *not* `hash2D(x,y) < p`, which reads as noise. A regular grid
was picked over staggered/diagonal masks on purpose: the eye locks onto the
lattice and stops reading the coarse cell resolution as graininess.

```
  sparse patch footprint          dense patch footprint
  ▓ · ▓ · ▓ · ▓ ·                  ▓ ▓ ▓ ▓ ▓ ▓ ▓
  · · · · · · · ·                  ▓ ▓ ▓ ▓ ▓ ▓ ▓      ▓ = dust cell
  ▓ · ▓ · ▓ · ▓ ·                  ▓ ▓ ▓ ▓ ▓ ▓ ▓      · = bare substrate
  · · · · · · · ·                  ▓ ▓ ▓ ▓ ▓ ▓ ▓
```

**Dense = solid fill**, like a clay blob — every cell inside the wobbly
patch boundary is a dust cell.

The dust field must **never be baked into `MAP`** (see Graphics — dust
rainbow). `paintRow()` stamps the dust *shape* into the separate `DUST_MASK`
buffer (same paging discipline as `MAP`); colour is applied per frame on the
animation layer. SPARSE and DENSE are indistinguishable on the mask — the
yield difference is carried entirely by the physical fill (dense = solid,
sparse = ~25% dither), not by colour.

### Storing the mutable state

The generated terrain is never stored — it's recomputed from
`sampleMaterial()` on demand. What **must** persist is only the player's
mutations (carved cells), because the player backtracks through their own
tunnel to resurface and it has to stay consistent.

Collected dust needs **no set of its own**: a dust cell is collected iff
it's both dug and in the dust field, i.e. `DUG` ∩ `sampleDust()`. The only
dust state that persists is the running counter (`+1` per collected cell,
plus a momentum top-up when the cell was DENSE) — the `+1` lands when that
cell's particle arrives at the HUD (or instantly on game-over if it's still
mid-flight, see Graphics — Collection animation), not at dig time.

- **Delta overlay** (`DUG`): a `Set` of carved cells, string key
  `x + '_' + undergroundY`, both `CELL_SIZE`-aligned. Coordinates are in
  **underground space** — measured from `SURFACE_Y` and offset by
  `mapOffset` (the running total the paging buffer has scrolled), not world
  space — so a cell keeps its identity after the buffer pages away and back.
  Naturally bounded by how far the unicorn travels before momentum runs out;
  no eviction logic for a jam-length session.
- **MAP buffer**: an offscreen canvas the viewport width and 2× the
  viewport height (width == viewport because there is no horizontal paging
  yet; the 2× height is the vertical paging lookahead). It is *not* rebuilt
  from `sampleMaterial()` each frame — it's paged: `scrollMap()` self-blits
  the existing pixels by the scroll delta, then `paintRow()` repaints only
  the newly-exposed `CELL_SIZE` strip (sky above `SURFACE_Y`, else
  `DUG.has(cell)` ? tunnel : material colour). The 2× height is the
  lookahead margin that lets paging happen in occasional jumps, not every
  frame.
  Dust is **not** in this buffer — its colour comes from a drifting rainbow
  sampled per frame, so a baked colour would freeze per row as it pages.
- **DUST_MASK buffer**: same size and paging as `MAP`, holds only dust-cell
  shapes (opaque white on transparent). `scrollMap()` self-blits it (with
  `'copy'`, so transparent pixels overwrite cleanly) alongside `MAP`;
  `paintRow()` stamps its strip. Recoloured per frame on the animation layer
  — never baked.
- Drilling: `digShaft()` stamps a fixed-radius circle of cells each tick;
  `dig()` adds each new cell to `DUG` **and** immediately punches a hole in
  the MAP buffer (and clears the same cell from `DUST_MASK`), so a cell stays
  carved when you scroll away and back. The once-per-cell `if (!DUG.has(key))`
  guard in `dig()` is where dust collection hooks in: if the new cell is in
  the dust field, top up momentum (if DENSE) and spawn its fly-to-HUD
  particle — the particle itself bumps the counter once it lands.

## Open questions

- Camera tracking: target model is **position-locking + lerp-smoothing** —
  the camera aims to hold the hero at the exact screen centre, but lets the
  hero drift off-centre temporarily (e.g. a dense-dust velocity boost) and
  each frame lerps the centre-to-hero gap back toward zero. Currently it
  hard-locks to the hero's centre (`followCamera()`), which reads as
  jittery/robotic. Also still vertical-only — camera x is pinned to 0. See
  https://gamedesignskills.com/game-design/camera-design-2d-side-scroller-games/
  (warning: heavy with animated gifs) for a survey of options.
- Rock deflection behavior (once rock is added) — bounce angle, momentum
  cost, or both?
- Dense-dust momentum boost: RESOLVED. Shipped **per collected cell**
  (`MOMENTUM.denseBoost`); `digShaft()` clears several cells per tick so
  patch entry is a jolt. The cap question landed on **transient
  overcharge**: the boost clamps to `MOMENTUM.overMax` (> `max` = launch
  momentum), then `moveHero()` bleeds the excess above `max` back down
  exponentially (`MOMENTUM.overBleed`) on top of normal drag — so a dense
  patch is a real overdrive surge that settles in ~0.25s, not a permanent
  higher cap (which made the game trivially easy in playtests) nor a boost
  that vanishes into the cap at top speed (which made it imperceptible).
  Tuned values: `max` 600, `overMax` 800, `overBleed` 12.
- Depth-bias formula for the generator (see above) — not yet decided.
- Endless generation is solved for *sequential* depth access (player only
  ever extends from the surface downward); no random-access-to-arbitrary-depth
  requirement has come up yet (e.g. minimap). Revisit if one does.
- Upgrade picks (roguelite-style): every X dust collected, pause and offer
  2–3 upgrades to choose from. Undesigned — X, the option pool, effects, and
  run-scoped vs. meta-progression all TBD (see TODO.md "Ideas"). Key
  tension: a mid-dive pause vs. the one-decision-per-second core loop.
- Underground creatures (worms / centipedes / beetles / leprechauns) — would
  baddies add to the game, and how would they hook into the momentum loop
  without fighting the "carve your own path" pleasure? Unformed, needs a
  brainstorm (see TODO.md "Ideas").
