# unidrill — implementation TODO

Ordered roughly by dependency, not necessarily by priority. See `DESIGN.md`
for the reasoning behind each of these; this is just the sequencing.

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
- [x] Handle colliding with the vertical edges of the map. (Currently a
      hard clamp of `hero.x` to the viewport width in `moveHero()` — no
      horizontal camera panning yet, so viewport edge == map edge for now.)
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
- [ ] Rainbow dust — properties. Hook collection into `dig()`'s
      `if (!DUG.has(key))` guard: call `sampleDust(x, undergroundY)` (dig()
      already has both in underground space); if it's not NONE, `+1` the
      dust counter; if DENSE, add a configurable amount to `hero.momentum`.
      No `COLLECTED` set — collected = `DUG` ∩ `sampleDust`. Show the
      counter in the HUD. NOTE: `digShaft()` clears many cells per tick, so
      a per-cell DENSE boost is a big jolt on patch entry — ship per-cell,
      revisit the per-tick-cap (already noted in DESIGN Open questions) if
      it feels bad. Landing this retires the "no dust boosts implemented
      yet" paragraph in DESIGN.md's Win/lose.
- [ ] Rainbow dust — visuals. (a) Palette rotation: every on-screen dust
      cell shares one hue cycled red→orange→yellow→green→blue→purple→red
      over time; render on a per-frame animation layer between the MAP blit
      and the HUD text — dust must NOT be baked into MAP. (b) Collection
      particles: on dig, spawn the cell's pixels in screen space, fly them
      to the HUD counter under linear acceleration, tick the counter on
      arrival. See DESIGN.md "Graphics".
- [ ] Add ROCK as a third material. Solid and undrillable — the drill can't
      carve it. On contact it deflects the player's heading (bounce) rather
      than stopping them dead. See DESIGN.md (materials, and the rock
      deflection open question).
- [ ] Horizontal camera panning. Camera x is pinned to 0 right now
      (`followCamera()` only touches y; `updateCameraWindow()` has x logic
      but is never called). Needed before edge collision can clamp to the
      real map edge instead of the viewport.
- [ ] Camera tracking: position-locking + lerp-smoothing. Camera aims to
      hold the player at the exact screen center, but lets them drift away
      temporarily (e.g. a dense-dust velocity boost) and each frame lerps
      the center-to-player gap back down toward zero. See DESIGN.md's open
      question on camera tracking.
- [ ] RNG seeds. Give the underground generation its own seeded RNG,
      initialized from the string `JS13K2026`. Nothing else may draw from
      the underground RNG — if some other system needs randomness, spin up
      a separate generator for it. Title screen needs a "share your seed"
      option (there's a helper in src/js/share.js) and a way to generate
      fresh seeds for replayability. Ship a few hand-picked seeds too:
      `JS13K2026`, `RAINBOWS`, `UNICORNS`.
- [ ] Highscore. Using the storage helper (src/js/storage.js) under key
      `2026.unidrill`, keep a hash of `{ highscore, date }` keyed by seed.
      Lets us show a highscore list and let the player reload a past seed
      to try to beat their score. (Storage helper prefix is currently
      hardcoded to `2020.workingTitle` — needs updating.)

## Bugs

- [ ] Player continues upward into the sky past the surface line. (Moot on
      the game screen now — the resurface win fires at `depth <= 0` before
      the hero climbs far — but the underlying world-space surface clamp was
      removed, so revisit if a post-win fly-up or a title-screen preview
      needs it.)
- [ ] In portrait screen ratio, the canvas should use the whole screen to
      show as much of the underground as possible. Revisit the locked-ratio
      logic then — it may be wrong regardless of screen orientation.

## Later / revisit

- [ ] Depth is currently displayed in raw pixels. Should be in meters, but we
      don't know the px-per-meter ratio until map/viewport sizing is
      finalized. Revisit once that's locked in.
- [ ] Brainstorm whimsical game names that avoid "unicorn" and "rainbow" —
      most other entries will lean on those words, want something that
      stands out. "UniDrill Corp" is just the working title for now.
- [ ] Create the title screen (currently skipped: boots straight into
      GAME_SCREEN, see game.js).
- [ ] Revisit pointer steering: direction changes feel abrupt right now,
      because of the unusual pointer-direction logic in src/js/inputs/pointer.js
      (built to work around a smartphone touch quirk - get the full context
      from Jerome before changing it).
- [ ] Add gamepad support. There's prior art in Jerome's old veggie-ninja repo:
      https://github.com/herebefrogs/veggie-ninja/blob/master/src/js/gamepad.js
      (and possibly an older commit in gamejam-boilerplate's own history).
