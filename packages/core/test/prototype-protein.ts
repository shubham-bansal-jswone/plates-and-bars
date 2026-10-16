import { prototypeSource, sliceBlock, sliceLine } from './helpers';

export interface ProtoProtein {
  S: { weights: { entries: Record<string, number> }; settings: { protein: number; profile: { weight?: number } } };
  r1(n: number): number;
  proteinBody(): string;
}

/**
 * Prototype `KB.protein.b`, the "Why so much protein?" card body, sliced out of the HTML and run
 * against a fake `S` with the prototype's own `r1` and `latestWeight`. With a truthy weight the body
 * prints `At {r1(w)} kg, 1.6 g/kg is about {Math.round(w*1.6)} g.`, where
 * `w = latestWeight() || profile.weight`; with none it prints no "At …" sentence.
 */
export function loadProtein(): ProtoProtein {
  const src = prototypeSource();
  const arrow = sliceLine(src, '    b:() => { const w = latestWeight()')
    .trim()
    .replace(/^b:\s*/, '')
    .replace(/,$/, '');
  const code = [
    'const S = { weights:{ entries:{} }, settings:{ protein:150, profile:{} } };',
    sliceLine(src, 'const r1 = '),
    sliceBlock(src, 'function latestWeight(upTo){', '}'),
    `const proteinBody = ${arrow};`,
    'return { S, r1, proteinBody };',
  ].join('\n');
  return new Function(code)() as ProtoProtein;
}
