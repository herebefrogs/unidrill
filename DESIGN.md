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

**Framing: Errands of Iris.** Iris — Greek goddess of the rainbow, messenger
of the gods, who travels *along* the rainbow — has a message to deliver and
can only travel by one. Nobody in-game needs the myth spelled out; it's
carried by a title-screen beat: a speech bubble reads "I have a message to
deliver. Collect dust to grow a rainbow bridge for me." over a backdrop showing the
dust patches she means. The player is still the unicorn drill; Iris is only
ever an NPC. She's drawn from `src/img/sprites.webp` (`drawIris()`) and stands
by her bubble on TITLE/HIGHSCORE, then keeps her spot on GAME/REWIND. On
END_SCREEN — dust permitting — she walks to the near foot of whichever
rainbow she'll ride (see "Iris crossing" below) and rides it out. The end
headline itself is still the neutral `Well dug!`/`Dry run!`/`Double
rainbow!` placeholder, not yet Iris's own reaction line (open, see TODO.md).

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

## Run end / score

**No-fail.** There is no lose state. The run ends — and a rainbow sprouts if
any dust was collected — in either of two ways, and both are scored the same way:

- Momentum decays to zero while still underground (the drill stalls out
  wherever it is), or
- the drill returns to the surface (`depth` back to 0) with momentum still
  to spare, after a qualifying dive (drilled at least a minimum depth, so an
  instant frame-1 pull-up doesn't end the run).

`score = SCORE_PER_DUST·dust + SCORE_PER_M·metres` (currently 10 and 2),
where *metres* is the length of **virgin shaft carved** this run — `tunnel`,
a px accumulator advanced in `moveHero()` only while the drill's leading
edge is cutting undug ground, so re-running an old shaft doesn't pad it.
Absolute `depth` is no longer scored or shown: both axes drill infinitely,
so how deep you happen to be reads arbitrary. Both terms reward
independently; `SCORE_PER_M` sits high enough that a wide sideways drill
still scores, but dust is the denser reward. Resurfacing is not required to
score; it just ends the run early with whatever momentum is left. A run that
collected dust shows the neutral headline `Well dug!` (or `Double rainbow!`
when the resurface earned the two-bow arch); a run that collected none shows
`Dry run!` — a nudge to collect, since it also grew no rainbow. No win/lose
split either way. (This replaces the earlier bingo-fuel lose
condition — see TODO.md "Won't do: Bingo-fuel warning".)

**Rainbow sprout.** On END_SCREEN a rainbow grows out of the tunnel mouth: a
full semicircle with its **left foot on the ingress point** (`trail[0]`) —
where the camera rewind lands, for a stall and a plain resurface alike (a
resurface far enough from its entry gets the *double*, below). It draws
itself in over ~`RAINBOW_GROW` seconds (ease-out sweep, left foot → apex →
far foot). Both
the foot thickness (the stacked band width where it meets the ground) and the
overall radius scale with **dust collected, not score** — dust is the whole
point, so a long shaft that bagged nothing sprouts no rainbow at all. The
dust→size curve *saturates* (`k = dust / (dust + RAINBOW_DUST_HALF)`): more
dust is always a bigger rainbow, with diminishing returns, no hard cap where
every real run pins to max. A big haul overflows the sky and clips off the
top — fine by design. `RAINBOW_*` constants in game.js; `renderRainbow(footX)`
draws it (`arcBands()` lays the 7 concentric strokes, `DUST_PALETTE`, red
outermost).

**Double rainbow (resurface easter egg).** "It's a double rainbow all the way
across the sky." When a resurface end brings the drill up between
`RAINBOW_DOUBLE_MIN` and `RAINBOW_DOUBLE_MAX` of a viewport-width away from
where it went in, both holes get honoured with a bow each, **pinned by its
near foot to one hole and growing toward the other**:

- the **outer** bow (reversed palette, violet out — the "secondary") sprouts
  from the **egress** hole. It's a touch wider than the hole span
  (`RAINBOW_DOUBLE_OVERSHOOT`), so its far foot lands just *past* the ingress hole.
- the **inner** bow (forward palette, red out — the "primary"; thinner, still
  drawn solid so it reads as a real second bow) sprouts from the **ingress**
  hole. A touch narrower than the span, so its far foot lands just *short* of
  the egress hole.

The two palettes run opposite so the reds face each other across the gap
between the bows, like a real double rainbow.

They sweep in opposite directions and grow at the same rate, so on a wide
double you watch two arcs race up from the two holes and close over the
tunnel that links them underground. The whole thing mirrors cleanly whichever
hole is on the left. The camera rewind (below) plays as normal, but instead
of landing on the ingress mouth it lands on the **two-hole midpoint** so both
near feet frame up; the overshooting far feet can clip the edges on a wide
span, which is fine. Both radii come from the **hole separation, not dust** (a
longer sideways traverse earns grander bows); dust still drives band thickness
(clamped so the stack fits the smaller inner arc). Outside the distance window
it's the normal single arch at the ingress mouth: too close and the two feet
don't read as a span, too far and the second hole won't frame up even
recentred. `renderDoubleRainbow(egressX, ingressX)` — both bows via
`arcBands`, whose `fromRight` flag picks the growth direction; `rainbowX` is
the ingress, `rainbowX2` the egress (set only for a double, else `undefined`).

**Iris crossing.** On a run that collected dust, Iris walks to the near foot
of whichever rainbow the score grew and rides it out — on a dry run she stays
put at the tunnel mouth (what `dry run!` reacts to). Which bow: the single
arch's left (ingress) foot; on a double, the **inner** bow (ingress-anchored,
sweeps left→right) always, even when the outer bow's near foot is
geometrically further left — the outer bow sweeps right→left, so riding it
would have her set off before it's finished drawing itself in.
`rainbowRideArc()` derives the exact `{cx, r}` of that bow's on-screen arc
(matching `renderRainbow`/`renderDoubleRainbow`'s own geometry) so she
traces the visible curve, not an approximation. Two-phase motion: `walkIrisTo`
lerps her to the foot over `IRIS_WALK_DURATION`, then `updateIrisRide` arcs
her `cx + r·cos(θ)`/`r·sin(θ)` from the near foot to the far one. Both survive
the REWIND→END_SCREEN handoff and reset on Retry (`startGame()` reseats her
at her title-screen spot).

**Camera rewind.** However the run ends, the camera retraces the drilled path
back to the ingress mouth before the score appears — a short cutscene that
shows off the tunnel the player carved and floods it with the rainbow that's
about to sprout. A **stall** rewinds from deep up to the surface; a
**resurface** starts already at the surface (the egress hole) and retraces
the whole dive — down through the tunnel and back up to the ingress mouth.
The path is recorded live as a coarse breadcrumb polyline (`trail`, a point
every `TRAIL_STEP` of drill travel, in scroll-invariant world/underground
space); `REWIND_SCREEN` lerps the camera back down it at a speed derived from
the true path length so the walk always takes about `REWIND_DURATION` (~1.1s)
regardless of route, loops and detours replayed faithfully. A fresh key/tap —
one that starts *during* the rewind — fast-forwards straight to the end; a key
still held from gameplay doesn't count (and releasing it costs nothing), so
the player always sees the cutscene at least once. It normally lands on the
ingress mouth (`trail[0]`); a resurface that earned the double rainbow lands
on the two-hole midpoint instead. **One exception:** a resurface with an
empty dust counter skips the rewind entirely and cuts straight to the score —
there's no rainbow to flood and the drill's already at the surface, so the
walk-back would show off nothing (END_SCREEN then draws the drill where it
surfaced, the same as a resize that abandoned a rewind mid-play).

**Rainbow flood.** As the rewind camera retreats up the tunnel, the shaft
fills with rainbow behind it — a rising front that follows the drilled route
faithfully through loops and detours, so by the time the camera surfaces the
whole tunnel is lit and it reads as the sky rainbow erupting out of a
tunnel already full of it. Mechanism: `updateRewind()` marks every dug cell
the cursor passes (`FILLED`, a subset of `DUG`; `fillTrailSeg`/`fillDust`
re-scan the drill disc along each cleared segment so `FILLED ⊆ DUG` exactly,
no bleed into rock). `paintCell()` stamps `DUST_MASK` for a dug cell iff it's
in `FILLED`, so `renderDust()` colours the flooded tunnel with the **same
drifting rainbow** as uncollected dust — thematically "your dust flowing back
up", and it survives buffer paging and the `renderMap()` that fires on the
REWIND→END_SCREEN handoff. The flood stays visible under the sprouting sky
rainbow on END_SCREEN. It advances in `TRAIL_STEP` (4-cell) chunks; a rewind
skip floods the whole remaining path in one frame. A resurface runs the same
rewind (it just starts at the egress hole, not deep), so its tunnel fills
progressively too. A run that bagged **no dust** floods nothing — a stall
still rewinds the camera to show the dig, but with no rainbow behind it
(`rewindFillI` starts at 0 so the fill front never chases the cursor); a
dry-run resurface skips the rewind altogether (above). `fillDust` scans a generous radius (a full drill width,
2× the dig radius) around each breadcrumb: the `trail` is coarse, so its
straight chords cut inside the drilled arc on rounded turns and a
tight-radius scan would leave black pixels on the outer edge of a bend — the
`FILLED ⊆ DUG` gate means the wider scan only ever fills real tunnel.
Considered and deferred: a distinct pattern for the beam (brighter / its own
ramp / a travelling pulse) so it reads as a stream rather than tunnel-shaped
dust — the shared treatment looked good enough to not spend tuning time on.

END_SCREEN shows a chevron menu — **Try again** (replays the same seed),
**Share your score**, **Back to main menu** — under the score line, same
Up/Down/Enter/tap interaction as the title menu (see Screens). It's gated the
same way as the title menu's first arming: a steering key still held when the
run ended (or one held to skip the rewind) can't fire whatever item the
chevron lands on — `endArmed` only goes true once every key/pointer has been
released at least once since the screen appeared.

Dense dust tops momentum back up (`MOMENTUM.denseBoost` px/sec per dense
cell dug — `digShaft()` clears several cells per tick, so entering a patch
gives a jolt), so a deeper dive stays alive longer when the drilled route
threads through dense patches. The boost is allowed to punch *past* the
soft cap `MOMENTUM.max` (up to a hard `MOMENTUM.overMax`) so the kick still
lands when you enter a patch already at top speed; the excess then bleeds
back to `max` exponentially (`MOMENTUM.overBleed`, ~0.25s), so it reads as
a surge that settles rather than a new plateau. A dive that misses the
dense patches decays on drag + entropy alone.

## Tracked state

Speed, shaft length, dust collected (HUD labels `Speed:` / `Shaft:` /
`Dust:`). The HUD shows them top-left, left-aligned, at 3x base text size.
Speed and shaft length are converted from the pixel-space sim values to
metric for display only (`PX_PER_M` = 32 px/m → `speed` in m/s, `shaft` in
m, no decimal — the accumulator hits four digits routinely); the sim itself
never leaves pixels. Dust is shown in grams (`42g`) — the raw dust-cell
tally, no conversion, just a metric-flavoured unit suffix. `depth` is still tracked (it gates the resurface end)
but no longer shown. The speed *value* (the number only, not the `speed:`
label — drawn separately, centred on itself) swells up to 2x while momentum
is in the overspeed band, scaled by how far between `MOMENTUM.max` and
`overMax` it sits — so the pop rides a dense patch's boost up and its bleed
back down, no separate timer. The metric scale only reads as meaningful
while the surface is on screen — once deep there's no reference frame — so
it's tuned for that: the drill is ~0.9 m, a dust cell ~0.25 m, a straight
sand dive bottoms out around 48 m.

END_SCREEN keeps the same top-left `Speed:`/`Shaft:`/`Dust:` HUD running
(`renderHud()`, shared with `GAME_SCREEN` — the corner stays put across the
rewind instead of a score readout popping up somewhere new), speed pinned to
`0m/s` (`endGame()` zeroes `hero.momentum`) since the run is over. A
centred `Score:` line is the only new readout, above the Try again / Share
your score / Back to main menu menu (see Run end).

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
- Pointer (mobile): a **floating D-pad**. On touch-down an anchor is dropped
  at the contact point; the steering vector is `(finger − anchor)` per axis,
  ramping linearly from 0 to ±1 over `RAMP` px (55). Push past that and the
  anchor *trails* the finger, staying `RAMP` behind — so the pad follows your
  thumb and a long drift never leaves it stranded. A small per-axis dead band
  (`DEAD`, 8px) around the anchor reads as exactly 0, which also snaps a
  mostly-vertical or mostly-horizontal drag to a pure cardinal. On a reversal
  the finger has to travel back through the (trailed) anchor before that axis
  flips sign — the D-pad feel players expect, and the fix for the old scheme's
  instant, disorienting flip. `game.js` normalises the vector, so only its
  angle reaches the heading math; the ramp magnitude drives the on-screen
  overlay (base disc + knob on the finger; `DEBUG_POINTER` shows the full
  model breakdown).
- **M**: step the master volume (see Music & sound). Works on every screen —
  undocumented on the title menu's Music item (like Space/Enter's overlap with
  the chevron menu, it's a shortcut for a control that's already reachable the
  normal way).
- **Esc**: on `END`/`HIGHSCORE`, back to `TITLE` — same destination as those
  screens' "Back to main menu" menu item, just a shortcut past it.

**World edges.** The map is unbounded left, right and down — the drill can
roam sideways as far as it likes, momentum decay is the only limit on a
horizontal run. The one edge left is the surface, and it's soft, feeding a
corrected target heading through the `TURN_SPEED` ease rather than a hard
stop:

- Surface: no hard ceiling. Before the qualifying dive is armed
  (`heroWentDeep`), breaching more than one drill-height above the surface
  forces a full dive on the vertical input, so the drill porpoises back
  under instead of coasting off into the drag-free sky (holding Up just
  skips it along the surface, bleeding momentum, until it goes deep or
  stalls). Once `heroWentDeep`, reaching the surface ends the run before
  this triggers.

The steering model — absolute target heading, eased at `TURN_SPEED`, vs.
the old relative bank — is settled: playtesters confirmed it over bank
control. `TURN_SPEED` itself is still being tuned against playtests (see
TODO.md).

## Graphics

2D side view, pixel art. Camera shake for impact. (Two juice beats for
dense-patch entry were prototyped and dropped — hit-stop, a few frozen
frames, and a "spool-up", a visible slowdown then catch-up: both read as
jank, not juice. The dense-boost surge now carries that beat instead, see
Run end / score.)

**Text.** All on-screen text is the **Impact** system font — ships by default
on Windows and macOS — falling back to **Roboto** (Android) then **San
Francisco** (iOS/-apple-system) on platforms without it, white with a black
round-joined `strokeText` casing under
the fill so it stays legible over any background — no backing rect. Costs no
bytes and no asset load. `text.js` renders it into an offscreen buffer that
composites over the frame; `renderText(msg, x, y, align, scale)` sizes the
glyph box to `scale · CHARSET_SIZE · FILL` px of cap height with the cap top
anchored at `y` (so `FILL`, the one apparent-size knob, can be tuned without
shifting any line stack). Case is the caller's choice — `12m` (metres) must
not read as `12M` (millions). The old pixel-art charset sprite and its
lowercase-only, limited repertoire are gone.

**Viewport.** One fixed knob, `RENDER_SCALE` (screen px per world px), sets
how big everything renders — dust cell, HUD glyph, drill — and it is the
same on every device, so a phone never gets a shrunken-looking game. The
viewport dimensions in world px are then derived from the live window
(`window / RENDER_SCALE`, clamped, snapped to the cell grid) and every
offscreen buffer is reallocated to match on resize/rotate. Vertical is the
tension axis and gets whatever height the window gives; the sky band above
the surface stays a fixed height, all extra vertical space goes underground.

The camera follows the drill on both axes with no bounds. `MAP` / `BUFFER` /
`DUST_MASK` are 2× the viewport each way — a scroll-lookahead margin — and
the camera pages them (shift the pixels, repaint only the newly exposed
strip) whenever it drifts past a buffer edge, on X exactly as on Y.
`mapOffsetX` / `mapOffset` track which world column / underground row buffer
origin currently sits at; both stay cell-aligned so the dug-cell set still
lines up after a page. World-x can go negative once the drill heads left of
its start.

**Camera tracking — position-locking + spring + projected focus.** The camera
is a near-critically-damped spring (own velocity, 120 Hz substepped) chasing a
target that leads the hero by a *lagged* copy of its velocity (`cameraFocus`,
eased toward the true velocity over `CAMERA_LOOKAHEAD_LAG`). Once the lag has
caught up the lead exactly cancels the spring's steady trailing offset
(`CAMERA_LOOKAHEAD = 2ζ/ω`), so a cruising hero sits **dead centre at any
speed** — no drift with velocity, only with acceleration. The intended feel,
in order of situation:

- *Steady drilling:* hero locked to screen centre.
- *Dense-patch boost:* the speed jumps but `cameraFocus` hasn't caught up, so
  the lead is briefly too short — the hero swings **forward of centre** toward
  the edge of a notional circle (~`CAMERA_DEADZONE` px), further for a bigger
  boost. Then as `cameraFocus` catches up the lock restores and the spring
  reels the hero back on an **ease-in / ease-out S-curve** (ζ ≥ 1, no
  overshoot). "Enjoy the boost, then get pulled back faster and faster."
- *Hard turn:* `cameraFocus` keeps pointing the old heading for a moment, so
  the camera hangs behind the turn and catches up after.
- *End-of-run rewind:* the camera walks the drilled `trail` back to the
  surface on the **bare spring, no look-ahead** — its inertia skips tight
  loops/knots and re-catches the path on the next straight, which is what
  keeps a loopy run from being motion-sickening.

All `CAMERA_*` constants (game.js) are playtest bait; ζ and `CAMERA_LOOKAHEAD`
move together. A `DEBUG_CAMERA` flag draws the centre crosshair + ring for
re-tuning, off by default.

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
The end-of-run rainbow flood reuses this exact machinery — flooded tunnel
cells (`FILLED`) get stamped into `DUST_MASK` too and pick up the same
drifting rainbow (see "Rainbow flood" under Run end / score).

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
that ends (stall-out or resurfacing) while particles are still mid-flight
must tally their dust instantly rather than let the score depend on how
much of the animation had time to finish; those particles keep flying
visually after the tally, they just don't double-count on arrival. On each
tick the counter *value* (the number only, not the `Dust:` label) briefly
swells to 2x and back (`DUST_POP_DURATION`), scaling about its own centre;
re-triggers aren't debounced, so a dense-patch burst reads as a rapid
pulse.

**Layer order** (far → near):

```
  MAP layer         baked terrain + carved tunnel (paged buffer)
  animation layer    live dust cells (DUST_MASK shapes, rainbow-masked per frame) + in-flight collection particles
  HUD layer          speed, shaft, dust counter (TEXT buffer)
```

Stretch goal: anaglyph red/cyan mode — requires background/entity depth-plane
separation for parallax.

## Screens

Boot flow is `TITLE → GAME → REWIND → END`, then `END → GAME` on retry (no
return to the title). `HIGHSCORE` branches off `TITLE` and returns to it —
not part of that main chain. The game opens directly on `TITLE`; there's no
separate boot/loading screen. The title menu's first arming is a
click-through gate: `titleArmed` snapshots the keys held when the screen is
reached (e.g. backing out of `HIGHSCORE`) so a key still down doesn't
instantly fire whatever menu item the cursor sits on (the pointer path
self-consumes and needs no guard). `END` and `HIGHSCORE` have their own
equivalent gates (`endArmed`, `highscoreReady`; see Run end). Pressing Start
is also what unlocks the Web Audio context — browsers block
autoplay until a user gesture, and Start's key/tap press is the first one
that's guaranteed to happen (see Music & sound).

`TITLE` shows "Errands of Iris", Iris's speech bubble (see Premise) over the
dust-patched backdrop, the resting unicorn (offset left of its real spawn
point — see below), and a menu: **Start**, **Music: N%**, **Highscores**,
**New seed**, followed by a non-selectable `Seed: XXXXXXXX` line in the same
alignment/size as the rows above it (js13kgames runs entries in an iframe,
hiding the URL bar and the seed with it). Up/Down move the selection (a `>`
chevron in its own column so labels never shift), Enter triggers it; each
row also has a tap-friendly hit box for mobile. Selecting
Start hops the resting unicorn along a semicircular arc into its real
game-start pose (`titleJumpT`/`titleJumpPose`, eased) before handing off to
`GAME_SCREEN` — the "jump in" is deliberate, distinguishing a fresh run from
just idling on the title art.

`HIGHSCORE` shows the same dust/unicorn backdrop under a `Seed | Score | Date`
table (see Replayability) and doubles as a seed picker. **Back to main menu**
is appended as one more row below the table (`highscoreLayout()` treats it as
just another entry, a blank row's gap under the last score), so Up/Down wrap
through it the same as any chevron menu — Down off the last score lands on
it, Down again wraps to the first score. Enter/Space or a tap on a score row
loads that seed and drops back to `TITLE` on it, chevron reset to **Start**
(picking a seed is almost always followed by starting the run, so Start is
one press away instead of two); the same on the Back row just returns to
`TITLE`. Esc is a shortcut straight to `TITLE` from here too (see Controls).

## Music & sound

Peppy chiptune background music, via a [voxby](https://github.com/Rybar/voxby)
/ SoundBox player (`src/js/player.js`, zlib-licensed, ~1.4 KB gz). One track,
composed in the voxby tracker and exported as a data module
(`src/js/song-game.js`), playing under `GAME` + `REWIND` + `END`. `TITLE` is
silent — an earlier calmer title track was dropped for being too repetitive.
The track is rendered to a looping `AudioBuffer` once at load (`renderSong`,
~0.1 s) and started/stopped by `updateMusic()` whenever the screen crosses in
or out of that GAME/REWIND/END span. The context is suspended on pause /
tab-hide and resumed on unpause.
**M** (or the title menu's `Music: N%` item) steps the master gain — shared
by music and SFX alike — up by 10 points, wrapping from 50% back to 0%;
starts at 30% (`MASTER_VOLUME` in `sound.js`, tuned down from the GainNode's
implicit 100%, which played too loud). Works on every screen. The ZzFXM
helpers still in `sound.js` are now unused (flagged for the byte-golf pass).

Sound effects run through the same `zzfxG`/`zzfxP`/`zzfx` trio (ZzFX v1.3.2,
full 21-param generator, ported from
[ZzFXMicro.min.js](https://github.com/KilledByAPixel/ZzFX) so a sound
designed and exported from a current ZzFX tool — including its `tremolo`/
`filter` fields — plays back faithfully). `SFX_DIG` fires from `dig()` when a
dust cell is uncovered; `SFX_TALLY` fires from `updateParticles()` when a
dust particle lands and the counter ticks. `SFX_RAINBOW` — a low sine
climbing steadily higher, hand-tuned rather than exported — plays once per
run in `endGame()`, gated on `dust > 0` (no dust, no rainbow, no tone, same
condition `renderRainbow()` uses for "dry run!"); it's baked at a nominal
`SFX_RAINBOW_DURATION` and stretched via the source node's `.playbackRate` to
span however long the camera rewind + the rainbow's `RAINBOW_GROW` sweep
actually take that run (not fixed — `rewindSpeed` is clamped, so it scales
with the shaft's length). The drill stalling out doesn't get its own SFX —
considered, wired, then cut once the rainbow tone covered that beat.

## Replayability

The underground has its own dedicated seed, separate from every other use of
randomness in the game — it must not draw from the shared `utils.js` PRNG;
anything else needing randomness gets its own generator.

The seed is **one player-facing string**, riding a single URL param
(`?seed=XXXXXXXX`) — narrow enough to keep the `HIGHSCORE_SCREEN` table
(below) from clipping on mobile. `setMapSeed()` folds it (xfnv1a hash + a
small LCG, self-contained in `terrain.js`) and draws its first two outputs as
the terrain and dust uint32 constants mixed into `hash2D`, so one string is
enough to vary both fields independently:

| `?seed=` | resolves to |
|---|---|
| *(absent)* | `JS13K2026` — the themed default |
| `xyz` | `XYZ` (uppercased) |

`seedMap()` resolves this, calls `applySeed()` → `setMapSeed()`, and writes
the resolved string back to the URL so any run is a shareable link. (Seed 0 —
unreachable through `seedMap` — reproduces the original unseeded map.)

The title menu's **New seed** item rerolls a fresh random 8-char uppercase
seed (`randomSeed()`, A–Z, straight off `Math.random`) with no typing
required, re-seating and repainting the underground on it immediately so the
title backdrop never shows stale terrain.

Three fixed **preset seeds** — `JS13K2026`, `UNICORNS`, `RAINBOWS` (keeping
the theme joke reachable) — are bootstrapped into the highscore table on
first load if missing, so they're always offered from `HIGHSCORE_SCREEN`'s
seed picker even before anyone has played them, and are exempt from the
table's eviction cap (see Highscores below).

**Sharing.** END_SCREEN's **Share your score** menu item (`shareScore()`)
hands `share.js` a payload built from the run just finished: title, a text
line ("I dug a *N* meter long shaft and collected *M*g of rainbow dust in
Errands of Iris..."), and a `url` carrying the run's resolved seed — so the
link a friend opens drops them onto the same terrain/dust pair. Where the
platform supports the Web Share API's `files` array (checked via
`navigator.canShare({files})` on its own, per spec, before folding it into
the full payload), it also attaches a PNG snapshot of the current frame
(`c.toBlob()`) — the sky rainbow the player just grew. `share.js` falls back
to a Twitter-intent URL (text + url only, no image) when native sharing
isn't available.

**Highscores.** A per-seed table under the `2026.errands-of-iris.highscores`
storage key (`storage.js`, JSON-serialised), each entry `{ dust, shaft, date }`
keyed by its seed string — the raw run numbers, not a baked score, so a
future scoring-formula retune (`computeScore()`) re-scores every stored row
instead of leaving old entries stuck on whatever formula was live when they
were set. `endGame()` writes a new entry only when it beats what's on record
for that seed (compared via `computeScore()`), then caps the table at 10
entries by evicting the lowest-scoring non-preset seed(s) first — the three
preset seeds (above) are exempt from eviction, so the cap really bounds the
other `10 - 3` slots. Top-10, not a full history, so no scroll/paging UI is
needed. The title menu's **Highscores** item opens `HIGHSCORE_SCREEN` (see
Screens), which lists `Seed | Score | Date` sorted by score (computed on
read) and doubles as the seed picker described above.

**Deterministic spawn.** The drill starts buffer-centred (so the camera seats
on it at any viewport size) with `mapOffsetX` carrying its world position. A
bare buffer-centred spawn would land at world-x `CAMERA_WIDTH` — which moves
with the window and could sit inside a rock — so `pickSpawnX()` walks right
from world-x 0 in ~drill-width steps until the column the drill will cut is
clay-free, and `mapOffsetX` is set to put the drill there. `seatSpawn()`
applies this same seating to the boot title backdrop, so the TITLE → GAME
transition shows one continuous frame.

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
`utils.js`'s stateful PRNG). The run's two seeds (terrain, dust — both derived
from the one player-facing seed string, see Replayability) are folded into
`hash2D` — as fixed-at-boot constants, so it stays a pure function of `(x,y)`
within a run. Two passes:

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
  `worldX + '_' + undergroundY`, both `CELL_SIZE`-aligned. Coordinates are
  invariant world/underground space — world-x = `bufferX + mapOffsetX`,
  underground-y = `bufferY - SURFACE_Y + mapOffset` — not buffer space, so a
  cell keeps its identity after the buffer pages away and back on either
  axis. `worldX` goes negative once the drill roams left of its start.
  Naturally bounded by how far the unicorn travels before momentum runs out;
  no eviction logic for a jam-length session.
- **MAP buffer**: an offscreen canvas 2× the viewport each way (scroll
  lookahead on both axes). It is *not* rebuilt from `sampleMaterial()` each
  frame — it's paged: `scrollMap()` self-blits the existing pixels by the
  scroll delta, then `paintRow()` (dy page) / `paintCol()` (dx page)
  repaints only the newly-exposed `CELL_SIZE` strip via `paintCell()` (sky
  above `SURFACE_Y`, else `DUG.has(cell)` ? tunnel : material colour). The
  2× size is the lookahead margin that lets paging happen in occasional
  jumps, not every frame. Only the camera slice of the buffer is copied to
  the backbuffer per frame (`clearBuffer()`), not the whole thing.
  Dust is **not** in this buffer — its colour comes from a drifting rainbow
  sampled per frame, so a baked colour would freeze per row as it pages.
- **DUST_MASK buffer**: same size and paging as `MAP`, holds only dust-cell
  shapes (opaque white on transparent). `scrollMap()` self-blits it (with
  `'copy'`, so transparent pixels overwrite cleanly) alongside `MAP`;
  `paintRow()`/`paintCol()` stamp its strip. Recoloured per frame on the
  animation layer — never baked.
- Drilling: `digShaft()` stamps a fixed-radius circle of cells each tick;
  `dig()` adds each new cell to `DUG` **and** immediately punches a hole in
  the MAP buffer (and clears the same cell from `DUST_MASK`), so a cell stays
  carved when you scroll away and back. The once-per-cell `if (!DUG.has(key))`
  guard in `dig()` is where dust collection hooks in: if the new cell is in
  the dust field, top up momentum (if DENSE) and spawn its fly-to-HUD
  particle — the particle itself bumps the counter once it lands.

## Open questions

- Camera tracking: RESOLVED — spring + projected focus off a lagged velocity,
  see "Graphics — Camera tracking" above. Constants are still playtest bait.
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
