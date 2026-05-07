// Unified check glyphs for consistent visuals across the app.

const CHECK_PATH = 'M1.2 5.2L4 8L8.8 2.2';
const DOUBLE_CHECK_SECOND_PATH = 'M6.8 5.2L9.6 8L14.4 2.2';

const SINGLE_CHECK_SVG = `<svg viewBox="0 0 10 10" focusable="false"><path d="${CHECK_PATH}"></path></svg>`;
const DOUBLE_CHECK_SVG = `<svg viewBox="0 0 16 10" focusable="false"><path d="${CHECK_PATH}"></path><path d="${DOUBLE_CHECK_SECOND_PATH}"></path></svg>`;

export const STANDARD_SINGLE_CHECK_TICK_HTML = `<span class="sun-check-glyph tick-glyph tick-glyph--single sun-check-glyph--single" aria-hidden="true">${SINGLE_CHECK_SVG}</span>`;
export const STANDARD_DOUBLE_CHECK_TICK_HTML = `<span class="sun-check-glyph tick-glyph tick-glyph--double sun-check-glyph--double" aria-hidden="true">${DOUBLE_CHECK_SVG}</span>`;
export const STANDARD_SINGLE_CHECK_UI_HTML = `<span class="sun-check-glyph sun-check-glyph--single sun-check-glyph--ui" aria-hidden="true">${SINGLE_CHECK_SVG}</span>`;
