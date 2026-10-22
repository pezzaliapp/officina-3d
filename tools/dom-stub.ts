/**
 * DOM minimo per far girare i modelli in Node: le texture disegnate su canvas
 * diventano disegni a vuoto, gli elementi dell'interfaccia non esistono.
 */
const ctx2d: unknown = new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? () => ({ width: 0 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: () => true,
})
const canvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d, addEventListener() {} })
;(globalThis as Record<string, unknown>).document = {
  createElement: () => canvas(),
  getElementById: () => null,
  querySelectorAll: () => [],
}
