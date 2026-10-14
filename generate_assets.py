#!/usr/bin/env python3
"""Generate the seed visual assets for StreamCampus (SVG, no external deps)."""
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(BASE, "uploads", "seed")
ADS = os.path.join(BASE, "ads")
os.makedirs(SEED, exist_ok=True)
os.makedirs(ADS, exist_ok=True)


def write(path, svg):
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    print("wrote", os.path.relpath(path, BASE))


def banner(name, c1, c2, c3):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 300">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{c1}"/><stop offset="0.55" stop-color="{c2}"/><stop offset="1" stop-color="{c3}"/>
    </linearGradient>
  </defs>
  <rect width="900" height="300" fill="url(#bg)"/>
  <circle cx="720" cy="60" r="180" fill="#ffffff" opacity="0.07"/>
  <circle cx="120" cy="280" r="140" fill="#ffffff" opacity="0.06"/>
  <path d="M0 240 Q 225 180 450 230 T 900 210 V 300 H 0 Z" fill="#000000" opacity="0.10"/>
  <path d="M0 265 Q 225 215 450 255 T 900 245 V 300 H 0 Z" fill="#000000" opacity="0.10"/>
</svg>'''
    write(os.path.join(SEED, f"banner-{name}.svg"), svg)


banner("sarah",    "#7C3AED", "#A855F7", "#DB2777")
banner("david",    "#7C2D12", "#EA580C", "#F59E0B")
banner("grace",    "#155E75", "#0EA5E9", "#22D3EE")
banner("joseph",   "#14532D", "#16A34A", "#4ADE80")
banner("patricia", "#881337", "#E11D48", "#FB7185")
banner("default",  "#1E293B", "#334155", "#475569")


def art(name, sky1, sky2, sun, hill1, hill2, extra=""):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{sky1}"/><stop offset="1" stop-color="{sky2}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#sky)"/>
  <circle cx="620" cy="150" r="70" fill="{sun}" opacity="0.9"/>
  <circle cx="620" cy="150" r="95" fill="{sun}" opacity="0.25"/>
  {extra}
  <path d="M0 430 Q 200 330 400 420 T 800 400 V 600 H 0 Z" fill="{hill1}"/>
  <path d="M0 500 Q 250 420 500 490 T 800 470 V 600 H 0 Z" fill="{hill2}"/>
</svg>'''
    write(os.path.join(SEED, f"art-{name}.svg"), svg)


# sunset over the main gate (abstract)
art("sunset", "#FDE68A", "#F59E0B", "#FBBF24", "#7C2D12", "#431407",
    extra='<rect x="330" y="300" width="140" height="130" rx="8" fill="#3B1A05" opacity="0.85"/>'
          '<path d="M310 300 L400 230 L490 300 Z" fill="#3B1A05" opacity="0.85"/>'
          '<rect x="352" y="330" width="96" height="100" rx="4" fill="#FDE68A" opacity="0.35"/>')

# code on a screen
art("code", "#0F172A", "#1E293B", "#38BDF8", "#312E81", "#1E1B4B",
    extra='<rect x="150" y="120" width="500" height="330" rx="16" fill="#0B1220" stroke="#334155" stroke-width="3"/>'
          '<rect x="180" y="160" width="180" height="14" rx="7" fill="#4ADE80"/>'
          '<rect x="180" y="190" width="260" height="14" rx="7" fill="#38BDF8"/>'
          '<rect x="210" y="220" width="220" height="14" rx="7" fill="#F59E0B"/>'
          '<rect x="210" y="250" width="300" height="14" rx="7" fill="#E2E8F0" opacity="0.7"/>'
          '<rect x="180" y="280" width="140" height="14" rx="7" fill="#F472B6"/>'
          '<rect x="210" y="310" width="250" height="14" rx="7" fill="#A78BFA"/>'
          '<rect x="180" y="340" width="200" height="14" rx="7" fill="#4ADE80" opacity="0.8"/>'
          '<circle cx="655" cy="145" r="8" fill="#EF4444"/><circle cx="630" cy="145" r="8" fill="#F59E0B"/><circle cx="605" cy="145" r="8" fill="#22C55E"/>')

# solar panels & grid
art("energy", "#0C4A6E", "#0EA5E9", "#FDE047", "#134E4A", "#0F766E",
    extra='<g transform="translate(180,180) rotate(-8)">'
          '<rect x="0" y="0" width="200" height="130" rx="8" fill="#1E3A8A" stroke="#93C5FD" stroke-width="4"/>'
          '<line x1="66" y1="0" x2="66" y2="130" stroke="#93C5FD" stroke-width="3"/>'
          '<line x1="133" y1="0" x2="133" y2="130" stroke="#93C5FD" stroke-width="3"/>'
          '<line x1="0" y1="65" x2="200" y2="65" stroke="#93C5FD" stroke-width="3"/>'
          '</g>'
          '<rect x="520" y="250" width="120" height="160" rx="10" fill="#334155"/>'
          '<path d="M580 270 L560 340 L585 340 L565 400 L620 320 L592 320 L615 270 Z" fill="#FDE047"/>')

# kampala street vibe
art("city", "#312E81", "#7C3AED", "#FCD34D", "#4C1D95", "#2E1065",
    extra='<rect x="60" y="240" width="120" height="220" fill="#1E1B4B" opacity="0.9"/>'
          '<rect x="220" y="180" width="140" height="280" fill="#1E1B4B" opacity="0.75"/>'
          '<rect x="400" y="260" width="110" height="200" fill="#1E1B4B" opacity="0.9"/>'
          '<rect x="550" y="210" width="150" height="250" fill="#1E1B4B" opacity="0.8"/>'
          '<g opacity="0.85">'
          '<rect x="90" y="270" width="16" height="16" fill="#FDE047"/><rect x="120" y="270" width="16" height="16" fill="#F472B6"/>'
          '<rect x="250" y="210" width="16" height="16" fill="#38BDF8"/><rect x="290" y="240" width="16" height="16" fill="#FDE047"/>'
          '<rect x="430" y="290" width="16" height="16" fill="#4ADE80"/><rect x="460" y="320" width="16" height="16" fill="#FDE047"/>'
          '<rect x="580" y="240" width="16" height="16" fill="#FB7185"/><rect x="620" y="270" width="16" height="16" fill="#38BDF8"/>'
          '</g>')

# chess
art("chess", "#1C1917", "#44403C", "#FBBF24", "#292524", "#1C1917",
    extra='<rect x="160" y="130" width="480" height="340" rx="14" fill="#57534E" opacity="0.35"/>'
          '<g fill="#FAFAF9">'
          '<path d="M250 420 v-40 h20 v-30 h-14 v-20 h10 v-24 h-10 v-22 h28 v22 h-10 v24 h10 v20 h-14 v30 h20 v40 Z"/>'
          '<path d="M380 420 v-40 h20 v-30 h-30 c0-24 10-30 10-46 h20 c0 16 10 22 10 46 h-30 v30 h20 v40 Z" opacity="0.92"/>'
          '</g>'
          '<g fill="#0C0A09">'
          '<path d="M500 420 v-40 h20 v-30 h-14 v-20 h10 v-24 h-10 v-22 h28 v22 h-10 v24 h10 v20 h-14 v30 h20 v40 Z" opacity="0.95"/>'
          '<path d="M620 420 v-40 h20 v-30 h-30 c0-24 10-30 10-46 h20 c0 16 10 22 10 46 h-30 v30 h20 v40 Z"/>'
          '</g>')

# graduation / books
art("books", "#7F1D1D", "#DC2626", "#FDE68A", "#7F1D1D", "#450A0A",
    extra='<rect x="200" y="200" width="180" height="46" rx="8" fill="#FDE68A" transform="rotate(-4 290 223)"/>'
          '<rect x="220" y="250" width="180" height="46" rx="8" fill="#F59E0B" transform="rotate(2 310 273)"/>'
          '<rect x="205" y="300" width="180" height="46" rx="8" fill="#FCA5A5" transform="rotate(-2 295 323)"/>'
          '<circle cx="580" cy="240" r="60" fill="#000000" opacity="0.25"/>'
          '<path d="M580 180 L660 225 L580 270 L500 225 Z" fill="#111827"/>'
          '<rect x="566" y="270" width="28" height="52" rx="6" fill="#111827"/>'
          '<circle cx="580" cy="330" r="10" fill="#111827"/>')

# lecture hall
art("lecture", "#134E4A", "#14B8A6", "#FEF08A", "#115E59", "#134E4A",
    extra='<g opacity="0.95">'
          '<rect x="130" y="250" width="540" height="34" rx="8" fill="#0F3D3A"/>'
          '<rect x="170" y="310" width="460" height="34" rx="8" fill="#0F3D3A"/>'
          '<rect x="130" y="370" width="540" height="34" rx="8" fill="#0F3D3A"/>'
          '</g>'
          '<circle cx="400" cy="160" r="52" fill="#FEF08A" opacity="0.9"/>'
          '<rect x="372" y="216" width="56" height="22" rx="8" fill="#0F3D3A"/>')

# football
art("football", "#065F46", "#34D399", "#FDE047", "#064E3B", "#022C22",
    extra='<ellipse cx="400" cy="430" rx="260" ry="60" fill="#052E16" opacity="0.7"/>'
          '<circle cx="400" cy="240" r="85" fill="#FFFFFF"/>'
          '<path d="M400 175 L432 200 L420 240 L380 240 L368 200 Z" fill="#111827"/>'
          '<path d="M400 175 L400 155 M432 200 L455 190 M420 240 L435 270 M380 240 L365 270 M368 200 L345 190" stroke="#111827" stroke-width="8"/>')

# music night
art("music", "#4C1D95", "#C084FC", "#FDE047", "#3B0764", "#2E1065",
    extra='<g fill="#FDE047">'
          '<circle cx="300" cy="200" r="46"/><rect x="336" y="120" width="16" height="126" rx="8"/>'
          '<rect x="336" y="120" width="90" height="22" rx="10"/>'
          '</g>'
          '<g fill="#F472B6">'
          '<circle cx="520" cy="260" r="38"/><rect x="548" y="196" width="13" height="102" rx="6"/>'
          '<rect x="548" y="196" width="72" height="18" rx="9"/>'
          '</g>')

# ───────────── Ads ─────────────
def ad(name, c1, c2, title, sub, emoji):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>
  </linearGradient></defs>
  <rect width="600" height="400" fill="url(#g)"/>
  <circle cx="520" cy="70" r="130" fill="#ffffff" opacity="0.10"/>
  <circle cx="80" cy="350" r="100" fill="#ffffff" opacity="0.08"/>
  <text x="60" y="140" font-family="Segoe UI Emoji, Segoe UI, sans-serif" font-size="110">{emoji}</text>
  <text x="60" y="260" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="800" fill="#ffffff">{title}</text>
  <text x="60" y="310" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#ffffff" opacity="0.9">{sub}</text>
  <rect x="60" y="336" width="170" height="38" rx="19" fill="#ffffff"/>
  <text x="145" y="362" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" fill="{c1}" text-anchor="middle">Learn more</text>
</svg>'''
    write(os.path.join(ADS, f"{name}.svg"), svg)


ad("bookpoint", "#7C3AED", "#4C1D95", "BookPoint UG", "Semester textbooks — up to 40% off", "&#128218;")
ad("mukdata",   "#0E7490", "#155E75", "MukData Bundles", "5GB night bundles for 2,000 UGX", "&#128246;")
ad("cafelatte", "#B45309", "#F59E0B", "Café Latte Hostel", "Executive hostels near campus", "&#9749;")

print("all assets generated")
