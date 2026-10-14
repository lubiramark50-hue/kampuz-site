/* Kampuz — single source of truth for the brand. Change the name here and the app follows. */
export const BRAND = Object.freeze({
  name: 'Kampuz',
  tagline: 'Your campus, live.',
  legal: 'Kampuz © 2026',
});

/** The Kampuz mark: black "K" on boda-yellow, with a red live dot. Flat, self-contained SVG. */
export function logoMark(size = 36, { inverse = false } = {}) {
  const [tile, ink] = inverse ? ['#000', '#FFC800'] : ['#FFC800', '#000'];
  return `<svg class="kz-mark" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${BRAND.name}">
    <rect width="64" height="64" rx="18" fill="${tile}"/>
    <path d="M22 17v30" stroke="${ink}" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M44 17 29 32l15 15" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="52" cy="12" r="3.4" fill="#E4002B"/></svg>`;
}

export const wordmark = () => BRAND.name;
