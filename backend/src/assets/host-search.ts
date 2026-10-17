export interface HostSearch {
  /** Part of a host name to match (case-insensitive substring). Empty = no host filter. */
  host: string;
  /** Exact port, only when the user typed one ("example.com:8443"). */
  port?: number;
}

/**
 * Turns whatever the user typed into a host search, accepting the same forms as "Add asset":
 *   "zeuz", "qa.zeuz.ai", "https://qa.zeuz.ai/", "qa.zeuz.ai:8443", "https://qa.zeuz.ai:8443/login?x=1"
 * Assets are stored as a bare host plus a port, so the scheme, path, query and fragment are dropped.
 */
export function parseHostSearch(input: string): HostSearch {
  let text = input.trim().toLowerCase();
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme: https://, http://, tls://
  text = text.split(/[/?#]/)[0]; // path, query string, fragment

  const withPort = /^(.*):(\d{1,5})$/.exec(text);
  if (withPort) {
    const port = Number(withPort[2]);
    if (port >= 1 && port <= 65535) return { host: withPort[1], port };
  }
  return { host: text.replace(/:$/, '') };
}
