/* ================================================================
   animation.js
   AnimationEngine — smooth eased countup via requestAnimationFrame.

   Purpose:
     Animates the large speed number from its current displayed value
     to a new target value. The ease-out cubic function decelerates
     toward the target, mimicking how a real measurement converges —
     the same feel used by fast.com.

   Why raw Mbps is passed around:
     The engine works entirely in raw Mbps. The caller (UIController)
     converts to the selected display unit via UnitController.format()
     before writing to the DOM. This keeps the animation engine
     unit-agnostic and reusable if units change mid-session.

   State:
     animId   — the active requestAnimationFrame handle, or null
     current  — the raw Mbps value currently shown on screen
                (used as the start point for the next animation)
   ================================================================ */

const AnimationEngine = (() => {
  let animId  = null;
  let current = 0;

  /**
   * Ease-out cubic: decelerates as t approaches 1.
   * Makes the number slow down as it approaches the target value.
   * @param {number} t - Progress ratio, 0 to 1
   * @returns {number}
   */
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Animate from the current displayed value to targetMbps.
   *
   * If an animation is already in progress, it is cancelled and a new
   * one begins from wherever the number currently sits — preventing
   * any visible jump when new measurement ticks arrive quickly.
   *
   * @param {number}   targetMbps - Destination value in raw Mbps
   * @param {number}   duration   - Animation length in milliseconds
   * @param {Function} onUpdate   - Called each frame with current raw Mbps.
   *                               Caller is responsible for formatting and
   *                               writing the value to the DOM.
   */
  function countTo(targetMbps, duration, onUpdate) {
    if (animId) cancelAnimationFrame(animId);

    const startValue = current;
    const delta      = targetMbps - startValue;
    const startTime  = performance.now();

    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      current        = startValue + delta * easeOutCubic(progress);

      if (onUpdate) onUpdate(current);

      if (progress < 1) {
        animId = requestAnimationFrame(tick);
      } else {
        animId = null;
      }
    }

    animId = requestAnimationFrame(tick);
  }

  /**
   * Cancel any running animation and reset the internal counter to zero.
   * Called when a test is reset or paused.
   */
  function reset() {
    if (animId) cancelAnimationFrame(animId);
    animId  = null;
    current = 0;
  }

  /**
   * Return the raw Mbps value currently being displayed.
   * Useful if the caller needs to know the live value mid-animation.
   * @returns {number}
   */
  function getCurrent() { return current; }

  return { countTo, reset, getCurrent };
})();
