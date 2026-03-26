# Dasrat — WiFi Speed Test

A production-ready, client-side WiFi speed test application. No server required. Measures download speed, upload speed, and latency using the public Cloudflare Speed Test CDN.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Technical Architecture](#technical-architecture)
4. [How the Speed Test Works](#how-the-speed-test-works)
5. [File Structure](#file-structure)
6. [Getting Started](#getting-started)
7. [Configuration](#configuration)
8. [Browser Compatibility](#browser-compatibility)
9. [Performance Notes](#performance-notes)
10. [Privacy](#privacy)
11. [Contributing](#contributing)
12. [License](#license)

---

## Overview

Dasrat is a single-file HTML speed test application inspired by the UX of fast.com. It auto-starts on page load, displays a smoothly animated speed number that climbs gradually to the measured value, and presents download speed, upload speed, and latency in a clean, professional interface.

The application requires no backend, no build step, and no dependencies beyond a Google Fonts stylesheet and the public Cloudflare Speed Test API.

---

## Features

- **Auto-start on load** — the test begins automatically after a short page-load delay, just like fast.com
- **Smooth animated number display** — speed climbs gradually using an eased countup animation rather than jumping to instant values
- **Speed stabilisation badge** — a "Speed Stabilised" indicator appears once readings become consistent
- **Dark mode** — a persistent light/dark toggle stored in `localStorage`
- **Three measurements** — download Mbps, upload Mbps, and round-trip latency in milliseconds
- **Top-of-page progress bar** — a thin red progress indicator tracks each test phase
- **Pause and restart** — the action button pauses a running test or restarts after completion
- **Zero dependencies** — no JavaScript frameworks, no bundler, no npm
- **Accessible** — ARIA labels, live regions, and focus-visible outlines throughout
- **Responsive** — scales cleanly from desktop down to 320 px wide viewports

---

## Technical Architecture

The JavaScript is split into four self-contained modules, each implemented as an IIFE (Immediately Invoked Function Expression) to avoid polluting the global scope.

```
ThemeController      — manages light/dark theme state and localStorage persistence
AnimationEngine      — provides eased countup animation via requestAnimationFrame
SpeedTestEngine      — all network measurement logic (latency, download, upload)
UIController         — binds SpeedTestEngine + AnimationEngine to the DOM
```

### ThemeController

Reads the saved theme preference from `localStorage` on init, applies it via the `data-theme` attribute on `<html>`, and provides a `toggle()` method called by the button's `onclick`. All visual changes cascade from the CSS custom properties defined on `:root` and `html[data-theme="dark"]`.

### AnimationEngine

Implements a smooth number countup using `requestAnimationFrame`. Each tick computes progress using an **ease-out cubic** function:

```
easeOutCubic(t) = 1 - (1 - t)^3
```

This causes the number to approach its target value with decelerating speed, mimicking how a real network measurement gradually converges on a stable result. When a new measurement arrives mid-animation, the previous animation is cancelled and a new one begins from the current displayed value — preventing jumps.

### SpeedTestEngine

Uses three measurement functions:

**`measureLatency(sampleCount)`**
Fires `sampleCount` sequential requests to `/__down?bytes=0` (a zero-byte endpoint) and records the round-trip time of each. The two slowest samples are discarded to reduce noise from TCP slow-start and variable routing; the remaining samples are averaged.

**`measureDownload(onTick)`**
Downloads payloads of increasing size (100 KB, 500 KB, 2 MB, 10 MB, 25 MB) sequentially. Each chunk is streamed via the Fetch API's `ReadableStream`, so instantaneous throughput can be calculated and reported during the transfer. This is what enables the live-climbing number display. The final reported value is the **sustained throughput** across all chunks (total bytes / total time), which is more representative than any single chunk measurement.

**`measureUpload(onTick)`**
POSTs payloads of increasing size (50 KB, 500 KB, 2 MB, 5 MB, 10 MB) to `/__up`. Upload progress is reported after each chunk completes (streaming upload progress is not supported by the Fetch API). The final value is the sustained throughput across all chunks.

### UIController

Manages a simple test state machine:

```
idle  -->  running  -->  done
            |
            v (user clicks pause)
           idle
```

The `runTest()` method executes the three measurement phases in sequence, updating the UI after each tick callback from `SpeedTestEngine`. The `handleAction()` method is wired to the action button and dispatches based on current state.

---

## How the Speed Test Works

The application uses **Cloudflare's public speed test CDN** at `https://speed.cloudflare.com`. These endpoints are openly accessible, support CORS, and are served from Cloudflare's Anycast network, which means requests automatically route to the nearest point of presence.

| Endpoint                  | Purpose                        |
|---------------------------|-------------------------------|
| `/__down?bytes=N`         | Returns N bytes of random data |
| `/__down?bytes=0`         | Zero-byte response for ping   |
| `/__up`                   | Accepts POST body for upload  |

### Why does the number climb slowly?

This is intentional. The `AnimationEngine` uses a 600 ms eased animation per tick, so even if an instantaneous reading arrives quickly, the displayed number takes time to reach it. Larger download chunks — which take longer to transfer — produce more animation frames, creating the characteristic "climbing" feel. The `SpeedTestEngine` reports multiple ticks per chunk during streaming, keeping the animation continuously fed with new targets.

### Why are there multiple chunk sizes?

A single large download would give accurate sustained throughput, but the displayed number would not start climbing until the transfer began returning data — causing a long blank period. Small initial chunks (100 KB) return quickly and start the display moving. Large final chunks (25 MB) provide the accurate sustained figure. The `onTick` callback bridges the two.

---

## File Structure

```
dasrat-speed-test/
  index.html        — the entire application (single file)
  README.md         — this document
```

All CSS is in a `<style>` block in `<head>`. All JavaScript is in a `<script>` block at the end of `<body>`. The application is intentionally single-file for easy deployment to any static host.

---

## Getting Started

### Option 1 — Open directly in a browser

Download `index.html` and open it in any modern browser. No server, no build step.

```
open index.html
```

Note: some browsers restrict Fetch API requests from `file://` URLs due to CORS policy. If the test does not start, use Option 2.

### Option 2 — Serve locally

Any static file server works:

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# PHP
php -S localhost:8080
```

Then navigate to `http://localhost:8080`.

### Option 3 — Deploy to a static host

Drop `index.html` into any static hosting service:

- **Netlify** — drag and drop the file into the Netlify dashboard
- **Vercel** — `vercel --prod` from the project directory
- **GitHub Pages** — push to a repository and enable Pages
- **Cloudflare Pages** — connect to a git repository or upload directly

---

## Configuration

Open `index.html` and locate the `SpeedTestEngine` IIFE. The following values can be adjusted:

### Chunk sizes

```javascript
// Download chunk sizes in bytes (SpeedTestEngine.measureDownload)
const chunkSizes = [
  100_000,    // 100 KB  — first fast result
  500_000,    // 500 KB
  2_000_000,  // 2 MB
  10_000_000, // 10 MB
  25_000_000, // 25 MB   — sustained throughput figure
];
```

Reducing the largest chunk (`25_000_000`) will make the test finish faster on slow connections. Increasing it improves accuracy on high-bandwidth connections.

### Latency sample count

```javascript
const latencyMs = await SpeedTestEngine.measureLatency(8); // 8 samples
```

Reduce to `4` for a faster test; increase to `12` for greater accuracy.

### Animation duration

```javascript
// AnimationEngine.countTo — duration in milliseconds per tick
AnimationEngine.countTo(instantMbps, 600, (v) => { ... });
```

Increase `600` to make the climbing animation slower (more like fast.com). Decrease it for a snappier display.

### Auto-start delay

```javascript
// UIController init — delay before auto-start in milliseconds
setTimeout(() => { UIController.runTest(); }, 600);
```

Increase `600` to give the page more time to render before the test begins.

---

## Browser Compatibility

| Browser            | Minimum Version | Notes                             |
|--------------------|-----------------|-----------------------------------|
| Chrome / Chromium  | 79+             | Full support                      |
| Firefox            | 65+             | Full support                      |
| Safari             | 14.1+           | ReadableStream.getReader() needed |
| Edge (Chromium)    | 79+             | Full support                      |
| iOS Safari         | 14.5+           | Full support                      |

The application uses:
- `fetch()` with `ReadableStream` body reader (download streaming)
- `requestAnimationFrame` (animation)
- CSS custom properties (theming)
- `localStorage` (theme persistence)
- ES2020 numeric separators (`1_000_000`) — transpile if older browser support is needed

---

## Performance Notes

- **TTFB** (Time to First Byte) for the page itself is negligible since the file is static and small (under 30 KB unminified).
- The test auto-starts after 600 ms, so on fast connections the first number appears within 1–2 seconds of page load.
- The application does not load any analytics, tracking scripts, or third-party JavaScript other than the Google Fonts stylesheet.
- Google Fonts can be self-hosted if offline or intranet use is required — replace the `<link>` in `<head>` and update the `font-family` references in CSS.

---

## Privacy

- No data is sent to any Dasrat server. The application is entirely client-side.
- Measurement requests are sent to `speed.cloudflare.com`. Cloudflare's privacy policy applies to those requests.
- The only data stored locally is the user's theme preference (`dasrat_theme`) in `localStorage`.
- No cookies are set. No analytics are loaded.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Make changes to `index.html`
4. Test in at least Chrome and Firefox
5. Open a pull request with a clear description of the change

Code style:
- Comments in plain English; no emoji
- One blank line between logical sections in CSS and JavaScript
- JSDoc-style comments on all public functions
- CSS custom properties for all colour values

---

## License

MIT License. See `LICENSE` for details.
