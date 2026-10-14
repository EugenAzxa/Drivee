# Drivee

A modern driving app built to connect drivers and passengers seamlessly.

## About

Drivee is a new app currently under development.

## Getting Started

More details will be added as the project grows.

## Intro video

The homepage opens with a 5-second clip on every load: a Toronto parking
officer holds up a ticket and points at a No Stopping sign, the camera pushes
into the ticket, and it lands on the Drivee app showing "Dispute won". It
ends on the last frame of the hero video (`parking-ticket-2.mp4`), so the page
picks up exactly where the clip stops, and the headline and buttons rise in.

- `assets/intro/intro-16x9.mp4` for laptops, `intro-9x16.mp4` for phones
  (chosen by screen shape), with `poster-*.jpg` stills
- made with Kling 3.0 at 1080p on Higgsfield, from `start-*.png` (the
  officer, generated with GPT Image 2.5) to `end-*.png` (the hero video's
  final frame); the raw downloads, `raw-*.mp4`, are kept out of git
- skipped for deep links (`/#scan`), `?app`, reduced motion and data saver;
  a Skip button and a 9-second cap mean it never holds the page
- holding the hero on its last frame needs range requests, which Vercel
  serves; `_dev-server.js` doesn't, so locally the hero just keeps playing
