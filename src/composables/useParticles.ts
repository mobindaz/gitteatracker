/**
 * useParticles — lightweight canvas particle system
 * Draws floating, softly-glowing orbs that drift and pulse.
 * Automatically adapts colours to dark / light theme.
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number        // radius
  baseAlpha: number
  alpha: number
  hue: number
  phase: number    // for pulsing
  speed: number
}

interface Options {
  count?: number
  dark?: Ref<boolean>
}

export function useParticles(canvasRef: Ref<HTMLCanvasElement | null>, opts: Options = {}) {
  const { count = 55 } = opts

  let animId = 0
  let particles: Particle[] = []
  let w = 0
  let h = 0

  function mkParticle(canvas: HTMLCanvasElement): Particle {
    return {
      x:         Math.random() * canvas.width,
      y:         Math.random() * canvas.height,
      vx:        (Math.random() - 0.5) * 0.35,
      vy:        (Math.random() - 0.5) * 0.35,
      r:         Math.random() * 2.8 + 0.6,
      baseAlpha: Math.random() * 0.45 + 0.1,
      alpha:     0,
      hue:       Math.random() < 0.6 ? 217 : (Math.random() < 0.5 ? 270 : 155),
      phase:     Math.random() * Math.PI * 2,
      speed:     Math.random() * 0.008 + 0.004,
    }
  }

  function init(canvas: HTMLCanvasElement) {
    w = canvas.width  = canvas.offsetWidth  * devicePixelRatio
    h = canvas.height = canvas.offsetHeight * devicePixelRatio
    particles = Array.from({ length: count }, () => mkParticle(canvas))
  }

  function draw(canvas: HTMLCanvasElement, isDark: boolean) {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, w, h)

    const now = performance.now() / 1000

    for (const p of particles) {
      p.x += p.vx
      p.y += p.vy
      p.phase += p.speed

      // Soft bounce
      if (p.x < 0) { p.x = 0; p.vx *= -1 }
      if (p.x > w) { p.x = w; p.vx *= -1 }
      if (p.y < 0) { p.y = 0; p.vy *= -1 }
      if (p.y > h) { p.y = h; p.vy *= -1 }

      const pulse = 0.5 + 0.5 * Math.sin(p.phase)
      p.alpha = p.baseAlpha * (0.5 + 0.5 * pulse)

      const sat  = isDark ? '80%' : '65%'
      const light = isDark ? '65%' : '55%'
      const color = `hsla(${p.hue}, ${sat}, ${light}, ${p.alpha})`

      // Radial glow
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4.5)
      grad.addColorStop(0, color)
      grad.addColorStop(1, 'transparent')

      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r * (1 + 0.4 * pulse), 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()
    }
  }

  function loop(canvas: HTMLCanvasElement, isDark: boolean) {
    draw(canvas, isDark)
    animId = requestAnimationFrame(() => loop(canvas, isDark))
  }

  function start(isDark: boolean) {
    const canvas = canvasRef.value
    if (!canvas) return
    cancelAnimationFrame(animId)
    init(canvas)
    loop(canvas, isDark)
  }

  function stop() {
    cancelAnimationFrame(animId)
  }

  // Re-init on resize
  let resizeObs: ResizeObserver | null = null

  function mount(isDark: boolean) {
    const canvas = canvasRef.value
    if (!canvas) return
    start(isDark)
    resizeObs = new ResizeObserver(() => {
      if (canvas) init(canvas)
    })
    resizeObs.observe(canvas.parentElement ?? canvas)
  }

  function unmount() {
    stop()
    resizeObs?.disconnect()
  }

  return { mount, unmount, start, stop }
}
