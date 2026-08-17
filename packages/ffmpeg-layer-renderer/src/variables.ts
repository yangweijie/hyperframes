/**
 * Resolve templating placeholders in a composition before parsing.
 *
 * Hyperframes compositions authored for Studio / the gallery use `__UPPER__`
 * placeholders (e.g. `__VIDEO_SRC__`, `__VIDEO_DURATION__`) that the render
 * pipeline substitutes at render time. The producer skips these (it treats
 * them as unresolved asset placeholders), but this renderer parses the HTML
 * before the producer runs, so it must substitute them first — otherwise
 * `data-duration="__VIDEO_DURATION__"` parses as `NaN`.
 *
 * Also supports the `<<token>>`, `{{ token }}`, and `${token}` templating
 * shapes recognised by `@hyperframes/parsers/asset-resolution`, so a single
 * substitution pass covers every placeholder form the ecosystem uses.
 */

export type VariableMap = Record<string, string | number | boolean>;

const UPPER_PLACEHOLDER = /__([A-Z][A-Z0-9_]*)__/g;
const MUSTACHE_PLACEHOLDER = /\{\{\s*([^{}\s]+)\s*\}\}/g;
const ANGLE_PLACEHOLDER = /<<([^<>]+)>>/g;
const DOLLAR_PLACEHOLDER = /\$\{([^{}]+)\}/g;

/**
 * Substitute known placeholders in an HTML string. Only placeholders with a
 * matching key in `variables` are replaced; unknown placeholders are left
 * untouched (the producer will skip them as unresolved, matching its own
 * behaviour for unfilled templating tokens).
 */
export function substituteVariables(
  html: string,
  variables: VariableMap,
): string {
  if (!variables || Object.keys(variables).length === 0) return html;

  let out = html;

  out = out.replace(UPPER_PLACEHOLDER, (full, name: string) => {
    const key = `__${name}__`;
    return variables[key] !== undefined ? String(variables[key]) : full;
  });

  const replaceShaped = (re: RegExp, keyOf: (name: string) => string) => {
    out = out.replace(re, (full, name: string) => {
      const key = keyOf(name);
      return variables[key] !== undefined ? String(variables[key]) : full;
    });
  };

  replaceShaped(MUSTACHE_PLACEHOLDER, (n) => n);
  replaceShaped(ANGLE_PLACEHOLDER, (n) => n);
  replaceShaped(DOLLAR_PLACEHOLDER, (n) => n);

  return out;
}
