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
- [ ] Sprout a rainbow on run end (momentum runs out OR resurface — both are
      now wins, the run just ends, see "Won't do: bingo-fuel warning"). Three
      parts:
      1. Score. RESOLVED — `score = 10·dust + 2·metres` where *metres* is
         `tunnel`, a virgin-shaft-carved px accumulator advanced in
         `moveHero()` only when the drill's leading edge cuts undug ground
         (re-running an old shaft doesn't pad it). Absolute `depth` dropped
         as the distance term (both axes infinite → arbitrary) and off the
         HUD, replaced by `shaft:` = `tunnel` in metres. END screen adds a
         `score:` line. No win/lose headline split — both ends read
         `well dug!`. Tuning (`SCORE_PER_DUST`/`SCORE_PER_M`) is playtest
         bait. See DESIGN.md "Run end / score".
      2. Rainbow in the sky. Camera fast-scrolls up to the surface; a rainbow
         grows out of the tunnel mouth into the sky, its width proportional
         to `score`.
      3. Rainbow beam up the tunnel. While the camera scrolls up, a rainbow
         stream starts at the player sprite and backtracks the tunnel to the
         surface. Keep a running list of approximate segments as the player
         drills (append as the shaft is carved); the beam walks that list
         back. Camera locks onto the beam's tip instead of the player for the
         duration. Ties into the "drop resurfacing as a win" idea below.
- [ ] Music and sound effects. SFX for: collecting a dust cell, the dust
      counter tally-tick, stalling out (momentum hits 0), and sprouting the
      end-run rainbow. Plus background music. Helpers in src/js/sound.js
      (and src/js/speech.js) are stubbed — wire them in.
- [ ] Player sprite. Replace the blue cube with a stylized unicorn drawn at
      runtime with canvas primitives (rects + paths), not a bitmap sprite:
      square head, triangle horn/drill, rectangle body + tail, slim
      rectangles for legs. All white except the horn and tail, which are
      purple. Head/body/tail are a loose rag-doll chain (each lags the one
      ahead). Legs wiggle like digging/swimming, wiggle rate proportional to
      player speed (`hero.momentum`). Keep the collision AABB (`HERO_W/H`)
      as-is; this is render-only.
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

(none open)

## Playtest / gameplay balancing

- [x] Steering model — absolute direction vs. bank. RESOLVED: playtesters
      confirmed the D-pad / absolute-heading model beats bank control — that
      settles the model. Pointer-steering feel is still open (see "Revisit
      pointer steering" below). Original notes kept for context:
      Playtester said the
      keyboard bank-the-heading control "didn't feel natural"; they want
      Up/Down/Left/Right (combining to diagonals) that matches the mobile
      "head where you drag" feel. First cut (instant snap to one of 8
      directions) was too snappy per the playtester — "I don't want it to
      feel super laggy, but I don't want only horizontal/diagonal/vertical
      either." Current state: keyboard + pointer both pick an ABSOLUTE
      target heading, `hero.angle` eases toward it at `TURN_SPEED = 4*PI`
      (~0.25s for a 180°, ~0.125s for 90°) — game.js `processInputs()`.
      `TURN_SPEED` is the tuning knob. Still needs a feel check, and:
      (1) tune the rate to taste; (2) an eased turn keeps a pull-up
      commitment cost, but it's shorter now than the old ~1s bank — watch
      whether the bingo-fuel tension DESIGN.md's Win/lose leans on ("only
      safe line is a shallow pull-up") still holds. If this model sticks,
      sync DESIGN.md Controls + fold in the pointer-smoothing TODO below.
      Feel-check update (2026-08-29): curves between directions read nicer
      now, but it still feels like "constantly fighting the arrows" and
      patches get missed at `TURN_SPEED = 2*PI` — doubled to `4*PI`
      (snappier per playtest); still needs another feel check at the new
      rate.

- [ ] HUD feel-check. Now 3x font, metric units (speed ~19 m/s at launch,
      depth in m). Confirm the numbers read right in play and that the larger
      font isn't crowding the play area on the smallest target viewport
      (portrait mobile especially). `PX_PER_M`, `HUD_SCALE`, `DUST_POP_DURATION`
      are the knobs. Layout constraint (see the `RENDER_SCALE` comment in
      game.js): the widest HUD string must fit in `CAMERA_WIDTH`, and at
      `RENDER_SCALE = 1` a ~393px phone leaves essentially zero margin —
      bump `RENDER_SCALE` only with a matching `HUD_SCALE` drop, checked on
      the narrowest target.

- [ ] Rainbow dust palette (`DUST_PALETTE` in game.js). The 7 swatches are
      currently held dark/desaturated to kill the blinding yellow-green-cyan
      flare — went a touch far the other way, they read a little muted. Spend
      a session tuning each entry for "rainbow bright but not blinding":
      vivid enough to feel like rainbow dust, luminance flat enough that no
      band flares. `DUST_BAND` (band width) and `DUST_SPEED` (drift rate,
      keep it a divisor of `DUST_P` = BAND×7) are settled but fair game.

## Later / revisit

- [x] Depth (and speed) shown in metric. `PX_PER_M = 32` px/m, display-only —
      the sim stays in pixels, the HUD divides for the readout (`depth` in m
      to 1dp, `speed` in m/s). At this scale the drill is ~0.9 m, a dust cell
      ~0.25 m, a straight sand dive bottoms out ~48 m, a there-and-back win
      ~24 m. Scale only matters while the surface is visible (no reference
      frame once deep), so it's tuned for that. HUD also got a pass: 3x font,
      top-left + left-aligned so labels don't shift, "momentum" relabelled
      "speed", loss text "tapped out!", dust-counter value pops on each tally.
- [ ] Pick the game name. Avoid "unicorn" / "rainbow" / "prism" — every
      other entry will lean on those. Front-runner: **Gusher** (the end-run
      rainbow erupts out of the tunnel mouth like an oil gusher — names the
      single most distinctive thing on screen, no backstory needed).
      Runner-up: **Bloomshaft** (bloom + mineshaft). Also considered:
      "Colours Shall Rise", "Bloomwright", "Arcus", "Seven Below". "UniDrill
      Corp" is the throwaway working title.
- [ ] Create the title screen (currently skipped: boots straight into
      GAME_SCREEN, see game.js). Also: replace the end-screen loss text
      "tapped out!" with "Well Drilled!" (no fail state any more — see
      "Run end / score").
- [ ] Revisit pointer steering: direction changes feel abrupt right now,
      because of the unusual pointer-direction logic in src/js/inputs/pointer.js
      (built to work around a smartphone touch quirk - get the full context
      from Jerome before changing it). Also add a visual on-screen D-pad for
      touch (show the control, and the current drag direction).
- [ ] Add gamepad support. There's prior art in Jerome's old veggie-ninja repo:
      https://github.com/herebefrogs/veggie-ninja/blob/master/src/js/gamepad.js
      (and possibly an older commit in gamejam-boilerplate's own history).
- [ ] Drop the bitmap font, switch to Impact. Sharper and more readable than
      the pixel font, and it's a system font so it costs no bytes. Would
      retire src/js/text.js (`renderText`/charset sprite/`CHARSET_SIZE`/
      `ALIGN_*`) in favour of plain canvas `fillText` — touches every HUD
      + screen-text call site and the `scale`/`HUD_*` layout math.
- [ ] Add ROCK as a third material. Solid and undrillable — the drill can't
      carve it. On contact it deflects the player's heading (bounce) rather
      than stopping them dead. See DESIGN.md (materials, and the rock
      deflection open question). Deprioritised — the core loop works without
      a hard obstacle for now.

## Ideas — not yet designed

Half-formed; each needs a design pass before it becomes a build item.

- [ ] Upgrade picks. Every X dust collected, pause the game and offer 2–3
      upgrade options to choose from (roguelite-style). X, the option pool,
      and what the upgrades do are all TBD. Open: does a mid-dive pause
      break the one-decision-per-second push-your-luck tension, or add a
      welcome second layer of choice? Run-scoped or meta-progression across
      runs?
- [ ] Underground creatures. Would baddies improve the game — worms,
      centipedes, beetles, leprechauns? Completely unformed: brainstorm how
      they weave into the momentum loop (obstacle that costs momentum?
      steals dust? chases you on the ascent? a leprechaun guarding a dense
      patch?) before it's worth prototyping. Risk: the game's pleasure is
      carving your own path — anything that demands twitch dodging could
      fight that.
## Won't do

- Bingo-fuel warning. Was: a HUD alert when the player likely can't climb
  back out (reachable distance ≈ `momentum^2 / (2*(entropy + sandDrag))`,
  warn when that drops below `depth`). Dropped with the objective change —
  the player now wins whether they resurface or not (the run just ends when
  momentum hits 0, wherever they are, and a rainbow sprouts back up the
  tunnel). There's no failed-return-trip to warn about any more; shaft
  length carved feeds the score, not depth. See "Sprout a rainbow on run
  end".

- Rainbow dust — carry penalty. DESIGN.md's old core-loop line said
  "carrying more dust drains momentum faster"; the idea was to scale
  momentum decay by the `dust` count so a greedy deep run is more
  precarious on the return. Prototyped and dropped. What we found:
  - A naive per-cell drag term made the game brutally hard — the terrain
    already decays you continuously, so this was a second, always-on drag
    stacked on top ("double drag").
  - Zeroing SAND drag to make room for it helped, but turned the game into
    a different, more punishing thing and made clay patches near-instant
    death.
  - It actively fought the dense-dust boost: a dense patch sped you up and
    permanently loaded you down in the same pass, so the boost stopped
    reading as a reward.
  - Capping the carry term kept it playable but exposed the real problem —
    a capped penalty is just a one-time tax on your first ~40 dust, after
    which it's the no-penalty game again, so the mechanic isn't even
    load-bearing.
  Fundamentally a carry penalty punishes the player for collecting, when
  the whole game is about wanting them to collect as much as possible. The
  no-penalty version — pure momentum management, drag from terrain only,
  speed from dense dust — is simpler and more intuitive: one source of
  slowdown (terrain), one source of speed (dust). Keeping that.
