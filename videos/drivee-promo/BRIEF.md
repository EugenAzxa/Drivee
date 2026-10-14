---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Got a Toronto ticket? Drivee tells you in seconds whether to pay or fight it, and who can help."
destination: website-embed
aspect: 1080x1920
language: en
audience: Toronto and Ontario drivers who just got a parking or traffic ticket
length: 30s
angle: problem-to-payoff walkthrough
vo_mode: restructured
---

## Intent

The video that plays in the "See it in action" phone frame on the drivee.ca
homepage, replacing the old trailer. In the user's words: "a new video for
this segment about our product … animated, English and easy to understand",
made "through Claude, not through Higgsfield" — HTML animation only, no AI
video generation.

Story: a Toronto parking ticket on the windshield → snap a photo in Drivee →
it reads the charge, the amount and the deadline → a plain-English answer
(pay it or fight it) → the real cost of waiting on a $30 Toronto ticket →
matched licensed Ontario paralegals and lawyers with a free case review →
get the Drivee Canada app.

## Assets

- ../../favicon.svg — the Drivee mark (bold blue D on white); the closing lockup.
- ../../assets/img/store/ — App Store / Google Play badge artwork lives on the
  homepage (index.html, #app section) if the close needs badges.

## Customizations

- Voice-over plus large on-screen captions, so it works with or without sound.
- Voice: local Kokoro (offline; HeyGen not signed in). Music: none (local
  MusicGen needs PyTorch; skipped by the user's offline choice).

## Notes

- Facts that may appear, all from drivee.ca / the City of Toronto published
  fee schedule: $30.00 days 1–15; $45.39 day 16 (address search fee
  +$15.39); $77.49 day 31 (late payment fee +$32.10); $109.59 day 60 (plate
  denial, +$32.10). Respond within 15 days.
- The scanner's real answers: "Act now", "Get representation", "Worth
  disputing", "Probably just pay". Partner firm: Bajwa Law Firm; free first
  consultation; Drivee takes no commission.
- No invented stats, testimonials, success rates or "AI magic" claims. No real
  plates, names or ticket numbers (use clearly fictional ones).
- Keep it calm and plain — the site was just cleaned of AI-template looks
  (gradient text, glowing buttons, numbered mono labels). Light design.
- Brand: Plus Jakarta Sans; ink #0B1430; blue #1F50D8; amber #E89B22;
  red #C8372D; green #15803D; page white / #EEF2FB.
- Deliver MP4 + poster JPG into ../../assets/video/. Don't git-commit from
  the workflow; the parent session wires and commits.
