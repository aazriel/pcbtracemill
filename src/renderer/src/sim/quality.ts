/**
 * Adaptive render resolution for the simulation (D-042). The ray-marched view costs per pixel, so
 * while the picture changes every frame (playing, orbiting, zooming) it is drawn at a lower
 * resolution that adapts to the measured frame rate; as soon as it stops changing, one frame is
 * drawn at full resolution. Pure logic (no DOM) so it can be tested.
 *
 * The frame rate is compared with the screen's own refresh interval (measured on frames where
 * nothing was drawn): a 30 Hz screen or a remote-desktop session that delivers 30 frames a second
 * is not a reason to blur the picture. The resolution moves in a few fixed levels and at most every
 * `COOLDOWN_MS`: every change re-allocates the canvas, which costs a frame by itself.
 */

/** Pixel-ratio scales while moving, lowest first. */
export const LEVELS = [0.35, 0.45, 0.55, 0.65, 0.75, 0.87, 1] as const
/** Frames up to this much longer than the screen's count as keeping up. */
const KEEP_UP = 1.12
/** Shortest time between two sharper steps (half of it between two coarser ones), ms. */
const COOLDOWN_MS = 500
/**
 * Highest pixel ratio drawn while moving: one pixel per screen point (a 1.5× or 2× screen draws
 * 2.25 or 4 times the pixels at full resolution – measured: 13 instead of 30 frames/s in 3D).
 */
const MAX_MOVING_DPR = 1
/** The picture is still after this long without a change, ms. */
export const SETTLE_MS = 160

export class RenderQuality {
  /** Index into LEVELS of the moving resolution. */
  level = 4
  /** The screen's refresh interval, ms (measured while nothing is drawn). */
  display = 1000 / 60
  private ema = 0
  private lastTick = 0
  private lastLevelChange = 0
  private drewLast = false
  private lastChange = -1e9
  private sharp = true

  get scale(): number {
    return LEVELS[this.level]
  }

  /**
   * Called on every animation frame. Returns the pixel ratio to draw this frame at, or null when
   * nothing needs drawing. `changed`: the picture changed since the last frame; `moving`: it keeps
   * changing (playing).
   */
  frame(now: number, dpr: number, changed: boolean, moving: boolean): number | null {
    const tickDt = now - this.lastTick
    const prevDrew = this.drewLast
    if (this.lastTick > 0 && !prevDrew && tickDt > 4 && tickDt < 100)
      this.display = this.display * 0.8 + tickDt * 0.2
    this.lastTick = now
    this.drewLast = false
    if (changed || moving) {
      // Only frames drawn back to back measure the drawing: when the picture waits for the
      // simulation (top view while playing) a lower resolution would not make it any faster.
      if (prevDrew && tickDt < 150) {
        this.ema = this.ema ? this.ema * 0.75 + tickDt * 0.25 : tickDt
        const since = now - this.lastLevelChange
        // missing screen refreshes: fewer pixels at once; keeping up easily: slowly sharper
        if (this.ema > this.display * KEEP_UP && this.level > 0 && since > COOLDOWN_MS / 2) {
          this.level--
          this.lastLevelChange = now
        } else if (this.ema < this.display * 1.06 && this.level < LEVELS.length - 1 && since > COOLDOWN_MS) {
          this.level++
          this.lastLevelChange = now
        }
      }
      this.lastChange = now
      this.sharp = false
      this.drewLast = true
      const s = Math.round(Math.min(dpr, MAX_MOVING_DPR) * this.scale * 100) / 100
      return Math.max(0.25, Math.min(dpr, s))
    }
    if (!this.sharp && now - this.lastChange > SETTLE_MS) {
      this.sharp = true
      this.drewLast = true
      return dpr
    }
    return null
  }
}
