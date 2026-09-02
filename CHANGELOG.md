# unidrill — changelog

Completed `TODO.md` items, moved here as they land. This is an **archive** —
a fresh session does **not** need to read it; `DESIGN.md` describes the
current design and `git log` is the authoritative record of what changed and
when. Kept only so the reasoning behind a finished decision is still findable
without digging through commits.

Roughly in build order, oldest first.

## Build sequence

- [x] Add a player at the center of the screen (temporary: a blue square,
      real pixel art later). Temporary controls: up/down to trigger the
      scrolling mechanism.
- [x] Start tracking depth as the player moves up/down. Display it on the
      side of the screen via the existing text routine.
- [x] Add the scrolling buffer (shift-and-patch technique discussed in
      chat: self-blit the MAP buffer by the accumulated depth delta, only
      resample the newly exposed strip).
- [x] Add the digging overlay (track which pixels have been dug). Temporary
      control: always digs a straight vertical shaft — just enough to prove
      backtracking doesn't lose dug-location history.
- [x] Start tracking player velocity and angle: switch to real controls
      (left/right banks the drill left/right, applied to angle).
- [x] Handle the world edges. The map is unbounded left/right/down (see the
      "horizontally unbounded map" item below) — there are no vertical walls.
      The only edge is the surface, and it's soft: before `heroWentDeep`,
      `processInputs()` forces a full dive on the y input when the drill
      breaches >1 drill-height, eased through `TURN_SPEED`, so it porpoises
      back under rather than flying into the sky.
- [x] Horizontal camera panning → superseded by the unbounded map below.
      The intermediate step was a fixed-width `PLAYFIELD_WIDTH` the camera
      panned across with `hero.x` clamped to it; that (and `PLAYFIELD_MIN`,
      the dead `updateCameraWindow()` / `CAMERA_WINDOW_*`) is all gone now.
- [x] Horizontally unbounded map. The X axis got everything the Y axis had:
      `mapOffsetX` (world-x of buffer col 0, X-twin of `mapOffset`), a `dx`
      branch in `scrollMap()` + a `paintCol()` (both `paintRow`/`paintCol`
      now build strips from a shared `paintCell()`), buffers back to 2×
      viewport each way, `cameraX`/`hero.x` unbounded buffer coords that jump
      on an X page (mirror model — `mapOffsetX` never touches the render read
      path, only sampling/key sites). `followCamera()` pages either axis when
      the camera drifts past a buffer edge; no `hero.x` clamp anywhere.
      `DUG` keys, `sampleMaterial`/`sampleDust`, `dustColorAt`, `currentDrag`
      and `renderDust`'s pattern anchor all take world-x = `bufferX +
      mapOffsetX` (terrain.js was already `Math.floor`-clean for negative x).
      `reanchorBuffer()` now cell-snaps its re-seat delta on BOTH axes (the
      Y-only version left `mapOffset` fractional → dug rows repainted solid
      after a page; latent bug, fixed here).
- [x] Momentum / entropy / material drag. Fixed launch impulse
      (`MOMENTUM` config in game.js), decays each frame by entropy + drag
      from the material at the drill's leading edge (`MATERIAL_DRAG` in
      terrain.js; dug tunnel & air use the cheaper values in `MOMENTUM`).
      Win/lose evaluated in `moveHero()` from `depth` + momentum.
- [x] Rainbow dust — distribution. `sampleDust(x, y)` in terrain.js: a
      pass parallel to `sampleMaterial()` with its own microgrid
      (`DUST_CELL`), returning NONE / SPARSE / DENSE per `CELL_SIZE` cell.
      Patch centres jittered + boundary wobbled (two-harmonic, like the
      rock blobs) so the outline is an irregular splat. SPARSE lit by a
      quarter-grid dither mask (~25%), DENSE a solid fill; dense wins on
      overlap. Temp debug tint baked into `paintRow`: DENSE `#e00`, SPARSE
      `#f77`. Occurrence weights left for gameplay balancing once collect +
      boost land. See DESIGN.md "Dust field".
- [x] Rainbow dust — properties. Hook collection into `dig()`'s
      `if (!DUG.has(key))` guard: call `sampleDust(x, undergroundY)` (dig()
      already has both in underground space); if it's not NONE, `+1` the
      dust counter; if DENSE, add a configurable amount to `hero.momentum`.
      No `COLLECTED` set — collected = `DUG` ∩ `sampleDust`. Show the
      counter in the HUD. NOTE: `digShaft()` clears many cells per tick, so
      a per-cell DENSE boost is a big jolt on patch entry — ship per-cell,
      revisit the per-tick-cap (already noted in DESIGN Open questions) if
      it feels bad. Landing this retires the "no dust boosts implemented
      yet" paragraph in DESIGN.md's Win/lose.
- [x] Rainbow dust — visuals. (a) DONE — `DUST_MASK` buffer holds dust-cell
      shapes (paged like MAP, stamped by paintRow, cleared by dig);
      `renderDust()` colours the camera slice per frame by `source-in`-
      masking a repeating diagonal rainbow (`DUST_PALETTE`, 7 hues,
      `DUST_BAND` px/band) through it, composited between the MAP blit and
      hero. Rainbow is anchored to underground position + a constant time
      drift (`DUST_SPEED`), so it's decoupled from descent speed. Colour
      tuning is a playtest item below. (b) DONE — collection particles: on
      dig, spawn the cell as a two-stage particle (grow + radial push clear
      of the tunnel, then ease-in flight to the HUD counter); the counter
      ticks on arrival. See DESIGN.md "Graphics". (c) RESOLVED — dense-patch
      boost feel. Hit-stop (freeze a few frames on patch entry) and a
      "spool-up" (visible slowdown then catch-up) were both prototyped and
      dropped — read as jank, not juice. What shipped: the dense boost may
      overshoot the soft cap `MOMENTUM.max` up to `MOMENTUM.overMax` (`dig()`
      clamps there), then an exponential bleed in `moveHero()`
      (`MOMENTUM.overBleed`, ~0.25s) pulls the excess back to `max` on top
      of normal drag — a surge that settles, not a new plateau. HUD tie-in:
      the `speed:` value (number only, split off its label, centred on
      itself) swells up to 2x scaled by how far into the `max`→`overMax`
      band momentum sits. Tuned: max 600, overMax 800, overBleed 12. See
      DESIGN.md Win/lose + Open questions.
      (d) RESOLVED — counter ticks on particle arrival, juicier than dig-
      time. Edge case handled: `endGame()` tallies any still-in-flight
      particles' dust instantly (they keep animating on END_SCREEN, just
      already counted), so a bingo-fuel/resurface stop never scores dust as
      lost to the animation. Counter value also pops 2x-and-back on each
      tick (`DUST_POP_DURATION`), undebounced — see the game-feel memory.
- [x] Sprout a rainbow on run end. All three parts landed, plus a
      double-rainbow easter egg and a rewind-flow cleanup (parts 4 & 5).
      1. Score. RESOLVED — `score = 10·dust + 2·metres` where *metres* is
         `tunnel`, a virgin-shaft-carved px accumulator advanced in
         `moveHero()` only when the drill's leading edge cuts undug ground
         (re-running an old shaft doesn't pad it). Absolute `depth` dropped
         as the distance term (both axes infinite → arbitrary) and off the
         HUD, replaced by `shaft:` = `tunnel` in metres. END screen adds a
         `score:` line. No win/lose headline split — `well dug!`, or
         `dry run!` when zero dust was collected. Tuning
         (`SCORE_PER_DUST`/`SCORE_PER_M`) is playtest bait. See DESIGN.md
         "Run end / score".
      2. Rainbow in the sky. DONE — `renderRainbow()` grows a full semicircle
         out of the tunnel mouth on END_SCREEN, left foot on the ingress
         point (see part 5 — the earlier "egress on a resurface" was folded
         away when resurface got the rewind too), drawing itself in over
         `RAINBOW_GROW` (ease-out sweep). Foot thickness + radius scale with
         DUST collected (not score — a dustless run grows nothing), on a
         saturating curve `k = dust/(dust + RAINBOW_DUST_HALF)`. `RAINBOW_*`
         constants are playtest bait (`RAINBOW_DUST_HALF`, `RAINBOW_FOOT_MAX`,
         `RAINBOW_R_MAX`). See DESIGN.md "Run end / score — Rainbow sprout".
      3. Rainbow beam up the tunnel. DONE — as the `REWIND_SCREEN` camera
         retreats up the drilled path, the tunnel floods with rainbow behind
         it. `updateRewind()` marks each dug cell the cursor passes into
         `FILLED` (a subset of `DUG`; `fillTrailSeg`/`fillDust` re-scan the
         drill disc along each cleared trail segment so `FILLED ⊆ DUG`
         exactly — no bleed into rock on tight turns). `paintCell()` stamps
         `DUST_MASK` for a dug cell iff it's in `FILLED`, so `renderDust()`
         colours the flooded tunnel with the **same** drifting rainbow as
         uncollected dust — thematically "your dust flowing back up", and it
         survives buffer paging + the `renderMap()` that `jumpCameraTo()`
         fires on the REWIND→END handoff (a live-only `DUST_MASK` stamp would
         be wiped there). Advances in `TRAIL_STEP` (4-cell) chunks behind the
         camera; a rewind skip floods the whole remaining path in one frame.
         Considered and deferred: a distinct pattern for the beam so it reads
         as a stream rather than tunnel-shaped dust — the shared treatment
         looked good enough to skip the tuning cost. See DESIGN.md "Run end /
         score — Rainbow flood".
      4. Double rainbow (resurface easter egg). DONE — "it's a double
         rainbow all the way across the sky". A resurface that comes up
         `RAINBOW_DOUBLE_MIN..MAX` of a viewport-width from where it went in
         gets two bows instead of one, each pinned by its near foot to one
         hole and growing toward the other: OUTER (forward palette) from the
         egress hole, overshooting the ingress by `RAINBOW_DOUBLE_OVERSHOOT`;
         INNER (reversed palette, thinner, still solid) from the ingress
         hole, falling the same fraction short of egress. Opposite sweep
         directions, same grow rate (`arcBands`'s `fromRight` flag), so the
         two arcs race up and close over the tunnel. Mirrors cleanly for
         egress-on-the-right. Radii from the hole gap, NOT dust (dust still
         drives band thickness). `renderRainbow`'s band loop was extracted to
         `arcBands(cx,cy,rOut,foot,sweep,flip,fromRight)`; `rainbowSweep()`
         shared. `rainbowX` = ingress, `rainbowX2` = egress (set only for a
         double). Dead ends the user steered away from: (a) two full
         dust-scaled arches, one per hole — they overlap into mush; (b)
         dropping the concentric/meme silhouette for a bare "double arch";
         (c) a faded/ghost secondary — wanted it fully opaque. Design in
         DESIGN.md "Run end / score — Double rainbow".
      5. Rewind on resurface too. DONE — `endGame()` no longer branches on
         `resurfaced`; every run end closes the trail and plays
         `REWIND_SCREEN`. A resurface retraces the whole dive (egress →
         down the tunnel → back to the ingress mouth), flooding
         progressively, instead of the earlier instant fill. The single bow
         now always foots on the ingress mouth (`rainbowX = trail[0]`) —
         fixes a far resurface sprouting its arch off-screen. A double lands
         the camera on the two-hole midpoint (`updateRewind`) so both bows
         frame up. `rewound` is true for every end now; only a resize
         abandoning the rewind clears it (and `rainbowX2`). Net: one code
         path, and the resurface ending gets the same show-off-the-dig
         cutscene. `fillDust`'s scan radius was also widened to a full drill
         width (2× the dig radius) to close black pixels the coarse `trail`
         left on the outer edge of rounded turns — the `FILLED ⊆ DUG` gate
         keeps the wider scan from bleeding into rock.
- [x] Camera tracking: position-locking + spring-smoothing + projected focus.
      RESOLVED. The camera is a (near-)critically-damped spring (`CAMERA_STIFFNESS`
      ω, `CAMERA_DAMPING` ζ) chasing `hero_centre + CAMERA_LOOKAHEAD · cameraFocus`,
      where `cameraFocus` is a lagged copy of the hero's velocity eased over
      `CAMERA_LOOKAHEAD_LAG`. `CAMERA_LOOKAHEAD = 2ζ/ω` cancels the spring's
      steady trailing lag once `cameraFocus` has caught up → the cruising hero
      sits dead centre at any speed. A sudden speed change (dense-dust boost) or
      heading change (hard turn) isn't in `cameraFocus` yet, so the look-ahead
      term is briefly too short and the hero swings forward-of-centre toward the
      debug ring; as `cameraFocus` catches up the centre-lock restores and the
      spring reels the hero back on an ease-in/ease-out S-curve (ζ ≥ 1). Bigger
      boost → bigger throw. `updateRewind()` reuses the bare spring (no
      look-ahead) — its inertia skips the loopy-loops and catches the camera on
      the next straight. `centerCameraOn()` runs the spring (120 Hz substepped,
      stable + frame-rate independent); `followCamera()` adds the projected
      focus; hard-lock callers (seat / `reanchorBuffer` / rewind skip) pass no
      `smooth`, zero the spring velocity and snap the focus. Tuning (`CAMERA_*`
      block in game.js) is playtest bait — ζ and `CAMERA_LOOKAHEAD` must move in
      lockstep. `CAMERA_DEADZONE` + `DEBUG_CAMERA` draw a debug ring/crosshair,
      off by default (see TODO.md Later/revisit: "Delete the camera-tuning debug
      overlay"). See DESIGN.md "Graphics — Camera".

## Playtest / gameplay balancing

- [x] Steering model — absolute direction vs. bank. RESOLVED: playtesters
      confirmed the D-pad / absolute-heading model beats bank control — that
      settles the model. Pointer-steering feel is still open (see TODO.md
      Later/revisit: "Revisit pointer steering"). Turn-rate tuning
      (`TURN_SPEED`) is also still open — see TODO.md Playtest. Original
      notes kept for context:
      Playtester said the
      keyboard bank-the-heading control "didn't feel natural"; they want
      Up/Down/Left/Right (combining to diagonals) that matches the mobile
      "head where you drag" feel. First cut (instant snap to one of 8
      directions) was too snappy per the playtester — "I don't want it to
      feel super laggy, but I don't want only horizontal/diagonal/vertical
      either." Current state: keyboard + pointer both pick an ABSOLUTE
      target heading, `hero.angle` eases toward it at `TURN_SPEED = 4*PI`
      (~0.25s for a 180°, ~0.125s for 90°) — game.js `processInputs()`.
      Feel-check update (2026-08-29): curves between directions read nicer
      now, but it still feels like "constantly fighting the arrows" and
      patches get missed at `TURN_SPEED = 2*PI` — doubled to `4*PI`
      (snappier per playtest).

## Later / revisit

- [x] Depth (and speed) shown in metric. `PX_PER_M = 32` px/m, display-only —
      the sim stays in pixels, the HUD divides for the readout (`depth` in m
      to 1dp, `speed` in m/s). At this scale the drill is ~0.9 m, a dust cell
      ~0.25 m, a straight sand dive bottoms out ~48 m, a there-and-back win
      ~24 m. Scale only matters while the surface is visible (no reference
      frame once deep), so it's tuned for that. HUD also got a pass: 3x font,
      top-left + left-aligned so labels don't shift, "momentum" relabelled
      "speed", loss text "tapped out!", dust-counter value pops on each tally.
