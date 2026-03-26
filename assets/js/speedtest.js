/* ================================================================
   speedtest.js
   SpeedTestEngine — all network measurement logic.

   This module has zero DOM access. It only fetches and times
   network requests, then returns results via Promises and callbacks.
   All values are expressed in Mbps (megabits per second).

   Server: Cloudflare Speed Test CDN (speed.cloudflare.com)
     Endpoints are publicly accessible, support CORS, and are served
     from Cloudflare's Anycast network — requests automatically route
     to the nearest point of presence.

   Endpoints used:
     /__down?bytes=N  — returns exactly N bytes of random data
     /__down?bytes=0  — zero-byte response used for latency timing
     /__up            — accepts POST body (used for upload timing)
   ================================================================ */

const SpeedTestEngine = (() => {
  const BASE_URL = 'https://speed.cloudflare.com';

  /** Pause execution for ms milliseconds. */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ── Latency Measurement ──────────────────────────────────── */

  /**
   * Measure round-trip latency by timing requests to a 0-byte endpoint.
   *
   * We fire sampleCount sequential requests with a short gap between
   * each to avoid burst-related distortion. The two slowest samples
   * are discarded to remove noise from TCP slow-start and variable
   * routing. The remaining samples are averaged.
   *
   * @param {number} [sampleCount=8]
   * @returns {Promise<number>} Average latency in milliseconds
   */
  async function measureLatency(sampleCount = 8) {
    const timings = [];

    for (let i = 0; i < sampleCount; i++) {
      const url = `${BASE_URL}/__down?bytes=0&nc=${Date.now()}_${i}`;
      const t0  = performance.now();
      try { await fetch(url, { cache: 'no-store' }); } catch (_) {}
      timings.push(performance.now() - t0);
      await sleep(60);
    }

    // Sort ascending, discard the two slowest outliers
    timings.sort((a, b) => a - b);
    const trimmed = timings.slice(0, sampleCount - 2);
    return trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length;
  }

  /* ── Download Measurement ─────────────────────────────────── */

  /**
   * Measure download throughput by streaming progressively larger payloads.
   *
   * Why progressive chunk sizes:
   *   A single large download would give accurate sustained throughput,
   *   but the animated number would not start climbing until the
   *   transfer began returning data — causing a long blank period.
   *   Small initial chunks (100 KB) return quickly and start the
   *   display moving. Large final chunks (25 MB) establish the
   *   accurate sustained figure.
   *
   * The onTick callback is called continuously during streaming with
   * the instantaneous throughput so UIController can animate the
   * speed number in real time.
   *
   * @param {Function} onTick - (instantMbps: number, progressFraction: number) => void
   * @returns {Promise<number>} Sustained download speed in Mbps
   */
  async function measureDownload(onTick) {
    const chunkSizes = [
      100_000,     //  100 KB — produces a fast initial reading
      500_000,     //  500 KB
      2_000_000,   //    2 MB
      10_000_000,  //   10 MB
      25_000_000,  //   25 MB — establishes the sustained figure
    ];

    let totalBytes   = 0;
    let totalSeconds = 0;

    for (let i = 0; i < chunkSizes.length; i++) {
      const bytes = chunkSizes[i];
      const url   = `${BASE_URL}/__down?bytes=${bytes}&nc=${Date.now()}_d${i}`;
      const t0    = performance.now();

      try {
        const response = await fetch(url, { cache: 'no-store' });
        const reader   = response.body.getReader();
        let received   = 0;

        // Stream the response body to report live instantaneous throughput
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          const secs        = (performance.now() - t0) / 1000;
          const instantMbps = (received * 8) / (secs * 1_000_000);
          // Overall progress: current chunk position mapped to 0..1 across all chunks
          const overallProg = (i + received / bytes) / chunkSizes.length;
          onTick(instantMbps, overallProg);
        }

        totalBytes   += bytes;
        totalSeconds += (performance.now() - t0) / 1000;

      } catch (err) {
        console.warn(`Download chunk ${i + 1} failed:`, err.message);
      }
    }

    if (totalSeconds === 0) return 0;
    // Sustained throughput = all bytes transferred / total wall-clock time
    return (totalBytes * 8) / (totalSeconds * 1_000_000);
  }

  /* ── Upload Measurement ───────────────────────────────────── */

  /**
   * Measure upload throughput by POSTing FormData chunks.
   *
   * Why FormData instead of raw binary:
   *   Sending Content-Type: application/octet-stream triggers a CORS
   *   preflight OPTIONS request. Cloudflare's /__up endpoint does not
   *   return Access-Control-Allow-Origin for third-party origins, so
   *   the preflight fails and the upload is blocked entirely.
   *
   *   multipart/form-data (used by FormData) is one of three "simple"
   *   content types that browsers send without a preflight check.
   *   Combined with mode:'no-cors', the POST goes through unconditionally.
   *
   *   The response is opaque (unreadable) with no-cors — this is
   *   intentional. We only need the elapsed wall-clock time, not the
   *   response body. fetch() resolves after the full request/response
   *   cycle, so timing t0 to resolution correctly captures upload duration.
   *
   * @param {Function} onTick - (instantMbps: number, progressFraction: number) => void
   * @returns {Promise<number>} Sustained upload speed in Mbps
   */
  async function measureUpload(onTick) {
    const chunkSizes = [
      50_000,      //  50 KB — fast first tick
      500_000,     // 500 KB
      2_000_000,   //   2 MB
      5_000_000,   //   5 MB
      10_000_000,  //  10 MB — sustained figure
    ];

    let totalBytes   = 0;
    let totalSeconds = 0;

    for (let i = 0; i < chunkSizes.length; i++) {
      const bytes = chunkSizes[i];

      // Build a FormData payload with the exact byte count we want.
      // Filling with 0x61 ('a') is arbitrary — any byte value works.
      const form = new FormData();
      form.append('data', new Blob([new Uint8Array(bytes).fill(0x61)]), 'chunk.bin');

      const url = `${BASE_URL}/__up?nc=${Date.now()}_u${i}`;
      const t0  = performance.now();

      try {
        await fetch(url, {
          method: 'POST',
          body:   form,
          mode:   'no-cors',   // bypasses preflight; response will be opaque
          cache:  'no-store',
        });

        const secs       = (performance.now() - t0) / 1000;
        const chunkMbps  = (bytes * 8) / (secs * 1_000_000);
        const progress   = (i + 1) / chunkSizes.length;

        onTick(chunkMbps, progress);
        totalBytes   += bytes;
        totalSeconds += secs;

      } catch (err) {
        console.warn(`Upload chunk ${i + 1} failed:`, err.message);
      }
    }

    if (totalSeconds === 0) return 0;
    return (totalBytes * 8) / (totalSeconds * 1_000_000);
  }

  return { measureLatency, measureDownload, measureUpload };
})();
