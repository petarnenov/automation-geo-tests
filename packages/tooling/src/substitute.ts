/**
 * The single template substitution mechanism for the GeoWealth E2E
 * monorepo, used by:
 *   1. Phase 0 Step 0.G.3 manual `expand-templates.ts` script.
 *   2. The Phase 1 `scaffold-team` CLI (D-26).
 *
 * Two callers, one implementation, no drift possible (D-34).
 *
 * Intentionally tiny and dependency-free:
 *   - `{{key}}` placeholders only.
 *   - No conditionals, no loops, no escaping rules.
 *   - Unknown placeholders left in place are an error (fail-fast).
 *
 * The placeholder syntax matches no real TypeScript / JSON syntax, so
 * template files can be authored as `*.tpl` (or any extension) without
 * breaking IDE syntax highlighting if `{{x}}` does not appear in the
 * surrounding language.
 */

export interface SubstituteVars {
  readonly [key: string]: string;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

/**
 * Replace every `{{key}}` placeholder in `template` with the corresponding
 * value from `vars`. Throws if any placeholder remains unfilled.
 *
 * @param template Source text (file contents).
 * @param vars     Map of placeholder names → values.
 * @returns Substituted text.
 * @throws Error If `template` contains a placeholder absent from `vars`.
 */
export function substitute(template: string, vars: SubstituteVars): string {
  const missing = new Set<string>();
  const out = template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key];
    }
    missing.add(key);
    return match;
  });
  if (missing.size > 0) {
    throw new Error(
      `substitute: template references undefined placeholder(s): ${[...missing]
        .map((k) => `{{${k}}}`)
        .join(', ')}. Provide values via the vars argument.`
    );
  }
  return out;
}
