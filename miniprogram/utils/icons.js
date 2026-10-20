/* Cute icons, copied verbatim from the web app (src/main/resources/static/app.js), rendered as SVG data URIs. */
const THEMES = {
  light: { surface: '#fcfcfb', accent: '#6d3fd6', 'accent-soft': '#e9e0fd', lime: '#c5e84a', 'lime-ink': '#1f2a05', 'lime-line': '#5a8f0e', pink: '#ec7a9c', 'pink-soft': '#ffe3eb', face: '#2b2140' },
  dark: { surface: '#1a1a19', accent: '#9b7bf2', 'accent-soft': '#33245e', lime: '#c5e84a', 'lime-ink': '#1f2a05', 'lime-line': '#c5e84a', pink: '#f59ab5', 'pink-soft': '#4a2a37', face: '#ffffff' },
};

const FACE = 'fill="none" stroke="var(--face)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
const eyes = (y, l = 10, r = 14) => `<circle cx="${l}" cy="${y}" r=".95" fill="var(--face)"/><circle cx="${r}" cy="${y}" r=".95" fill="var(--face)"/>`;
const smile = (y, l = 10.6, r = 13.4) => `<path d="M${l} ${y}q${(r - l) / 2} 1.3 ${r - l} 0" ${FACE}/>`;
const blush = (y, l = 7.6, r = 16.4) => `<ellipse cx="${l}" cy="${y}" rx="1.2" ry=".7" fill="var(--pink)" opacity=".55"/><ellipse cx="${r}" cy="${y}" rx="1.2" ry=".7" fill="var(--pink)" opacity=".55"/>`;
const LINE = 'stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"';

const ICONS = {
  // 小失误：叉叉眼 + 波浪嘴
  oops: `<circle cx="12" cy="12" r="9.5" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    <path d="M8.2 8.8l2 2M10.2 8.8l-2 2M13.8 8.8l2 2M15.8 8.8l-2 2" ${FACE}/>
    <path d="M9.2 15.6c.7-.8 1.3-.8 1.9 0s1.2.8 1.9 0 1.3-.8 1.9 0" ${FACE}/>${blush(13.2, 6.8, 17.2)}`,
  // 完成：眯眼笑
  happy: `<circle cx="12" cy="12" r="9.5" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
    <path d="M8.3 10.6q1.2-1.6 2.4 0M13.3 10.6q1.2-1.6 2.4 0" ${FACE} style="--face:var(--lime-ink)"/>
    <path d="M9.4 13.6q2.6 2.8 5.2 0" ${FACE} style="--face:var(--lime-ink)"/>${blush(13.3, 7, 17)}`,
  star: `<path d="M12 2.8l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.1l-5.2 2.8 1-5.8L3.5 9l5.9-.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
    <g style="--face:var(--lime-ink)">${eyes(10.8, 10.4, 13.6)}${smile(12.9, 11, 13)}</g>`,
  flag: `<path d="M5.5 21V3.8" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M5.5 4.3h12.2l-2.6 4 2.6 4H5.5" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
    <g style="--face:var(--lime-ink)">${eyes(7.8, 9, 12)}${smile(9.6, 9.6, 11.4)}</g>`,
  bubble: `<path d="M7 4.5h10a4 4 0 0 1 4 4v4.5a4 4 0 0 1-4 4h-6.2L7 20v-3.1A4 4 0 0 1 3 13V8.5a4 4 0 0 1 4-4z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    ${eyes(10, 9.3, 14.7)}<circle cx="12" cy="13" r="1" fill="none" stroke="var(--face)" stroke-width="1.3"/>${blush(12, 6.8, 17.2)}`,
  flask: `<path d="M9.6 3.2h4.8M10.6 3.2v5.6L5.3 18.2a1.9 1.9 0 0 0 1.7 2.8h10a1.9 1.9 0 0 0 1.7-2.8L13.4 8.8V3.2" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M7.4 14.6h9.2l2.1 3.6a1.9 1.9 0 0 1-1.7 2.8H7a1.9 1.9 0 0 1-1.7-2.8z" fill="var(--lime)"/>
    <circle cx="11.3" cy="11.2" r=".8" fill="var(--accent)"/><circle cx="12.9" cy="8.9" r=".6" fill="var(--accent)"/>
    <g style="--face:var(--lime-ink)">${eyes(17.2, 10.2, 13.8)}${smile(18.7, 11.1, 12.9)}</g>`,
  book: `<rect x="4.5" y="3" width="14" height="18" rx="2.6" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M7.7 3.2v17.6" stroke="var(--accent)" stroke-width="1.4"/>
    <path d="M14 3v5l1.5-1.1L17 8V3" fill="var(--lime)" stroke="var(--lime-line)" stroke-width="1" stroke-linejoin="round"/>
    ${eyes(11.8, 11.2, 15)}${smile(14, 12.1, 14.1)}${blush(13.4, 10, 16.2)}`,
  pencil: `<path d="M15.2 4.8l4 4L9.4 18.6 4.6 19.4l.8-4.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
    <path d="M15.2 4.8l1.3-1.3a1.6 1.6 0 0 1 2.3 0l1.7 1.7a1.6 1.6 0 0 1 0 2.3l-1.3 1.3z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    <path d="M5.4 14.6l4 4" stroke="var(--lime-line)" stroke-width="1.2"/>
    <g style="--face:var(--lime-ink)"><circle cx="10.6" cy="11.4" r=".85" fill="var(--face)"/><circle cx="12.6" cy="13.4" r=".85" fill="var(--face)"/></g>`,
  flame: `<path d="M12 21.2c-3.9 0-6.4-2.6-6.4-6 0-3.3 2.5-5.1 3.7-8.1.5 1.8 1.5 2.9 2.6 3.1-.3-2.6.8-5.1 2.9-7 .3 2.9 3.6 5.4 3.6 9.8 0 3.9-2.6 8.2-6.4 8.2z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    ${eyes(15, 10.3, 13.7)}${smile(17.1, 10.9, 13.1)}`,
  code: `<rect x="3.5" y="4" width="17" height="16" rx="4.5" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M8.2 9.2L6.4 11l1.8 1.8M15.8 9.2l1.8 1.8-1.8 1.8" fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    ${eyes(10.8, 10.4, 13.6)}${smile(13.6, 11, 13)}${blush(14.6, 8.4, 15.6)}`,
  heart: `<path d="M12 20s-7.6-4.6-7.6-10.1A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.6 2.5C19.6 15.4 12 20 12 20z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    ${eyes(11.6, 9.8, 14.2)}${smile(13.7, 11, 13)}`,
};

// more cute icons, mostly for notes (see EMOJI_ICONS below)
Object.assign(ICONS, {
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="3.5" fill="var(--surface)" stroke="var(--accent)" ${LINE}/>
    <path d="M3.5 8.5a3.5 3.5 0 0 1 3.5-3.5h10a3.5 3.5 0 0 1 3.5 3.5V10h-17z" fill="var(--lime)" stroke="var(--accent)" ${LINE}/>
    <path d="M8 3.5v3M16 3.5v3" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>
    ${eyes(14.3, 10.2, 13.8)}${smile(16.4, 10.8, 13.2)}${blush(16, 7.8, 16.2)}`,
  link: `<rect x="2.8" y="8.2" width="10.5" height="7.6" rx="3.8" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <rect x="10.7" y="8.2" width="10.5" height="7.6" rx="3.8" fill="var(--lime)" fill-opacity=".55" stroke="var(--lime-line)" stroke-width="2"/>
    <g style="--face:var(--lime-ink)">${eyes(11.4, 15, 17.4)}${smile(13, 15.4, 17)}</g>`,
  bulb: `<path d="M12 2.8a6.6 6.6 0 0 0-3.9 11.9c.7.6 1.1 1.3 1.1 2.1v.7h5.6v-.7c0-.8.4-1.5 1.1-2.1A6.6 6.6 0 0 0 12 2.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
    <path d="M9.6 19.4h4.8M10.3 21.2h3.4" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>
    <g style="--face:var(--lime-ink)">${eyes(9.4, 10.3, 13.7)}${smile(11.6, 11, 13)}</g>${blush(11.2, 8.4, 15.6)}`,
  pin: `<path d="M12 14.5v7" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="9" r="6.3" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    ${eyes(8.6, 10.3, 13.7)}${smile(10.8, 11, 13)}${blush(10.2, 7.9, 16.1)}`,
  target: `<circle cx="12" cy="12" r="9.3" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    <circle cx="12" cy="12" r="5.8" fill="var(--surface)" stroke="var(--pink)" stroke-width="1.3"/>
    ${eyes(11, 10.3, 13.7)}${smile(13.1, 11, 13)}`,
  chart: `<rect x="3" y="3.5" width="18" height="17" rx="4" fill="var(--surface)" stroke="var(--accent)" ${LINE}/>
    <rect x="6.3" y="12" width="3" height="5.5" rx="1.2" fill="var(--pink)"/>
    <rect x="10.5" y="8.5" width="3" height="9" rx="1.2" fill="var(--accent)"/>
    <rect x="14.7" y="6" width="3" height="11.5" rx="1.2" fill="var(--lime-line)"/>`,
  warn: `<path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.4 12.9a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    ${eyes(13.2, 10.3, 13.7)}<path d="M11 16.6q1-.9 2 0" ${FACE}/>${blush(15.4, 8.3, 15.7)}`,
  search: `<circle cx="10.2" cy="10.2" r="6.6" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M15 15l5.2 5.2" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round"/>
    ${eyes(9.4, 8.6, 11.8)}${smile(11.6, 9.2, 11.2)}`,
  bug: `<path d="M12 5.5v15M6.2 9.5l-2.4-1.4M17.8 9.5l2.4-1.4M5.8 14H3.2M18.2 14h2.6M6.4 18.2l-2 1.6M17.6 18.2l2 1.6" stroke="var(--face)" stroke-width="1.3" stroke-linecap="round"/>
    <ellipse cx="12" cy="13.8" rx="6.3" ry="7" fill="var(--pink)" stroke="var(--pink)" stroke-width="1.2"/>
    <path d="M12 7.2v13.5" stroke="var(--face)" stroke-width="1.1"/>
    <circle cx="9.2" cy="15.6" r="1.1" fill="var(--face)"/><circle cx="14.8" cy="15.6" r="1.1" fill="var(--face)"/>
    <circle cx="12" cy="6.4" r="3.4" fill="var(--pink-soft)" stroke="var(--pink)" stroke-width="1.2"/>
    <circle cx="10.8" cy="6.2" r=".7" fill="var(--face)"/><circle cx="13.2" cy="6.2" r=".7" fill="var(--face)"/>`,
  globe: `<circle cx="12" cy="12" r="9.3" fill="color-mix(in srgb, var(--lime) 45%, var(--surface))" stroke="var(--lime-line)" ${LINE}/>
    <path d="M2.9 12h18.2M12 2.7c2.6 2.6 3.8 5.7 3.8 9.3s-1.2 6.7-3.8 9.3M12 2.7C9.4 5.3 8.2 8.4 8.2 12s1.2 6.7 3.8 9.3" fill="none" stroke="var(--lime-line)" stroke-width="1.1"/>`,
  clock: `<circle cx="12" cy="12.5" r="8.8" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M12 7.6v5l3 1.8" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M9 2.6h6" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>${blush(16.2, 7, 17)}`,
  shield: `<path d="M12 2.8l7.5 3v5.6c0 4.9-3.2 8.3-7.5 9.8-4.3-1.5-7.5-4.9-7.5-9.8V5.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
    <g style="--face:var(--lime-ink)">${eyes(10.8, 10.2, 13.8)}${smile(13.4, 10.9, 13.1)}</g>${blush(12.6, 7.9, 16.1)}`,
  sword: `<path d="M18.8 3.2l2 2-10.3 10.3-2-2z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M6.2 13.4l4.4 4.4M8.6 15.8l-3.9 3.9" stroke="var(--pink)" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="4.2" cy="20.2" r="1.3" fill="var(--pink)"/>`,
  wrench: `<path d="M14.8 3.5a4.8 4.8 0 0 0-4.4 6.6l-6.6 6.6a1.9 1.9 0 0 0 2.7 2.7l6.6-6.6a4.8 4.8 0 0 0 6.6-4.4l-2.9 1.4-2.2-.6-.6-2.2z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <circle cx="5.4" cy="18.4" r=".9" fill="var(--accent)"/>`,
  question: `<path d="M7 4.5h10a4 4 0 0 1 4 4v4.5a4 4 0 0 1-4 4h-6.2L7 20v-3.1A4 4 0 0 1 3 13V8.5a4 4 0 0 1 4-4z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    <path d="M10.2 8.6a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.7-.8 1.3v.4" fill="none" stroke="var(--face)" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="12" cy="14.2" r=".9" fill="var(--face)"/>`,
  rocket: `<path d="M12 2.8c3.4 2.2 5 5.6 4.6 10.2l-2.3 2.8H9.7l-2.3-2.8C7 8.4 8.6 5 12 2.8z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M7.6 12.5L5 15.8l3.6-.3M16.4 12.5l2.6 3.3-3.6-.3" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    <path d="M10.4 17.6q1.6 3.4 3.2 0" fill="var(--lime)" stroke="var(--lime-line)" stroke-width="1.2"/>
    ${eyes(9.4, 10.6, 13.4)}${smile(11.4, 11.2, 12.8)}`,
  eye: `<path d="M2.8 12c2.4-4.2 5.5-6.3 9.2-6.3s6.8 2.1 9.2 6.3c-2.4 4.2-5.5 6.3-9.2 6.3S5.2 16.2 2.8 12z" fill="var(--surface)" stroke="var(--accent)" ${LINE}/>
    <circle cx="12" cy="12" r="3.6" fill="var(--accent)"/><circle cx="13.2" cy="10.8" r="1.1" fill="#fff"/>`,
  trash: `<path d="M5.5 7.5h13l-1.1 11.6a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    <path d="M4 7.5h16M9.5 7.5V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.3" fill="none" stroke="var(--pink)" stroke-width="1.5" stroke-linecap="round"/>
    ${eyes(12.8, 10.2, 13.8)}<path d="M11 16.2q1-.8 2 0" ${FACE}/>`,
  folder: `<path d="M3 7a2.2 2.2 0 0 1 2.2-2.2h4.3l2 2.2h7.3A2.2 2.2 0 0 1 21 9.2v8.6a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.8z" fill="var(--lime)" stroke="var(--lime-line)" ${LINE}/>
    <g style="--face:var(--lime-ink)">${eyes(13, 10.2, 13.8)}${smile(15.2, 11, 13)}</g>${blush(14.8, 7.8, 16.2)}`,
  tag: `<path d="M3.5 4.8v6.1a2 2 0 0 0 .6 1.4l8.3 8.3a2 2 0 0 0 2.8 0l5.4-5.4a2 2 0 0 0 0-2.8l-8.3-8.3a2 2 0 0 0-1.4-.6H4.8a1.3 1.3 0 0 0-1.3 1.3z" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    <circle cx="7.8" cy="8.3" r="1.5" fill="var(--surface)" stroke="var(--pink)" stroke-width="1.2"/>
    ${eyes(13.4, 12.4, 15.2)}`,
  person: `<circle cx="12" cy="8.6" r="4.6" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M4.2 20.4c.6-4 3.8-6.6 7.8-6.6s7.2 2.6 7.8 6.6z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    ${eyes(8.5, 10.4, 13.6)}${smile(10.3, 11.1, 12.9)}`,
  house: `<path d="M3.8 11.2L12 4l8.2 7.2V19a1.8 1.8 0 0 1-1.8 1.8H5.6A1.8 1.8 0 0 1 3.8 19z" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <rect x="10" y="15.4" width="4" height="5.4" rx="1" fill="var(--lime)" stroke="var(--lime-line)" stroke-width="1.2"/>
    ${eyes(11.4, 10, 14)}${smile(13, 11.1, 12.9)}`,
  cycle: `<path d="M19.5 10.2A7.8 7.8 0 0 0 5.4 7.4M4.5 13.8a7.8 7.8 0 0 0 14.1 2.8" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
    <path d="M5 3.8v3.9h3.9M19 20.2v-3.9h-3.9" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${eyes(11.3, 10.3, 13.7)}${smile(13.3, 11, 13)}`,
  battery: `<rect x="2.8" y="7" width="16" height="10.5" rx="3" fill="var(--surface)" stroke="var(--accent)" ${LINE}/>
    <rect x="4.6" y="8.8" width="9.4" height="6.9" rx="1.6" fill="var(--lime)"/>
    <path d="M20.6 10.3v3.9" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
    <g style="--face:var(--lime-ink)">${eyes(11.6, 7.8, 10.8)}${smile(13.6, 8.3, 10.3)}</g>`,
  compass: `<circle cx="12" cy="12" r="9.3" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M12 5.2l2.4 6.8H9.6z" fill="var(--pink)"/><path d="M12 18.8l-2.4-6.8h4.8z" fill="var(--surface)" stroke="var(--accent)" stroke-width=".9"/>
    <circle cx="12" cy="12" r="1.2" fill="var(--accent)"/>`,
  briefcase: `<rect x="3" y="7.5" width="18" height="12.5" rx="3" fill="var(--accent-soft)" stroke="var(--accent)" ${LINE}/>
    <path d="M9 7.5V5.6a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 15 5.6v1.9" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
    <rect x="10.4" y="11.2" width="3.2" height="2.2" rx=".6" fill="var(--lime)"/>
    ${eyes(15.6, 9.2, 14.8)}${smile(17.2, 11, 13)}`,
  dot: `<circle cx="12" cy="12" r="8.5" fill="var(--c, var(--lime))" stroke="var(--face)" stroke-opacity=".25" stroke-width="1"/>
    <g style="--face:#2b2140">${eyes(11, 10.2, 13.8)}${smile(13.4, 10.9, 13.1)}</g>`,
  cross: `<circle cx="12" cy="12" r="9.5" fill="var(--pink-soft)" stroke="var(--pink)" ${LINE}/>
    <path d="M9 9l6 6M15 9l-6 6" stroke="var(--pink)" stroke-width="2.2" stroke-linecap="round"/>`,
});

// emoji → cute icon, applied to note text (never inside code)
const EMOJI_ICONS = {
  '📘': 'book', '📖': 'book', '📚': 'book', '📄': 'book', '📗': 'book', '📕': 'book',
  '📅': 'calendar', '🗓': 'calendar', '📆': 'calendar',
  '⭐': 'star', '🌟': 'star', '🏆': 'star', '✨': 'star',
  '🔗': 'link', '💡': 'bulb', '📌': 'pin', '📍': 'pin', '🎯': 'target',
  '📊': 'chart', '📈': 'chart', '⚠': 'warn', '🚨': 'warn',
  '🔍': 'search', '🔎': 'search', '🐞': 'bug', '🐛': 'bug', '🌐': 'globe',
  '⏱': 'clock', '⏰': 'clock', '🕐': 'clock', '🧪': 'flask', '🔬': 'flask',
  '🧰': 'wrench', '🛠': 'wrench', '🔧': 'wrench', '🛡': 'shield', '🗡': 'sword', '⚔': 'sword',
  '🧠': 'bubble', '💬': 'bubble', '🗣': 'bubble', '❓': 'question', '🤔': 'question',
  '🧩': 'code', '💻': 'code', '👍': 'happy', '✅': 'happy', '😊': 'happy', '🎉': 'happy',
  '👎': 'oops', '😵': 'oops', '❌': 'cross', '🔋': 'battery', '🧭': 'compass',
  '💼': 'briefcase', '🏢': 'house', '🏠': 'house', '👤': 'person', '🙋': 'person',
  '🔁': 'cycle', '🔄': 'cycle', '📂': 'folder', '📁': 'folder', '🏷': 'tag',
  '✏': 'pencil', '📝': 'pencil', '✍': 'pencil', '🔤': 'pencil', '✂': 'pencil',
  '🚀': 'rocket', '👁': 'eye', '🗑': 'trash', '🔥': 'flame', '❤': 'heart', '💜': 'heart',
  '🟡': 'dot:#f5c542', '🟢': 'dot:var(--lime)', '🔴': 'dot:var(--pink)',
};

// color-mix(in srgb, a p%, b)
function mix(a, b, p) {
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map(i => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(s) { // the SVG sources are pure ASCII
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const n = (s.charCodeAt(i) << 16) | ((s.charCodeAt(i + 1) || 0) << 8) | (s.charCodeAt(i + 2) || 0);
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < s.length ? B64[n >> 6 & 63] : '=') + (i + 2 < s.length ? B64[n & 63] : '=');
  }
  return out;
}

let theme = 'light';
try { theme = wx.getAppBaseInfo().theme === 'dark' ? 'dark' : 'light'; } catch (e) { /* not in a mini program */ }
const cache = {};

// the web app overrides --face per group / element; resolve that, then every other CSS variable
function resolve(svg, pal, c) {
  return svg
    .replace(/<g style="--face:([^"]+)">([\s\S]*?)<\/g>/g, (_, f, inner) => `<g>${inner.split('var(--face)').join(f)}</g>`)
    .replace(/<(path|circle)([^>]*?) style="--face:([^"]+)"\/>/g, (_, tag, attrs, f) => `<${tag}${attrs.split('var(--face)').join(f)}/>`)
    .replace(/color-mix\(in srgb, var\(--lime\) 45%, var\(--surface\)\)/g, mix(pal.lime, pal.surface, 0.45))
    .replace(/var\(--c, var\(--lime\)\)/g, c || 'var(--lime)')
    .replace(/var\(--([a-z-]+)\)/g, (_, k) => pal[k]);
}

function icon(name, color) {
  const key = `${theme}:${name}:${color || ''}`;
  if (!cache[key]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${resolve(ICONS[name], THEMES[theme], color).replace(/\s*\n\s*/g, ' ')}</svg>`;
    cache[key] = 'data:image/svg+xml;base64,' + base64(svg);
  }
  return cache[key];
}

// "📘" → data URI of its cute icon
function emojiIcon(emoji) {
  const [name, color] = EMOJI_ICONS[emoji.replace(/\uFE0F/g, '')].split(':');
  return icon(name, color);
}

module.exports = { icon, emojiIcon, EMOJI_RE: new RegExp(`(${Object.keys(EMOJI_ICONS).join('|')})\\uFE0F?`, 'g') };
