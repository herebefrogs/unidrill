# unidrill — Game Design

JS13KGames 2026 entry. Built on top of [gamejam-boilerplate](README.md).

Status: design in progress, no game-specific code written yet. This doc is living —
update it as implementation decisions get made, don't let it drift from the code.

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

Arrow keys / WASD, or mouse/pointer on mobile, to rotate the drill/unicorn
left/right.

## Graphics

2D side view, pixel art. Dust cycles through rainbow hues via palette
rotation. Heavy hit-stop and camera shake for impact.

Stretch goal: anaglyph red/cyan mode — requires background/entity depth-plane
separation for parallax.

## Music

Chiptune, via ZzFXM (already vendored in `src/js/sound.js`).

## Replayability

Underground is generated from an RNG seed (boilerplate's `utils.js` already
round-trips a seed through the URL via `setRandSeed`/`getRandSeed`). Seed is
shareable so friends can race the same map / beat a score.

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
   ░░░░░░░░██░░░●dust░░░░░░░░░░░░░░░░░░░░░░   ● = dust patch (from sample())
   ░░░░░░░░░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ░ = solid soil (from sample())
   ░░░░░░░░░░░██◄unicorn░░░░░░░░░░░░░░░░░░░
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

```
 (x,y) ──► sample(seed,x,y) ──► material + dust?   (pure function, nothing stored)
                                    │
                                    ▼
 unicorn position ──► drill stamp ──► delta Map (x,y → carved)   (only mutable state)
                                    │
                                    ▼
                        render/collision = sample(x,y), unless delta has it carved
```

**Tunnel shape: fixed-width.** The drill carves a fixed-radius circle/capsule
along its path — no variable-width state to track. (Decided over
variable-width-by-momentum for lower implementation cost.)

### `sample(seed, x, y)` — the terrain generator

Pure function, evaluated on demand, nothing precomputed or stored for the
"base" terrain — that's what makes depth unbounded for free. Named `sample`
(not `base`) because it's a noise-style lookup: given coordinates, evaluate
what's there.

To avoid a white-noise/scattered look, both soil type and dust use **cheap 2D
value noise** instead of independent per-cell random rolls: hash the corners
of a coarse grid, bilinear-interpolate between them (reusing `lerp` from
`utils.js`), threshold the smooth result into bands.

```
 coarse grid corners (hashed once each, cached)
   h(0,0)──────h(1,0)
     │            │
     │   sample(x,y) = lerp2D(h00,h10,h01,h11, fracX,fracY)
     │            │
   h(0,1)──────h(1,1)

 smooth field value ──► threshold bands ──► material / dust output
   0.0-0.4                 sand
   0.4-0.7                 clay
   0.7-1.0                 rock
```

Two independent noise fields, same technique:

- **Soil field** → thresholds into sand / clay / rock (rock TBD). Reads as
  soft-edged strata/pockets, like a real geological cross-section, instead of
  a jarring checkerboard.
- **Richness field** → thresholds into none / sparse / dense dust. Dense
  patches sit at the field's peaks (naturally rare, naturally clustered — a
  peak's neighborhood is also high, giving soft falloff edges); sparse
  patches occupy the surrounding mid-range.

```
 side view, both fields sampled per cell:

 ░░░▓▓▓░░░●●●░░░▓▓░░░░●●●●●░░░▓▓▓▓▓
 ░░▓▓▓▓░░●●●●●░░▓▓▓░●●●●●●●●░▓▓▓▓▓▓     ░ sand  ▓ clay  (rock later)
 ░▓▓▓▓▓░░●●●●●●░▓▓▓░●●●●●●●●●░▓▓▓▓▓     ● dust (sparse=● light / dense=●● below)
 ▓▓▓▓▓░░░●●●●●░░░▓░░●●●●●●●●░░░▓▓▓▓
```

Depth-bias idea (not yet decided): add a slow function of depth to both
fields before thresholding, so rock/dense-dust probability rises the deeper
you go — ties noise directly to the risk/reward curve instead of being
depth-agnostic decoration.

### Storing the mutable state

The generated terrain is never stored — it's recomputed from `sample()` on
demand. What **must** persist is only the player's mutations (carved cells,
collected dust), because the player backtracks through their own tunnel to
resurface and it has to stay consistent.

- **Delta overlay**: sparse `Map`, packed-integer key (e.g. `y * WORLD_WIDTH
  + x`), records only cells the drill has removed/collected. Naturally
  bounded by how far the unicorn can travel before running out of momentum —
  no eviction logic needed for a jam-length session.
- **Active/render window**: small buffer around the camera, rebuilt from
  `sample(x,y)` overridden by the delta — this is what's actually drawn and
  collided against, distinct from the persistent delta.
- Drilling = stamping the delta with the carve shape each tick, and checking
  `sample(x,y)` at newly-carved cells to collect any dust there.

## Open questions

- Camera tracking: as the unicorn digs, the camera should stay centered on
  it, but a naive hard-lock reads as jittery/robotic. Worth a pass on
  smoothing/lookahead strategies once movement exists — see
  https://gamedesignskills.com/game-design/camera-design-2d-side-scroller-games/
  (warning: heavy with animated gifs) for a survey of options.
- Momentum at start: fixed amount vs. aim-and-throw (Angry Birds style)?
- Rock deflection behavior (once rock is added) — bounce angle, momentum
  cost, or both?
- Depth-bias formula for the noise fields (see above) — not yet decided.
- Endless generation is solved for *sequential* depth access (player only
  ever extends from the surface downward); no random-access-to-arbitrary-depth
  requirement has come up yet (e.g. minimap). Revisit if one does.
