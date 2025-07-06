/**
 * Usage:
 *   import { debug } from "@/utils/debug";
 *   debug("ValueCell", "row", row.id);
 *
 * Enable everything:
 *   window.DEBUG = true
 * Enable only some:
 *   window.DEBUG = ["ValueCell","buildRows"]
 */
export function debug(scope: string, ...args: any[]) {
  const flag = (window as any).DEBUG;
  if (flag === true || (Array.isArray(flag) && flag.includes(scope))) {
    // eslint-disable-next-line no-console
    console.debug(`[${scope}]`, ...args);
  }
}
