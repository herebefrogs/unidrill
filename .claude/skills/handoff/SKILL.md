---
name: handoff
description: "Write a paper trail for the next session before /clear or /compact wipes context. Distills what this session learned into CLAUDE.md's Orientation section, memories, TODO.md, and DESIGN.md, then commits. Invoke at the end of a TODO item or whenever the user is about to clear."
---

# Handoff

The next session starts cold. Its only inputs are: `CLAUDE.md` (auto-loaded),
`MEMORY.md` (auto-loaded index), `DESIGN.md` / `TODO.md` (read on request),
recalled memory files, and `git log`. Everything you figured out this session
that isn't in one of those is lost on `/clear`. This skill moves it there.

## Steps

1. **Survey the session.** `git --no-pager log --oneline` since the session
   started, `git --no-pager diff` for anything uncommitted, and recall what
   you learned that isn't yet written down — architecture facts, gotchas,
   dead ends, decisions, user preferences.

2. **`CLAUDE.md` → Orientation section.** Update it so a cold session ramps
   without re-exploring. Add/adjust:
   - the file map, if files were added, gutted, or changed role;
   - the "Concepts that bite" list, if you hit a non-obvious trap
     (coordinate spaces, buffer/state lifecycles, ordering constraints,
     build quirks) that cost you time this session;
   - remove anything now stale.
   Keep it terse — it's a map, not a manual. Don't duplicate `DESIGN.md`.

3. **Memories.** For anything durable and not codebase-derivable:
   - `feedback` — the user corrected how you work, or confirmed an approach
     (include the why);
   - `project` — a decision or constraint not visible in the code;
   - `reference` — an external resource worth keeping.
   Update the matching existing file rather than duplicating; add the
   one-line pointer to `MEMORY.md`. Skip anything the repo already records.

4. **`TODO.md`.** Tick finished items. Add bugs/scope discovered. If an item
   is half-done, leave a sub-bullet with the concrete next step and which
   files are mid-edit — not "continue where I left off".

5. **`DESIGN.md`.** Per `CLAUDE.md`: if what got built contradicts it, edit
   the doc to describe the current design. No changelog notes.

6. **Commit** the doc/memory changes (memories are outside the repo — just
   save them). Use a `handoff:` or feature-scoped commit message.

7. **Report** a short bullet list of what you recorded and where, so the
   user can `/clear` knowing nothing was dropped. Flag any half-done work
   explicitly.

## When to run

- The user asks (`/handoff`, "update the handoff", "I'm about to clear").
- Proactively offer it when a TODO item wraps — that's the natural
  checkpoint, whether or not a clear is imminent.
