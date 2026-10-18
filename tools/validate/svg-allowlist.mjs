// Strict allowlist checker for the SVG text in content/exercise-images.json (issue #653). No dependencies, so the
// app can import or port it unchanged: a stored server copy of the bundle must pass the same rules (content README, rule 2).
//
// The frame is split into tags by a small tokenizer that refuses anything it cannot parse, then checked against
// a fixed element list, a fixed attribute list per element, always-double-quoted values, and colour rules.
// Refused outright: comments, CDATA, processing instructions, DOCTYPE, `url(` anywhere, a `:` in any element or
// attribute name, entities beyond the basic five, single-quoted or unquoted values, text outside <title>.

export const COLOUR_TOKENS = ['body', 'arm', 'hl', 'eq', 'bg'];
const COLOUR_OK = new RegExp(`^(none|currentColor|var\\(--fig-(${COLOUR_TOKENS.join('|')})\\))$`);
const NUM = /^-?\d+(\.\d+)?$/;
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]*$/;
const TRANSFORM = /^((translate|rotate|scale|matrix|skewX|skewY)\([-0-9.,\s]*\)\s*)+$/;

const num = (v) => NUM.test(v);
const COMMON = {
  fill: 'colour', stroke: 'colour', 'stroke-width': num, 'stroke-linecap': (v) => ['butt', 'round', 'square'].includes(v),
  'stroke-linejoin': (v) => ['miter', 'round', 'bevel'].includes(v), opacity: num, 'fill-opacity': num, 'stroke-opacity': num,
  transform: (v) => TRANSFORM.test(v),
};
const geom = (...names) => Object.fromEntries(names.map((n) => [n, num]));
export const ELEMENTS = {
  svg: { xmlns: (v) => v === 'http://www.w3.org/2000/svg', viewBox: (v) => /^0 0 \d+ \d+$/.test(v) },
  g: { ...COMMON },
  line: { ...COMMON, ...geom('x1', 'y1', 'x2', 'y2') },
  circle: { ...COMMON, ...geom('cx', 'cy', 'r') },
  ellipse: { ...COMMON, ...geom('cx', 'cy', 'rx', 'ry') },
  rect: { ...COMMON, ...geom('x', 'y', 'width', 'height', 'rx', 'ry') },
  path: { ...COMMON, d: (v) => PATH_D.test(v) },
  title: {},
};

const BAD_ENTITY = /&(?!(amp|lt|gt|quot|apos);)/;
const TAG_NAME = /[A-Za-z][A-Za-z0-9]*/y;
const ATTR = /[ \t\r\n]+([A-Za-z][A-Za-z0-9-]*)="([^"<>]*)"/y;
const CLOSE = /<\/([A-Za-z][A-Za-z0-9]*)[ \t\r\n]*>/y;

/** Returns { errors, viewBox } where viewBox is [w, h] from the parsed root tag, or null. */
export function parseSvgFrame(svg) {
  const errors = [];
  const fail = (m) => { errors.push(m); return { errors, viewBox: null }; };
  if (typeof svg !== 'string') return fail('svg must be a string');
  const stack = [];
  let root = null, rootClosed = false, viewBox = null, i = 0;
  while (i < svg.length) {
    if (svg[i] !== '<') {
      const j = svg.indexOf('<', i);
      const text = svg.slice(i, j < 0 ? svg.length : j);
      if (stack.at(-1) === 'title') { if (BAD_ENTITY.test(text) || />/.test(text)) return fail('title text has a bad entity or character'); }
      else if (/[^ \t\r\n]/.test(text)) return fail(`text outside <title> at offset ${i}`);
      i += text.length;
      continue;
    }
    if (/^<(!|\?)/.test(svg.slice(i, i + 2))) return fail('comments, CDATA, DOCTYPE and processing instructions are not allowed');
    CLOSE.lastIndex = i;
    const close = CLOSE.exec(svg);
    if (close) {
      if (stack.pop() !== close[1]) return fail(`unbalanced closing tag </${close[1]}>`);
      if (!stack.length) rootClosed = true;
      i = CLOSE.lastIndex;
      continue;
    }
    TAG_NAME.lastIndex = i + 1;
    const nm = TAG_NAME.exec(svg);
    if (!nm) return fail(`cannot parse a tag at offset ${i}`);
    const name = nm[0];
    if (!Object.hasOwn(ELEMENTS, name)) return fail(`element <${name}> is not allowed`);
    if (rootClosed) return fail('content after the closing </svg>');
    if (!root) { if (name !== 'svg') return fail('the root element must be <svg>'); root = name; }
    else if (name === 'svg') return fail('nested <svg> is not allowed');
    const allowed = ELEMENTS[name], seen = new Set();
    let pos = TAG_NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = pos;
      const a = ATTR.exec(svg);
      if (!a) break;
      const [, an, av] = a;
      if (seen.has(an)) return fail(`<${name}> repeats attribute ${an}`);
      seen.add(an);
      if (!Object.hasOwn(allowed, an)) return fail(`attribute ${an} is not allowed on <${name}>`);
      if (/url\s*\(/i.test(av)) return fail(`url( is not allowed (${an})`);
      if (BAD_ENTITY.test(av)) return fail(`bad entity in ${an}`);
      const rule = allowed[an];
      if (rule === 'colour') { if (!COLOUR_OK.test(av)) return fail(`bakes in a colour: ${an}="${av}" (use none, currentColor or var(--fig-${COLOUR_TOKENS.join('|')}))`); }
      else if (!rule(av)) return fail(`bad value for ${an} on <${name}>: "${av}"`);
      pos = ATTR.lastIndex;
    }
    const end = /^[ \t\r\n]*(\/?)>/.exec(svg.slice(pos));
    if (!end) return fail(`cannot parse the attributes of <${name}> at offset ${pos} (names must be plain, values double-quoted)`);
    i = pos + end[0].length;
    if (name === 'svg' && !stack.length) {
      const m = /^0 0 (\d+) (\d+)$/.exec(svg.slice(0, i).match(/ viewBox="([^"]*)"/)?.[1] ?? '');
      viewBox = m ? [Number(m[1]), Number(m[2])] : null;
    }
    if (end[1]) { if (name === 'svg') rootClosed = true; } else stack.push(name);
  }
  if (!root) return fail('empty svg');
  if (stack.length || !rootClosed) return fail('unclosed element');
  if (!viewBox) errors.push('the root <svg> needs viewBox="0 0 w h"');
  return { errors, viewBox };
}

/** @returns list of error strings; viewBox is checked on the parsed root only. */
export function checkSvgFrame(svg, w, h) {
  const { errors, viewBox } = parseSvgFrame(svg);
  if (!errors.length && Number.isInteger(w) && Number.isInteger(h) && (viewBox[0] !== w || viewBox[1] !== h)) errors.push(`svg viewBox must be "0 0 ${w} ${h}"`);
  return errors;
}
