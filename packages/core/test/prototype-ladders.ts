import { loadGolden, prototypeSource, sliceBlock, sliceLine } from './helpers';
import type { MetaTable } from './prototype-plan';

/** A rule as the prototype stores it in `settings.excl` (with the fields the cards and actions read). */
export interface ProtoRule {
  id: string;
  name?: string;
  scope: string;
  key: string;
  reason: string | null;
  created?: string;
  until: string | null;
  to: Record<string, string | null>;
  done?: boolean;
}

export interface ProtoExercise {
  name: string;
  sets: { w: string; r: string; done: boolean }[];
  bridge?: boolean;
}

export interface ProtoLadderState {
  date: string;
  where: string;
  lifts: Record<string, unknown>;
  settings: {
    excl: ProtoRule[];
    repl: Record<string, { to: string; bridgeUntil?: string; since?: string }>;
    returning: Record<string, { until: string }>;
    ladderStay: Record<string, string>;
    adj: { declines?: Record<string, number>; muted?: Record<string, boolean>; dismissed?: Record<string, boolean> };
    ex: Record<string, unknown>;
  };
  day: { workout: { where?: string; exercises: ProtoExercise[] } };
}

export interface ProtoCX {
  i: number | null;
  name: string;
  step: string;
  reason: string;
  dur: string;
  scope: string;
  key: string;
}

export interface ProtoLadders {
  S: ProtoLadderState;
  CX: ProtoCX;
  ladderOf(name: string): { key: string; label: string; steps: string[][]; i: number } | null;
  nextStep(name: string): string | null;
  prevStep(name: string): string | null;
  sidewaysOf(name: string): string | null;
  estimateFor(name: string): { from: string; fromW: number; w: number } | null;
  ladderCard(ex: ProtoExercise): string;
  recheckCards(): string;
  applyCant(choice: string | null): void;
  exAction(a: string, b: { dataset: Record<string, string> }): void;
}

/**
 * Runs the prototype's ladder, re-check and "can't do" functions (`ladderOf`, `nextStep`, `prevStep`,
 * `sidewaysOf`, `estimateFor`, `ladderCard`, `recheckCards`, `applyCant`, `exAction`) sliced out of
 * the HTML against a fake `S`, with `TAGS`, `AWAY` and `LADDERS` from golden/exercises.json and
 * `EX_META` passed in. UI calls are stubbed (`whyLink`, `saveSettings`, `saveDay`, `render`, `toast`,
 * `sheet.close`, `shortDate`); `newId` counts up.
 */
export function loadLadders(meta: MetaTable): ProtoLadders {
  const g = loadGolden<{ tags: Record<string, unknown>; ladders: Record<string, unknown>; awayMap_dumbbells_bodyweight: Record<string, unknown> }>('exercises');
  const src = prototypeSource();
  const code = [
    'const S = { date:"", where:"gym", lifts:{}, settings:{}, day:{ workout:{ exercises:[] } } };',
    'let ids = 0; const newId = () => "id" + (++ids);',
    'const whyLink = () => "", saveSettings = () => {}, saveDay = () => {}, render = () => {}, toast = () => {}, sheet = { close(){} };',
    'const shortDate = s => s, whereNow = () => S.where;',
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const DEFAULT_STEP = '),
    sliceBlock(src, 'function exInfo(name){', '}'),
    sliceLine(src, 'function snap(x, step){'),
    sliceBlock(src, 'function lastFor(name){', '}'),
    sliceBlock(src, 'function newExercise(name){', '}'),
    sliceLine(src, 'const adjState = '),
    sliceBlock(src, 'function adjButtons(', '}'),
    sliceLine(src, 'const MUSCLE = '),
    sliceLine(src, 'const JOINT = '),
    sliceLine(src, 'const PATTERN = '),
    sliceLine(src, 'const FAMILY = '),
    sliceBlock(src, 'function ladderOf(name){', '}'),
    sliceBlock(src, 'const PAIR = {', '};'),
    sliceBlock(src, 'function estimateFor(name){', '}'),
    sliceLine(src, 'const ruleState = '),
    sliceBlock(src, 'function ruleMatches(r, name){', '}'),
    sliceLine(src, 'const activeRules = '),
    sliceLine(src, 'const isExcluded = '),
    sliceLine(src, 'const listJoin = '),
    sliceBlock(src, 'function candidates(name, o = {}){', '}'),
    sliceLine(src, 'const CX = '),
    sliceBlock(src, 'function applyCant(choice){', '}'),
    sliceBlock(src, 'function ruleText(r){', '}'),
    sliceLine(src, 'function nextStep(name){'),
    sliceLine(src, 'function prevStep(name){'),
    sliceBlock(src, 'function ladderCard(ex){', '}'),
    sliceBlock(src, 'function sidewaysOf(name){', '}'),
    sliceBlock(src, 'function recheckCards(){', '}'),
    sliceBlock(src, 'function exAction(a, b){', '}'),
    'return { S, CX, ladderOf, nextStep, prevStep, sidewaysOf, estimateFor, ladderCard, recheckCards, applyCant, exAction };',
  ].join('\n');
  return new Function('TAGS', 'AWAY', 'LADDERS', 'EX_META', code)(g.tags, g.awayMap_dumbbells_bodyweight, g.ladders, meta) as ProtoLadders;
}
