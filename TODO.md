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
- [ ] Rainbow dust — visuals. (a) DONE — `DUST_MASK` buffer holds dust-cell
      shapes (paged like MAP, stamped by paintRow, cleared by dig);
      `renderDust()` colours the camera slice per frame by `source-in`-
      masking a repeating diagonal rainbow (`DUST_PALETTE`, 7 hues,
      `DUST_BAND` px/band) through it, composited between the MAP blit and
      hero. Rainbow is anchored to underground position + a constant time
      drift (`DUST_SPEED`), so it's decoupled from descent speed. Colour
      tuning is a playtest item below. (b) DONE — collection particles: on
      dig, spawn the cell as a two-stage particle (grow + radial push clear
      of the tunnel, then ease-in flight to the HUD counter); the counter
      ticks on arrival. See DESIGN.md "Graphics". (c) Hit-stop: freeze the
      sim for a few frames on dense-patch entry (first dense cell of a
      tick) — try it, see if the jolt reads as juicier or just laggy.
      (d) RESOLVED — counter ticks on particle arrival, juicier than dig-
      time. Edge case handled: `endGame()` tallies any still-in-flight
      particles' dust instantly (they keep animating on END_SCREEN, just
      already counted), so a bingo-fuel/resurface stop never scores dust as
      lost to the animation.
- [ ] Bingo-fuel warning. HUD alert when the player likely can't make it
      back up. Approximate — we don't know the return path or the material
      along it — so estimate against a straight climb decaying at the sand
      rate: reachable distance ≈ `momentum^2 / (2 * (entropy + sandDrag))`
      (momentum decays linearly to zero, so travel is the area under it).
      Warn when that's below `depth`, plus a threshold band (warn while
      within ~5–10% of the cutoff, before it's already lost). Tune the
      decay rate used against playtests — tunnel-drag rate if backtracking
      a dug shaft is the expected escape, sand rate if fresh digging up is
      typical.
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
- [x] Pausing (P) and resuming makes every dust cell's colour jump. Fixed:
      the rainbow phase (`dustColorAt()`, `renderDust()`) now keys off
      `gameTime`, a running total of `elapsedTime` only accumulated inside
      `loop()`'s `running` guard, instead of raw `performance.now()`
      (`currentTime`) — a pause just freezes it.

## Playtest / gameplay balancing

- [ ] Steering model — absolute direction vs. bank. Playtester said the
      keyboard bank-the-heading control "didn't feel natural"; they want
      Up/Down/Left/Right (combining to diagonals) that matches the mobile
      "head where you drag" feel. First cut (instant snap to one of 8
      directions) was too snappy per the playtester — "I don't want it to
      feel super laggy, but I don't want only horizontal/diagonal/vertical
      either." Current state: keyboard + pointer both pick an ABSOLUTE
      target heading, `hero.angle` eases toward it at `TURN_SPEED = 2*PI`
      (~0.5s for a 180°, ~0.25s for 90°) — game.js `processInputs()`.
      `TURN_SPEED` is the tuning knob. Still needs a feel check, and:
      (1) tune the rate to taste; (2) an eased turn keeps a pull-up
      commitment cost, but it's shorter now than the old ~1s bank — watch
      whether the bingo-fuel tension DESIGN.md's Win/lose leans on ("only
      safe line is a shallow pull-up") still holds. If this model sticks,
      sync DESIGN.md Controls + fold in the pointer-smoothing TODO below.
      Feel-check update (2026-08-29): curves between directions read nicer
      now, but it still feels like "constantly fighting the arrows" and
      patches get missed — `TURN_SPEED` dampening needs a tuning pass.

- [ ] Rainbow dust palette (`DUST_PALETTE` in game.js). The 7 swatches are
      currently held dark/desaturated to kill the blinding yellow-green-cyan
      flare — went a touch far the other way, they read a little muted. Spend
      a session tuning each entry for "rainbow bright but not blinding":
      vivid enough to feel like rainbow dust, luminance flat enough that no
      band flares. `DUST_BAND` (band width) and `DUST_SPEED` (drift rate,
      keep it a divisor of `DUST_P` = BAND×7) are settled but fair game.

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
- [ ] Drop resurfacing as a win condition — dig-only-down. If playtesting
      shows bingo-fuel warnings aren't enough to make players turn around
      on their own, cut the "climb back to the surface" win entirely: the
      run just ends when momentum hits 0, wherever the player is. On
      end, camera fast-scrolls up the tunnel back to the surface (dust
      collected along that tunnel "sprouting" the rainbow as it passes) as
      the outcome reveal, instead of the player having to actually pilot
      the climb. Turns the game into pure descent — no return-trip
      management. Needs a design pass: what replaces the win condition,
      does depth alone become the score, does bingo-fuel still matter as a
      mechanic if there's nothing to conserve fuel for.

## Won't do

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
