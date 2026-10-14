---
format: 1080x1920
duration: 30s
message: "Got a Toronto ticket? Drivee tells you in seconds whether to pay or fight it, and who can help."
arc: Demo Loop — question → product intro → demo (read) → demo (answer) → stakes → help → CTA
audience: Toronto and Ontario drivers who just got a parking or traffic ticket
mode: autonomous
music: none
---

<!--
Plain, calm, light. Every number on screen is real (City of Toronto published
fee schedule, as on drivee.ca). The ticket and the app screens are rebuilt in
HTML rather than taken from captured screenshots, because the captured images
carry other amounts ($75 illustration, $45 App Store shot) that would
contradict the $30 → $109.59 story. The ticket is fictional: no real plate,
officer or ticket number.
-->

## Video direction

- **palette system** (from frame.md): canvas white / cool paper #EEF2FB for full-bleed grounds; ink #0B1430 for display + body type; Drivee blue (frame.md accent) for the app, buttons, progress and the D mark; ticket yellow #F6E27A (a prop colour, only for the paper ticket); state colours only where they mean something: green #15803D for "free / good", amber #E89B22 for "worth disputing", red #C8372D for "late fees". One accent per frame.
- **type**: display role for every headline (Plus Jakarta Sans 800, sentence case, tight); body role for UI text; tabular figures on every amount and day count. Headlines are big enough to read on a phone at a glance.
- **the phone**: one reconstructed phone (white device, rounded, Drivee app UI in light theme) is the recurring stage from Frame 2 to Frame 6, same size and position wherever it continues, so the film reads as one continuous demo.
- **motion grammar + reveal model**: smooth long-tail settles (power3; expo.out on fast arrivals); never bouncy, never elastic. Each piece appears when the voiceover names it; at t=0 only what the VO is saying enters, the rest waits for its cue in the back half. Holds are still; the only aliveness is a subtle, finite, low-amplitude jitter.
- **rhythm / held frames**: Frames 1, 3 and 5 are the busiest reveals; Frame 4 lands its answer and HOLDS (the breather before the stakes); Frame 7 settles to a dead-still end card held to the last frame.
- **negative list**: no gradient text, no glow-pulsing buttons, no floating bokeh or purple-blue "AI" gradients, no numbered mono labels, no sparkle/magic icons, no fake stats or testimonials, no real plates / names / ticket numbers; no lazy breathing, no slow back-half pans or pushes; neither failure mode: slideshow (front-load then freeze) or screensaver (many things floating independently).
- **caption band**: content lives in the top ~83%; the bottom ~17% stays clear for the caption pill.

## Frame 1 — Before you pay it

- scene: A yellow Toronto parking ticket slides under a wiper onto the frame; the question appears above it
- voiceover: "Got a parking ticket in Toronto? Before you pay it, check it."
- duration: 3.797s
- poster: 2.5s
- transition_in: cut
- status: animated
- src: compositions/frames/01-before-you-pay.html
- type: hook
- persuasion: Pain validation (direct address)
- beat: tension
- asset_candidates:
- blueprint: kinetic-type-beats (Adapt)
- focal: reconstructed yellow parking ticket (HTML/CSS prop)
- roles: ticket = cutout · headline = supporting · paper ground = background

Adapt: keep the statement build onto a payoff; the payoff is a real object (the ticket), not a logo.
Scene 1 (0.0–1.6s): cool-paper ground; as the VO asks "Got a parking ticket in Toronto?", the headline "Got a parking ticket?" reveals per word (dynamic-content-sequencing) in the upper third, centered, display role, very large.
Scene 2 (1.6–2.6s): a yellow "PARKING INFRACTION NOTICE · City of Toronto" ticket slides up from below and settles at a slight tilt mid-frame (power3 long-tail settle). Fictional details only: charge "No standing", amount "$30.00", plate "DRIVEE 1". ~55% of frame width; 3 layers (ground, ticket, soft contact shadow).
Scene 3 (2.6–end): on "Before you pay it, check it", a second line "Before you pay it, check it." reveals under the headline in ink; the word "check" gets a blue marker underline sweep (css-marker-patterns). Hold still.

narrativeRole: meet the viewer at the exact moment they're in — holding a ticket — and stop the reflex to just pay it.
keyMessage: don't pay a ticket before you know what it really is.

## Frame 2 — Snap a photo

- scene: The ticket moves into a phone running Drivee; a camera viewfinder frames it and the shutter fires
- voiceover: "Open Drivee, and snap a photo of it."
- duration: 2.709s
- poster: 2.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/02-snap-a-photo.html
- type: product_intro
- persuasion: Friction reduction (one action)
- beat: ease
- asset_candidates: assets/favicon.svg — Drivee D mark for the app header
- blueprint: device-surface-showcase (Adapt)
- focal: reconstructed phone running the Drivee app
- roles: assets/favicon.svg = supporting (app header mark) · ticket = cutout

Adapt: keep the held-device hero; one cursorless action (the shutter) instead of a multi-screen tour.
Scene 1 (0.0–1.2s): the phone rises into center (≈60% of frame height, inside the top 83%) as the VO says "Open Drivee"; its screen shows the Drivee header (D mark + "Drivee") and a camera viewfinder with four blue corner brackets.
Scene 2 (1.2–2.1s): on "snap a photo", the yellow ticket (same design as Frame 1) settles inside the viewfinder; the brackets tighten onto it.
Scene 3 (2.1–end): shutter: one white flash on the screen, the round shutter button compresses and recovers (press-release-spring); a small "Reading…" chip appears under the ticket. Hold.

narrativeRole: introduce the product as the single, easy action that answers the hook.
keyMessage: one photo is all it takes.

## Frame 3 — It reads the ticket

- scene: Inside the phone, three fields fill in one by one as the VO names them — Charge: No Standing; Amount: $30.00; Respond by: 15 days
- voiceover: "In seconds, it reads the charge, the amount, and the deadline."
- duration: 3.691s
- poster: 3.8s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-reads-the-ticket.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: clarity
- asset_candidates:
- blueprint: agent-progress-theater (Adapt)
- focal: the phone result screen
- roles: ticket thumbnail = supporting · three result rows = cutout

Adapt: keep the working-state theater resolving into a checklist; the checklist is three read fields, each landing on its spoken word.
Scene 1 (0.0–1.0s): same phone, same position; screen shows a small ticket thumbnail at the top with a thin blue scan line passing down it once, status text "Reading your ticket" (VO: "In seconds").
Scene 2 (1.0–1.9s): on "the charge", row 1 reveals with a green check: Charge: No standing.
Scene 3 (1.9–2.7s): on "the amount", row 2 reveals: Amount: $30.00 (tabular, large).
Scene 4 (2.7–end): on "and the deadline", row 3 reveals: Respond within: 15 days, with a small amber clock dot; the status text swaps to "Done". Hold still.

narrativeRole: prove the product does the tedious reading for you — each field lands on its spoken word.
keyMessage: Drivee reads the ticket for you.

## Frame 4 — Pay it, or fight it

- scene: An answer card rises on the phone: a plain-English verdict with two clear options, PAY IT and FIGHT IT, the right one highlighted
- voiceover: "Then it tells you, in plain English: pay it, or fight it."
- duration: 3.435s
- poster: 3.6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-pay-or-fight.html
- type: benefit_highlight
- persuasion: Feature-to-benefit translation
- beat: relief + control
- asset_candidates:
- blueprint: kinetic-type-beats (Adapt)
- focal: the answer card on the phone
- roles: answer card = cutout · two option chips = supporting

Adapt: keep the in-place token swap as the signature: the card's question line hard-cuts "Pay it?" → "Fight it?" on the spoken words, then resolves to the verdict.
Scene 1 (0.0–1.4s): the phone screen slides to an answer card (same phone, same position); above the phone, in the upper third, "In plain English" reveals (VO: "Then it tells you, in plain English").
Scene 2 (1.4–2.6s): on "pay it, or fight it", two large option chips reveal side by side in the card, "Pay it" (outline) and "Fight it" (filled blue), while the question line swaps "Pay it?" → "Fight it?" on each spoken word (discrete-text-sequence).
Scene 3 (2.6–end): the verdict resolves: an amber label "Worth disputing" and one plain sentence "Good odds at a screening review." "Fight it" stays highlighted. HELD breather: still.

narrativeRole: land the promise — the decision is made simple. This is the message, by beat 4 of the demo loop.
keyMessage: a clear answer, not legal jargon.

## Frame 5 — Waiting costs money

- scene: A day counter runs 1 → 60 while the amount climbs $30.00 → $45.39 → $77.49 → $109.59 and turns red; each fee label pops as it lands
- voiceover: "Wait too long, and a thirty dollar ticket becomes a hundred and nine."
- duration: 4.331s
- poster: 4.4s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/05-waiting-costs.html
- type: pain_point
- persuasion: Scarcity/urgency (real fee ladder)
- beat: urgency
- asset_candidates:
- blueprint: dataviz-countup (Adapt)
- focal: the amount counter
- roles: amount = cutout · day counter + progress bar = supporting · fee labels = supporting

Adapt: keep the push-THROUGH signature into the instrument; one instrument (amount + day bar), not a grid. Numbers are the City of Toronto published schedule, exact.
Scene 1 (0.0–1.0s): the zoom-through lands on a white instrument card centered (≈80% width): "Day 1" small, "$30.00" huge in ink, an empty thin progress bar (VO: "Wait too long").
Scene 2 (1.0–3.2s): on "a thirty dollar ticket becomes", the day counts 1 → 60 while the bar fills; the amount steps at each threshold: Day 16 $45.39 (+$15.39 address search fee), Day 31 $77.49 (+$32.10 late payment fee), Day 60 $109.59 (+$32.10, plate denial). Each fee label pops in beside the bar as it lands (counting-dynamic-scale, stat-bars-and-fills). Amount and bar turn red from Day 31.
Scene 3 (3.2–end): on "a hundred and nine", "$109.59" holds large in red; under it a small source line "City of Toronto fee schedule". Hold still.

narrativeRole: raise the stakes with the real City of Toronto fee schedule, so acting now feels obvious.
keyMessage: the same ticket gets more expensive every few weeks.

## Frame 6 — Help if it's worth fighting

- scene: A lawyer match card slides up: "Licensed Ontario paralegal" with a green "Free case review" pill and "No commission"
- voiceover: "Worth fighting? Get matched with a licensed Ontario paralegal. Your first case review is free."
- duration: 6.528s
- poster: 4.6s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/06-matched.html
- type: feature_showcase
- persuasion: Risk reversal (free review)
- beat: trust
- asset_candidates:
- blueprint: titlecard-reveal (Adapt)
- focal: the lawyer match card
- roles: match card = cutout · free pill = supporting

Adapt: keep the one restrained move (slide-up crossfade) then a still hold; a calm card, not a demo.
Scene 1 (0.0–1.0s): the phone again (same position); headline in the upper third "Worth fighting?" reveals (VO: "Worth fighting?").
Scene 2 (1.0–3.8s): on "Get matched with a licensed Ontario paralegal", a match card slides up in the phone screen: a round initial avatar, title "Licensed Ontario paralegal", line "Handles: No standing", and a blue button "Request free review".
Scene 3 (3.8–end): on "Your first case review is free", a green pill "Free case review" and a quiet line "No commission" reveal on the card; the button presses once (press-release-spring). Hold.

narrativeRole: answer "and then what?" — real help, at no cost to start.
keyMessage: if it's worth fighting, a licensed pro can take it, and the first look is free.

## Frame 7 — Get Drivee

- scene: The blue D mark draws in, "Drivee" and the line "Scan, pay, dispute — in seconds." settle beneath, then App Store / Google Play and drivee.ca
- voiceover: "Drivee. Free on iPhone and Android."
- duration: 2.56s
- poster: 3.4s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-get-drivee.html
- type: cta
- persuasion: Friction reduction (free, both platforms)
- beat: motivation
- asset_candidates: assets/favicon.svg — Drivee D mark, bold blue D on white; assets/badge-app-store.svg — official Download on the App Store badge (as on drivee.ca); assets/badge-google-play.svg — official Get it on Google Play badge (as on drivee.ca)
- blueprint: logo-assemble-lockup (Adapt)
- focal: assets/favicon.svg
- roles: assets/favicon.svg = cutout · assets/badge-app-store.svg = supporting · assets/badge-google-play.svg = supporting

Adapt: the Brand_Outro / settled-reveal variant: static frame, element-level motion only; no motion-blur push (that is the template look the site just removed).
Scene 1 (0.0–0.9s): the phone clears; on a white ground the blue D mark draws in at center-upper (svg-path-draw outline, then fill), large (≈30% width). VO: "Drivee."
Scene 2 (0.9–1.8s): "Drivee" (display, ink) reveals under the mark, then "Scan, pay, dispute — in seconds." in body role.
Scene 3 (1.8–end): on "Free on iPhone and Android", the App Store and Google Play badges (black, standard artwork) reveal side by side, with "drivee.ca" beneath in Drivee blue. Dead-still end card held to the last frame.

narrativeRole: close on the brand and the one next step.
keyMessage: get Drivee — free.
