DRIVEE — SESSION NOTES
======================


SESSION 1 — 19 March 2026
--------------------------

WHAT WAS BUILT

1. index.html created from scratch — the entire app lives in one file as planned.
   This did not exist before this session.

2. Full design system applied — all 14 colour tokens from the PRD set as CSS variables
   at :root. Fonts, spacing, reset, and base styles all in place. Changing one variable
   updates the whole app.

3. 5-tab navigation shell — Dashboard, Services, Hotspots, Legal, Guide tabs all
   switchable. Tab switching uses CSS classes, not inline display styles, so it is safe
   for flex/grid layouts. Nav bar is fixed to the bottom with frosted glass effect and
   correct iPhone safe-area insets.

4. All 5 tabs have placeholder content — every tab has headings, cards, inputs,
   empty states, and placeholder buttons so the app looks real even though nothing is
   wired up yet. Legal tab has 3 hardcoded lawyer cards. Guide tab has all 8 steps,
   3 quick tips, and a working Get Started button.

5. Leaflet map renders in Hotspots tab — loaded via CDN, CartoDB Dark Matter tiles,
   centred on Toronto. Has a try/catch fallback so if the CDN fails the user sees a
   friendly message instead of a broken grey box.

6. ROI Fee Escalation Calculator is fully working — this jumped ahead of the plan
   into Part 2 territory. Live calculation as you type. Exact Toronto fee schedule
   hardcoded: Day 16 plus $15.39, Day 31 plus $32.10, Day 60 plus $32.10.
   Shows fee breakdown rows, timeline bar (green to red), bold red total,
   and green savings callout. Dollar-sign prefix input with no spinner arrows.
   Scroll padding fixed so the output is not hidden behind the nav bar.


ISSUES TO CARRY FORWARD

- Nothing is broken. The foundation is solid.
- Tab icons are plain Unicode symbols. They work but are not as polished as the
  reference app. SVG icons are planned for Part 3 Polish — do not change them yet.
- The Leaflet map renders but has no heatmap layer, bike lane layer, or hydrant layer.
  Those are Part 2 tasks.
- All buttons except the ROI calculator are placeholder only — they show but do nothing.
  That is intentional for Foundation phase.


PRD NOTES

- The ROI calculator (section 3.5 in PRD) is now complete and functional — this is
  ahead of schedule. No conflict with PRD. It matches the fee schedule exactly.
- Everything else built today is Foundation phase only, as planned in Part 1 of the
  build plan.
- PRD specifies React plus Vite plus TypeScript. We are building in vanilla HTML/CSS/JS
  per the tutoring rules. This is a known divergence and is intentional.
- PRD may need a note added to reflect that the ROI calculator is done.


LESSON ARC — WHERE WE ARE

Part 1 Foundation: COMPLETE
Part 2 Functionality: NOT STARTED (next sessions)
Part 3 Polish: NOT STARTED
Part 4 Test: NOT STARTED


NEXT SESSION — Part 2 Functionality, starting with Dashboard

Priority order for next session:
1. Profile save — wire up the Name and License Plate inputs to localStorage so they
   persist when the page is reloaded.
2. Fine Reminders system — add a ticket, show status badges (Upcoming / Today / Overdue)
   calculated from the due date, delete button per reminder.
3. Google Calendar export — .ics file download from a reminder card.

These three features are self-contained, beginner-friendly, and do not require any
external APIs. They are the right place to start Part 2.


HOMEWORK SET THIS SESSION

Open index.html in Chrome. Press F12 to open DevTools. Click the phone icon in the
top-left corner of DevTools to turn on device mode. Set the device dropdown to
iPhone 14. Now slowly scroll through all 5 tabs one by one. Write down anything that
looks squished, cut off, too small, or out of place. Bring that list to the next session.

This should take 15 to 20 minutes. If you get stuck finding the device mode button,
search for: Chrome DevTools mobile simulation.
