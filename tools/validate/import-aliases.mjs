// Validator for content/import-aliases.json (issue #1296). Returns a list of error strings.
// Shape: { schema_version: 1, note?: string, aliases: { "<name as Strong or Hevy writes it>": "<exercise name in exercises.json tags>" } }.
import { nonEmpty } from './text.mjs';

/**
 * @param content parsed content/import-aliases.json
 * @param exerciseNames the names in content/exercises.json (tags)
 */
export function validateImportAliases(content, exerciseNames) {
  const errors = [];
  if (!content || typeof content !== 'object' || Array.isArray(content)) return ['bundle must be an object'];
  if (content.schema_version !== 1) errors.push('schema_version must be 1');
  for (const k of Object.keys(content)) if (!['schema_version', 'note', 'aliases'].includes(k)) errors.push(`unknown top-level field "${k}"`);
  if (content.note !== undefined && !nonEmpty(content.note)) errors.push('note must be non-empty text');
  const aliases = content.aliases;
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) return [...errors, 'aliases must be an object'];
  const names = new Set(exerciseNames);
  const seen = new Set();
  for (const [from, to] of Object.entries(aliases)) {
    if (!nonEmpty(from) || from !== from.trim()) errors.push(`alias "${from}": name must be trimmed, non-empty text`);
    if (names.has(from)) errors.push(`alias "${from}": is already a library exercise name`);
    const lower = from.toLowerCase();
    if (seen.has(lower)) errors.push(`alias "${from}": duplicates another alias ignoring case`);
    seen.add(lower);
    if (typeof to !== 'string' || !names.has(to)) errors.push(`alias "${from}": target "${String(to)}" is not an exercise in exercises.json`);
  }
  return errors;
}
