 ## Communication style

 - Prefer diagrams over prose whenever the subject has structure: tree/parent-child
   relations, call chains, state transitions, before/after comparisons, or data flow
   between actors.
 - Use ASCII diagrams, Mermaid, or tables for these cases instead of describing
   relationships in paragraph form.
 - Draw the diagram first, then add only the prose needed to explain what the
   diagram can't carry (rationale, caveats, tradeoffs) — don't restate the
   structure in words.

## Coding style

 - When in doubt about whether an unusual pattern in this codebase is a
   mistake or intentional (e.g. for build/minification reasons), ask before
   changing it.

## Game design

 - When in doubt about a game design direction or choice (mechanics, controls,
   feel, scope of a TODO item), ask a clarifying question before implementing
   rather than guessing — saves both of us time and avoids disappointment.
   Only raise the big/consequential calls this way; don't ask about trivial
   details (constants, naming, minor tuning) that are cheap to adjust after.

## Game engine

 - `src/js/inputs/`'s only responsibility is to record the latest raw input
   (key/pointer state, timestamps) as it arrives on the browser event thread.
   It must never apply that input to game state — no reading/writing `hero`,
   no gameplay logic, nothing heavier than storing a value. Event listeners
   run on the main/UI thread; any real work done there risks blocking it.
 - Applying recorded input to game state is `processInputs()`'s job, called
   from `update()` inside the `requestAnimationFrame` loop, never from an
   input event handler directly.
