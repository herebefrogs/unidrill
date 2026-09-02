# unidrill — implementation TODO

Ordered roughly by dependency, not necessarily by priority. See `DESIGN.md`
for the reasoning behind each of these; this is just the sequencing.
Completed items are moved to `CHANGELOG.md` (an archive, not read on startup)
as they land — this list stays scoped to open work.

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

- [ ] TURN_SPEED feel-check at 4π. The absolute-heading steering model is
      settled (playtesters picked it over bank control — see CHANGELOG.md),
      but the turn rate isn't: at `TURN_SPEED = 2*PI` it felt like "constantly
      fighting the arrows" and dust patches got missed, so it was doubled to
      `4*PI` (~0.25s for 180°, ~0.125s for 90°). Needs a fresh feel check at
      the new rate — and a check that the shorter turn still preserves the
      pull-up commitment cost the run-end tension leans on. `TURN_SPEED` in
      game.js `processInputs()` is the knob.

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

- [ ] Delete the debug overlays — the `DEBUG_CAMERA` flag + ring/crosshair
      block and the `DEBUG_POINTER` flag + its branch of the D-pad draw block,
      both at the end of `render()` in game.js. **Only if we're over the 13 KB
      budget at submission time.** As of the camera-tracking commit there's
      ~40–50% headroom, so keep them for now — handy for re-tuning the
      `CAMERA_*` constants and the pointer `RAMP`/`DEAD`. (Keep the plain
      base+knob D-pad overlay — that's the shipped control, not debug.)
- [ ] Name the game **Errand of Iris** and build the light framing around it.
      Decided — replaces the "UniDrill Corp" working title (avoids the
      "unicorn"/"rainbow"/"prism" words every other entry will lean on).
      Iris is the Greek goddess of the rainbow and messenger of the gods,
      who travels *along* the rainbow — but nobody in-game needs to know
      that; the framing is carried by two small in-game beats, not backstory:
      - Title screen: a line or two setting up the errand — Iris has a
        message to deliver, she can only travel by rainbow, build her one
        from the ground up. The bigger the rainbow, the happier she is.
      - End screen: after the sky rainbow finishes drawing itself in, Iris
        walks it — on at the near foot, over the apex, off toward her
        destination. How far she gets / how sprightly she looks scales with
        the rainbow size (i.e. dust collected): a big haul carries her clean
        over, a thin arc leaves her trudging. Zero dust → no rainbow, she
        just waits at the tunnel mouth (what `dry run!` reacts to). Gets the
        grander arc on the double-rainbow resurface. Render-only, a small
        canvas figure in the same spirit as the player unicorn.
      - The end headline becomes Iris's reaction to the rainbow, not a
        neutral status — warm line scaled to the haul at the top, `dry run!`
        at zero. (`well dug!` / `dry run!` are the current placeholders.)
      Player is still the unicorn drill; Iris is only ever an NPC who shows
      up at the end. When this lands, sync DESIGN.md — Premise, Run end /
      score headline, and a new end-screen "Iris crossing" beat.
      Other names considered and dropped: Gusher, Bloomshaft, "Colours Shall
      Rise", Bloomwright, Arcus, "Seven Below".
- [ ] Create the title screen (currently skipped: boots straight into
      GAME_SCREEN, see game.js). Carries the Errand of Iris framing above.
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
