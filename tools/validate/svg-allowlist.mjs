// Strict allowlist checker for the SVG text in content/exercise-images.json (issue #653). No dependencies, so the
// app can import or port it unchanged: a stored server copy of the bundle must pass the same rules (content README, rule 2).
//
// The frame is split into tags by a small tokenizer that refuses anything it cannot parse, then checked against
// a fixed element list, a fixed attribute list per element, always-double-quoted values, and colour rules.
// Content model: title holds text only, shapes are empty, only svg and g contain elements.
// Refused outright: comments, CDATA, processing instructions, DOCTYPE, `url(` anywhere, a `:` in any element or
// attribute name, entities beyond the basic five, single-quoted or unquoted values, text outside <title>.

export const COLOUR_TOKENS = ['body', 'arm', 'hl', 'eq', 'bg'];
const COLOUR_OK = new RegExp(`^(none|currentColor|var\\(--fig-(${COLOUR_TOKENS.join('|')})\\))$`);
// Numbers are plain decimals of at most 6 integer and 6 fraction digits: no exponent, no Infinity, no 400-digit values.
const NUM = /^-?\d{1,6}(\.\d{1,6})?$/;
const POS = /^\d{1,6}(\.\d{1,6})?$/;
const OPACITY = /^(0(\.\d{1,6})?|1(\.0{1,6})?)$/;

export const MAX_SVG_BYTES = 8192;
/** UTF-8 byte length without Buffer, so the app can cap input before calling parseSvgFrame. */
export const svgByteLength = (svg) => new TextEncoder().encode(String(svg)).length;

// Path data: a command letter, then numbers (count a multiple of the command's arity; none for Z).
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const PATH_TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d{1,6}(?:\.\d{1,6})?)|([ \t\r\n,]+)/y;
function pathOk(d) {
  let cmd = null, count = 0, pos = 0, any = false;
  const closeCmd = () => cmd === null || (ARITY[cmd.toUpperCase()] === 0 ? count === 0 : count > 0 && count % ARITY[cmd.toUpperCase()] === 0);
  while (pos < d.length) {
    PATH_TOKEN.lastIndex = pos;
    const m = PATH_TOKEN.exec(d);
    if (!m) return false;
    pos = PATH_TOKEN.lastIndex;
    if (m[1]) { if (!closeCmd()) return false; cmd = m[1]; count = 0; any = true; }
    else if (m[2]) { if (cmd === null) return false; count++; }
  }
  return any && closeCmd();
}

const TRANSFORM_ARGS = { translate: [1, 2], rotate: [1, 3], scale: [1, 2], matrix: [6], skewX: [1], skewY: [1] };
function transformOk(v) {
  const re = /(translate|rotate|scale|matrix|skewX|skewY)\(([^()]*)\)[ \t\r\n,]*/y;
  let pos = 0;
  if (!v.length) return false;
  while (pos < v.length) {
    re.lastIndex = pos;
    const m = re.exec(v);
    if (!m) return false;
    const args = m[2].trim().split(/[ \t\r\n,]+/);
    if (!TRANSFORM_ARGS[m[1]].includes(args.length) || !args.every((a) => NUM.test(a))) return false;
    pos = re.lastIndex;
  }
  return true;
}

const num = (v) => NUM.test(v);
const pos = (v) => POS.test(v);
const COMMON = {
  fill: 'colour', stroke: 'colour', 'stroke-width': pos, 'stroke-linecap': (v) => ['butt', 'round', 'square'].includes(v),
  'stroke-linejoin': (v) => ['miter', 'round', 'bevel'].includes(v), opacity: (v) => OPACITY.test(v), 'fill-opacity': (v) => OPACITY.test(v),
  'stroke-opacity': (v) => OPACITY.test(v), transform: transformOk,
};
const rule = (fn, ...names) => Object.fromEntries(names.map((n) => [n, fn]));
export const ELEMENTS = {
  svg: { xmlns: (v) => v === 'http://www.w3.org/2000/svg', viewBox: (v) => /^0 0 \d{1,4} \d{1,4}$/.test(v) },
  g: { ...COMMON },
  line: { ...COMMON, ...rule(num, 'x1', 'y1', 'x2', 'y2') },
  circle: { ...COMMON, ...rule(num, 'cx', 'cy'), r: pos },
  ellipse: { ...COMMON, ...rule(num, 'cx', 'cy'), ...rule(pos, 'rx', 'ry') },
  rect: { ...COMMON, ...rule(num, 'x', 'y'), ...rule(pos, 'width', 'height', 'rx', 'ry') },
  path: { ...COMMON, d: pathOk },
  title: {},
};
// Content model: only svg and g contain elements; title holds text only; the shapes are empty.
const CONTAINERS = ['svg', 'g'];

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
  const rootAttrs = {};
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
    if (stack.length && !CONTAINERS.includes(stack.at(-1))) return fail(`<${name}> is not allowed inside <${stack.at(-1)}> (only svg and g contain elements)`);
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
      if (name === 'svg') rootAttrs[an] = av;
      pos = ATTR.lastIndex;
    }
    const end = /^[ \t\r\n]*(\/?)>/.exec(svg.slice(pos));
    if (!end) return fail(`cannot parse the attributes of <${name}> at offset ${pos} (names must be plain, values double-quoted)`);
    i = pos + end[0].length;
    if (end[1]) { if (name === 'svg') rootClosed = true; } else stack.push(name);
  }
  if (!root) return fail('empty svg');
  if (stack.length || !rootClosed) return fail('unclosed element');
  const vb = /^0 0 (\d+) (\d+)$/.exec(rootAttrs.viewBox ?? '');
  if (!vb) return fail('the root <svg> needs viewBox="0 0 w h"');
  if (rootAttrs.xmlns === undefined) return fail('the root <svg> needs xmlns="http://www.w3.org/2000/svg"');
  viewBox = [Number(vb[1]), Number(vb[2])];
  return { errors, viewBox };
}

/** @returns list of error strings; viewBox is checked on the parsed root only. */
export function checkSvgFrame(svg, w, h) {
  const { errors, viewBox } = parseSvgFrame(svg);
  if (!errors.length && Number.isInteger(w) && Number.isInteger(h) && (viewBox[0] !== w || viewBox[1] !== h)) errors.push(`svg viewBox must be "0 0 ${w} ${h}"`);
  return errors;
}
