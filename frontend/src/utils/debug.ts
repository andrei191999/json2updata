/**
 * Call:   debug("hash", "worker", id, time)
 *
 * Enable everything:     localStorage.DEBUG="*"
 * Enable some scopes:    localStorage.DEBUG="hash,link-fail"
 * Disable:               localStorage.removeItem("DEBUG")
 */

type Scope = string;

const cfg = (() => {
  const raw = localStorage.getItem("DEBUG");
  if (!raw) return null;
  if (raw.trim() === "*") return new Set<string>(["*"]);
  return new Set<string>(raw.split(",").map((s) => s.trim()));
})();

export function debug(scope: Scope, ...args: unknown[]) {
  if (!cfg) return;
  if (!cfg.has("*") && !cfg.has(scope)) return;

  /* colour per-scope */
  const col = hashColour(scope);
  // eslint-disable-next-line no-console
  console.debug(`%c[${scope}]`, `color:${col}`, ...args);
}

/* tiny hash → HSL colour */
function hashColour(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}deg 70% 50%)`;
}
