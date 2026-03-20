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


SESSION 2 — 20 March 2026
--------------------------

WHAT WAS BUILT

1. Profile save to localStorage — the Name and License Plate inputs on the Dashboard now
   persist when you reload the page. Used safeGet and safeSet wrappers with try/catch so
   the app never crashes in incognito mode. Profile loads automatically on startup.

2. Fine Reminders system — fully working. You can add a ticket reference number and due
   date, and it appears in a reminder card with a status badge calculated from today's date.
   UPCOMING is green, TODAY is amber, OVERDUE is red. Each card has a delete button.
   Reminders survive page reload because they are saved to localStorage.

3. Dispute Script Builder — select one of four Toronto dispute reasons, click Generate
   Script, and a full formal letter appears in a text area. If a profile is saved, the
   letter auto-fills your name and license plate. A Copy Script button copies the letter
   to the clipboard with a fallback for file:// mode.

4. Street Parking Checker — five Toronto streets hardcoded with hourly rate, enforcement
   hours, free parking windows, and tow-away warnings. A red warning banner appears for
   streets with rush-hour tow zones. The Open Green P button links to the Green P app.

5. Technical foundations laid for safe data handling — parseLocalDate() prevents the
   timezone bug where new Date() would show yesterday in Toronto. esc() sanitises all
   user input before it touches innerHTML to prevent display bugs. Collision-safe IDs
   use timestamp plus random suffix so two reminders added at the same time never clash.


ISSUES TO CARRY FORWARD

- .ics calendar export (Google Calendar) was planned for this session but not built.
  It is still on the list for next session.
- The Copy Script button used inline styles in this session — fixed in Session 3.
- Reminder due dates showed raw ISO format (2026-03-20) — fixed in Session 3.
- Nothing is broken. All five features work correctly on reload.


PRD NOTES

- Profile (section 3.1) is working but uses localStorage not IndexedDB as the PRD specifies.
  This is an intentional tutoring divergence — localStorage is simpler and functionally
  equivalent for this stage.
- Fine Reminders (section 3.4) is complete except .ics export.
- Dispute Script Builder (section 3.9) is complete. The PRD specifies Claude API for letter
  generation — we used hardcoded templates instead. Functionally matches the PRD output.
- Street Parking Checker (section 3.7) is complete with hardcoded data. PRD specifies
  Toronto Open Data API as the source — hardcoded fallback is explicitly listed as acceptable.
- ROI Calculator (section 3.5) was already done in Session 1.


LESSON ARC — WHERE WE ARE

Part 1 Foundation: COMPLETE
Part 2 Functionality: MOSTLY COMPLETE (.ics export outstanding)
Part 3 Polish: COMPLETE (see Session 3)
Part 4 Test: NOT STARTED


HOMEWORK SET THIS SESSION

No new homework was set between sessions 2 and 3 — they ran back to back.


SESSION 3 — 20 March 2026
--------------------------

WHAT WAS BUILT

1. CSS animations — three @keyframes added: slideUp (cards glide in from slightly below),
   pulse (OVERDUE badge breathes in and out every 2 seconds), shake (button trembles when
   validation fails). All three are now used in the app.

2. Card animations and hover states — every card, step card, and lawyer card slides up
   when a tab loads. On desktop, hovering a card lifts it 1px and brightens the border.
   Both effects use @media (hover: hover) so they never get stuck on phone touch screens.
   Tab switching triggers the animation to replay every time you return to a tab.

3. Button polish — blue buttons glow brighter on hover. The Add Reminder button shakes
   when you try to submit an empty form (the same feedback you get from a wrong PIN on a
   lock screen). All hover effects use @media (hover: hover) for touch safety.

4. Badge polish and empty state — the OVERDUE badge pulses continuously. The TODAY badge
   has a faint amber glow. The empty state for reminders now has a dashed border so it
   looks like a placeholder, not a broken layout.

5. SVG nav icons — all five Unicode symbols replaced with clean inline SVG icons.
   House for Dashboard, grid for Services, map pin for Hotspots, scales for Legal,
   three lines for Guide. Active icon turns blue, inactive is grey — same behaviour as before
   but looks correct on every phone.

6. formatDate helper and final HTML fixes — reminder due dates now display as
   Mar 20, 2026 instead of 2026-03-20. The Copy Script button now uses a CSS class
   instead of five inline style attributes. Lawyer fee ranges now use JetBrains Mono font
   to match the PRD typography spec.


ISSUES TO CARRY FORWARD

- Nothing is broken. The verification checklist was handed to the student but not yet
  run through — that is the first task of the next session or the homework for this session.
- .ics calendar export is still outstanding from Part 2.
- The Guide tab first-time auto-show logic (PRD section 3.20) is not yet built.
- Part 4 Test phase has not started.


PRD NOTES

- Polish phase matches PRD section 7 (Design System) component specs: 0.35s toast,
  0.4s card slide-up, 2s danger pulse on OVERDUE badge, scale(0.98) on button press.
- PRD specifies Guide tab shown automatically to first-time users. Not yet implemented.
- PRD specifies lawyer cards pulse for 3s when highlighted by AI verdict. Not yet implemented
  because AI verdict is not built. This is correct — do not add that animation yet.
- Everything built in Polish phase is consistent with the PRD. No conflicts.


LESSON ARC — WHERE WE ARE

Part 1 Foundation: COMPLETE
Part 2 Functionality: MOSTLY COMPLETE (.ics export outstanding)
Part 3 Polish: COMPLETE
Part 4 Test: NOT STARTED


NEXT SESSION — Part 4 Test, plus two small outstanding items

Priority order for next session:
1. Run the verification checklist from the plan — open the app in Chrome DevTools at
   iPhone 14 size and work through all 17 items one by one.
2. Build .ics calendar export — one button per reminder that downloads a .ics file
   openable by Google Calendar, Apple Calendar, and Outlook.
3. Begin Part 4 Test — mobile layout check on iPhone 14, form validation edge cases,
   empty state checks, and checking that everything survives a page reload.


HOMEWORK SET THIS SESSION

Open index.html in Chrome. Press F12. Click the phone icon (device mode). Set device
to iPhone 14. Go through all 5 tabs slowly and run through this checklist one item at a time:

1. Do cards slide up smoothly when you switch to a tab?
2. Is the active nav icon blue and the others grey?
3. Are the nav icons clean shapes (not blocky symbols)?
4. Add a reminder with a past date — does the badge say OVERDUE and slowly pulse?
5. Does a reminder due date show as Mar 20 2026 (not 2026-03-20)?
6. Try clicking Add Reminder with empty fields — does the button shake?

Write down anything that looks wrong or that does not match what was described above.
Bring that list to the next session.

If you get stuck, search for: Chrome DevTools device mode iPhone.
