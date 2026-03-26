/* ================================================================
   ui.js
   UnitController + UIController + page initialisation.

   Load order (index.html script tags):
     1. theme.js      — ThemeController
     2. animation.js  — AnimationEngine
     3. speedtest.js  — SpeedTestEngine
     4. ui.js         — UnitController, UIController, init()

   Each prior module must be loaded before this file executes.
   ================================================================ */


/* ================================================================
   UNIT CONTROLLER
   Manages Mbps / MB/s / GB/s selection and conversion.

   Conversion table (1 byte = 8 bits):
     Mbps  × 1        = Mbps  (display: 1 decimal  e.g. 94.3)
     Mbps  × 0.125    = MB/s  (display: 2 decimals e.g. 11.79)
     Mbps  × 0.000125 = GB/s  (display: 3 decimals e.g. 0.012)

   Design decisions:
     - All network measurements stay in raw Mbps throughout.
     - UnitController.format(mbps) is the single conversion point
       used by UIController before any value touches the DOM.
     - onChange callbacks fire whenever the selection changes so
       UIController can re-render stored results immediately without
       re-running the test.
     - The selected unit is persisted in localStorage.
   ================================================================ */

const UnitController = (() => {
  const STORAGE_KEY = 'dasrat_unit';

  const UNITS = {
    mbps: { factor: 1,          label: 'Mbps', decimals: 1 },
    mbs:  { factor: 0.125,      label: 'MB/s', decimals: 2 },
    gbs:  { factor: 0.000125,   label: 'GB/s', decimals: 3 },
  };

  let active    = 'mbps';
  let callbacks = [];   // registered via onChange()

  /**
   * Format a raw Mbps value as a display string in the active unit.
   * Returns '--' for null, undefined, or NaN input.
   * @param {number|null} mbps
   * @returns {string}
   */
  function format(mbps) {
    if (mbps === null || mbps === undefined || isNaN(mbps)) return '--';
    const u = UNITS[active];
    return (mbps * u.factor).toFixed(u.decimals);
  }

  /** Return the active unit label string, e.g. "MB/s". */
  function getLabel() { return UNITS[active].label; }

  /**
   * Switch to a new unit. Updates pill UI + all unit label elements,
   * then fires all registered onChange callbacks.
   * @param {'mbps'|'mbs'|'gbs'} key
   */
  function select(key) {
    if (!UNITS[key] || key === active) return;
    active = key;
    syncUI();
    try { localStorage.setItem(STORAGE_KEY, key); } catch (_) {}
    callbacks.forEach((fn) => fn());
  }

  /**
   * Update all pill buttons and unit label elements to reflect `active`.
   * Extracted so init() can call it without firing callbacks.
   */
  function syncUI() {
    Object.keys(UNITS).forEach((k) => {
      const btn = document.getElementById(`unitBtn-${k}`);
      if (!btn) return;
      btn.classList.toggle('is-active', k === active);
      btn.setAttribute('aria-pressed', k === active ? 'true' : 'false');
    });

    // Large number unit label
    const unitEl = document.getElementById('speedUnit');
    if (unitEl) unitEl.textContent = UNITS[active].label;

    // Result row unit labels (latency row has no dynamic unit)
    ['resultDownUnit', 'resultUpUnit'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = UNITS[active].label;
    });
  }

  /**
   * Register a callback to fire whenever the selected unit changes.
   * Used by UIController to re-render stored results instantly.
   * @param {Function} fn
   */
  function onChange(fn) { callbacks.push(fn); }

  /**
   * Initialise: restore saved unit from localStorage and sync the UI.
   * Does not fire onChange callbacks (nothing to re-render on first load).
   */
  function init() {
    let saved = 'mbps';
    try { saved = localStorage.getItem(STORAGE_KEY) || 'mbps'; } catch (_) {}
    if (!UNITS[saved]) saved = 'mbps';
    active = saved;
    syncUI();
  }

  return { format, getLabel, select, onChange, init };
})();


/* ================================================================
   UI CONTROLLER
   The only module that reads or writes the DOM directly.

   Wires SpeedTestEngine, AnimationEngine, and UnitController together
   and manages the test state machine.

   State machine:
     idle  -->  running  -->  done
                  |
                  v  (user clicks pause)
                 idle

   Stored raw values (lastDownMbps, lastUpMbps):
     After the test completes these hold the final Mbps figures.
     UnitController.onChange calls rerenderResults() which re-formats
     both stored values without re-running the test — so switching
     units after completion is instant.

   Unit selector lock:
     The .unit-selector element receives .is-locked while a test is
     running, dimming it and disabling pointer events via CSS.
     It is unlocked again when the test finishes or is paused.
   ================================================================ */

const UIController = (() => {
  /* ── DOM References ─────────────────────────────────────────── */
  const numberEl     = document.getElementById('speedNumber');
  const unitEl       = document.getElementById('speedUnit');
  const statusEl     = document.getElementById('statusText');
  const badgeEl      = document.getElementById('stableBadge');
  const resultsEl    = document.getElementById('resultsPanel');
  const progressEl   = document.getElementById('progressBar');
  const actionBtn    = document.getElementById('actionBtn');
  const actionIcon   = document.getElementById('actionIcon');
  const resultDown   = document.getElementById('resultDown');
  const resultUp     = document.getElementById('resultUp');
  const resultPing   = document.getElementById('resultPing');
  const unitSelector = document.getElementById('unitSelector');

  /* ── State ──────────────────────────────────────────────────── */
  let testState    = 'idle';   // 'idle' | 'running' | 'done'
  let abortFlag    = false;    // set to true to halt a running test early

  /*
   * Store the last measured raw Mbps values so a post-test unit change
   * can re-render without re-running the test.
   */
  let lastDownMbps = null;
  let lastUpMbps   = null;

  /* ── SVG Icon Strings ───────────────────────────────────────── */
  const ICON_PAUSE = `
    <line x1="8"  y1="5" x2="8"  y2="19"/>
    <line x1="16" y1="5" x2="16" y2="19"/>
  `;

  const ICON_RESTART = `
    <polyline points="1 4 1 10 7 10"/>
    <path d="M3.51 15a9 9 0 1 0 .49-4"/>
  `;

  /* ── Private Helpers ────────────────────────────────────────── */

  /**
   * Render a raw Mbps value on the large speed number element.
   * Converts to the active unit before formatting.
   * @param {number|null} mbps
   */
  function displaySpeed(mbps) {
    numberEl.textContent = UnitController.format(mbps);
  }

  /**
   * Move the top-of-page progress bar to the given percentage.
   * @param {number} pct — 0 to 100
   */
  function setProgress(pct) {
    progressEl.style.width = `${Math.min(pct, 100)}%`;
    progressEl.setAttribute('aria-valuenow', Math.round(pct));
  }

  /** Update the status text shown below the speed number. */
  function setStatus(msg) { statusEl.textContent = msg; }

  /**
   * Show or hide the "Speed Stabilised" badge.
   * @param {boolean} visible
   */
  function setStableBadge(visible) {
    badgeEl.classList.toggle('is-visible', visible);
  }

  /**
   * Swap the action button's inner SVG icon.
   * @param {'pause'|'restart'} type
   */
  function setActionIcon(type) {
    actionIcon.innerHTML = type === 'restart' ? ICON_RESTART : ICON_PAUSE;
    actionBtn.setAttribute(
      'aria-label',
      type === 'restart' ? 'Restart test' : 'Pause test'
    );
  }

  /**
   * Lock or unlock the unit selector.
   * Locked during a running test to prevent mid-animation unit switches.
   * @param {boolean} locked
   */
  function lockSelector(locked) {
    unitSelector.classList.toggle('is-locked', locked);
  }

  /**
   * Reset all DOM to the pre-test idle state.
   * Called at the start of every new test run and on pause.
   */
  function resetUI() {
    AnimationEngine.reset();
    numberEl.textContent  = '--';
    numberEl.className    = 'speed-display__number';
    unitEl.className      = 'speed-display__unit';
    unitEl.textContent    = UnitController.getLabel();
    setProgress(0);
    setStatus('Connecting to server');
    setStableBadge(false);
    setActionIcon('pause');
    lockSelector(false);
    resultsEl.classList.remove('is-visible');
    resultDown.textContent = '--';
    resultUp.textContent   = '--';
    resultPing.textContent = '--';
    lastDownMbps = null;
    lastUpMbps   = null;
  }

  /* ── Unit Change Re-render ──────────────────────────────────── */

  /**
   * Re-render the large speed number and both result rows using the
   * stored raw Mbps values. Called by the UnitController onChange
   * callback whenever the user picks a different unit after the test.
   *
   * This is a pure display operation — no network calls are made.
   */
  function rerenderResults() {
    unitEl.textContent = UnitController.getLabel();
    if (testState === 'done' && lastDownMbps !== null) {
      numberEl.textContent   = UnitController.format(lastDownMbps);
      resultDown.textContent = UnitController.format(lastDownMbps);
      resultUp.textContent   = UnitController.format(lastUpMbps);
    }
  }

  /* ── Main Test Sequence ─────────────────────────────────────── */

  /**
   * Run a full speed test sequence:
   *   Phase 1 — Latency   (8 ping samples, 2 outliers trimmed)
   *   Phase 2 — Download  (streaming, 5 progressive chunks)
   *   Phase 3 — Upload    (FormData POST, 5 chunks)
   *   Phase 4 — Complete  (display final state)
   */
  async function runTest() {
    testState = 'running';
    abortFlag = false;
    resetUI();
    numberEl.classList.add('is-active');
    lockSelector(true);

    /* ── Phase 1: Latency ─────────────────────────── */
    setStatus('Measuring latency');
    setProgress(4);

    const latencyMs = await SpeedTestEngine.measureLatency(8);
    if (abortFlag) return;

    resultPing.textContent = latencyMs.toFixed(0);
    setProgress(12);

    /* ── Phase 2: Download ────────────────────────── */
    setStatus('Testing download speed');

    let stabilised   = false;
    let previousMbps = 0;

    const downloadMbps = await SpeedTestEngine.measureDownload(
      (instantMbps, progressFraction) => {
        if (abortFlag) return;

        // Animate the number toward the latest reading.
        // 600 ms ease-out per tick gives the fast.com "climbing" feel.
        AnimationEngine.countTo(instantMbps, 600, (v) => displaySpeed(v));

        // Map download progress (0..1) to bar range 12..72
        setProgress(12 + progressFraction * 60);

        // Show the stable badge once readings settle within 15% variance
        const variance = previousMbps > 0
          ? Math.abs(instantMbps - previousMbps) / previousMbps
          : 1;
        if (!stabilised && variance < 0.15 && instantMbps > 1) {
          stabilised = true;
          setStableBadge(true);
        }
        previousMbps = instantMbps;
      }
    );

    if (abortFlag) return;

    // Settle the animated number on the final sustained figure
    AnimationEngine.countTo(downloadMbps, 900, (v) => displaySpeed(v));
    lastDownMbps           = downloadMbps;
    resultDown.textContent = UnitController.format(downloadMbps);
    setProgress(72);

    /* ── Phase 3: Upload ──────────────────────────── */
    setStatus('Testing upload speed');

    const uploadMbps = await SpeedTestEngine.measureUpload(
      (_, progressFraction) => {
        if (!abortFlag) setProgress(72 + progressFraction * 23);
      }
    );

    if (abortFlag) return;

    lastUpMbps           = uploadMbps;
    resultUp.textContent = UnitController.format(uploadMbps);
    setProgress(98);

    /* ── Phase 4: Complete ────────────────────────── */
    await new Promise((r) => setTimeout(r, 300));

    setProgress(100);
    setStatus('Test complete');
    numberEl.classList.remove('is-active');
    numberEl.classList.add('is-done');
    unitEl.classList.add('is-done');
    resultsEl.classList.add('is-visible');
    setActionIcon('restart');
    lockSelector(false);
    testState = 'done';
  }

  /* ── Public Action Handler ──────────────────────────────────── */

  /**
   * Called when the user clicks the action button.
   *
   *   running → abort the test, reset the UI to idle state
   *   idle    → start a new test
   *   done    → start a new test
   */
  function handleAction() {
    if (testState === 'running') {
      abortFlag = true;
      testState = 'idle';
      resetUI();
      setStatus('Test paused — click restart to begin again');
      setActionIcon('restart');
    } else {
      runTest();
    }
  }

  return { runTest, handleAction, rerenderResults };
})();


/* ================================================================
   INITIALISATION
   Runs once after all four script files have loaded.

   Order matters:
     1. Apply saved theme (before first paint to avoid flash)
     2. Apply saved unit (syncs pill buttons and label text)
     3. Register unit-change callback for post-test re-renders
     4. Auto-start the speed test after a short settle delay
   ================================================================ */

(function init() {
  ThemeController.init();
  UnitController.init();

  // Whenever the user switches unit, re-render any displayed results
  UnitController.onChange(() => UIController.rerenderResults());

  // Auto-start — 600 ms gives the page time to render before numbers move
  setTimeout(() => UIController.runTest(), 600);
})();
