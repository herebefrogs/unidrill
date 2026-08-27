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
- [ ] Add the digging overlay (track which pixels have been dug). Temporary
      control: always digs a straight vertical shaft — just enough to prove
      backtracking doesn't lose dug-location history.
- [ ] Start tracking player velocity and angle: switch to real controls
      (left/right banks the drill left/right, applied to angle).
- [ ] Handle colliding with the vertical edges of the map.
- [ ] Momentum / entropy / material drag.
- [ ] Rainbow dust.
- [ ] Camera window tracking (smoothing/lookahead — see DESIGN.md's open
      question on camera tracking).

## Later / revisit

- [ ] Depth is currently displayed in raw pixels. Should be in meters, but we
      don't know the px-per-meter ratio until map/viewport sizing is
      finalized. Revisit once that's locked in.
- [ ] Brainstorm whimsical game names that avoid "unicorn" and "rainbow" —
      most other entries will lean on those words, want something that
      stands out. "UniDrill Corp" is just the working title for now.
- [ ] Create the title screen (currently skipped: boots straight into
      GAME_SCREEN, see game.js).
