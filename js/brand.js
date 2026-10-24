/* Gen Z — single source of truth for the brand. Change the name here and the app follows. */
export const BRAND = Object.freeze({
  name: 'Gen Z',
  tagline: 'Your campus, live.',
  legal: 'Gen Z © 2026',
});

/** The Gen Z mark: black "GZ" on boda-yellow, with a red live dot. Flat, self-contained SVG. */
export function logoMark(size = 36, { inverse = false } = {}) {
  const [tile, ink] = inverse ? ['#000', '#FFC800'] : ['#FFC800', '#000'];
  return `<svg class="kz-mark" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${BRAND.name}">
    <rect width="64" height="64" rx="18" fill="${tile}"/>
    <path d="M35 23A10.5 10.5 0 1 0 35 41" stroke="${ink}" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M24.5 32H35" stroke="${ink}" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M39 21.5H53L39 42.5H53" stroke="${ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="52" cy="12" r="3.4" fill="#E4002B"/></svg>`;
}

export const wordmark = () => BRAND.name;
