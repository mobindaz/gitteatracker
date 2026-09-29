import { ref, watch, onMounted } from 'vue'

/**
 * Animates a numeric value from its previous state to its new state.
 * Returns a reactive `display` string and triggers re-animation on value changes.
 */
export function useAnimatedNumber(
  getValue: () => number,
  options: {
    duration?: number     // ms, default 900
    decimals?: number     // fixed decimal places, default 0
    suffix?: string       // e.g. 'h', '%'
    prefix?: string
    easing?: 'ease-out' | 'spring'
  } = {}
) {
  const {
    duration = 900,
    decimals = 0,
    suffix = '',
    prefix = '',
  } = options

  const display = ref(prefix + getValue().toFixed(decimals) + suffix)
  let animFrame: number | null = null
  let startTime: number | null = null
  let startVal = 0
  let targetVal = 0

  function easeOutQuart(t: number): number {
    return 1 - Math.pow(1 - t, 4)
  }

  function animate(ts: number) {
    if (startTime === null) startTime = ts
    const elapsed = ts - startTime
    const progress = Math.min(elapsed / duration, 1)
    const easedProgress = easeOutQuart(progress)
    const current = startVal + (targetVal - startVal) * easedProgress
    display.value = prefix + current.toFixed(decimals) + suffix
    if (progress < 1) {
      animFrame = requestAnimationFrame(animate)
    } else {
      display.value = prefix + targetVal.toFixed(decimals) + suffix
    }
  }

  function animateTo(newVal: number) {
    if (animFrame !== null) cancelAnimationFrame(animFrame)
    startTime = null
    startVal = parseFloat(display.value.replace(prefix, '').replace(suffix, '')) || 0
    targetVal = newVal
    animFrame = requestAnimationFrame(animate)
  }

  onMounted(() => {
    animateTo(getValue())
  })

  watch(getValue, (newVal) => {
    animateTo(newVal)
  })

  return { display }
}
