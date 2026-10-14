# Drivee

A modern driving app built to connect drivers and passengers seamlessly.

## About

Drivee is a new app currently under development.

## Getting Started

More details will be added as the project grows.

## Sky opening

The homepage opens on a painted sky: "Drivee" rises in, "Scan, pay, dispute -
in seconds." follows underneath, and penalty-notice tickets blow in and drift.
Scrolling scatters the tickets, lifts the title away and sinks the sky into the
white hero, which rises into view. The top menu stays hidden until then.

- `assets/sky/sky-wide.webp` (laptops) and `sky-tall.webp` (phones, chosen by
  aspect ratio), `ticket.webp` (transparent); full-size PNGs in
  `design-sources/sky/`. Made with GPT Image 2.5 on Higgsfield from the brand
  sky artwork, with the text removed so the title is live HTML.
- The ticket is fictional: no real plate, officer or ticket number.
- GSAP + ScrollTrigger (already loaded for the late-fee section). Without
  them, or with reduced motion, it is a still scene with the same text.
