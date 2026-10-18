// The web app's address, from the build-time variable PUBLIC_WEB_APP_URL (#830).
// Unset or empty: null, and the pages show no web-app link. Set: it must be an https origin with nothing after it
// (a trailing "/" is allowed), or the build fails here rather than publishing a wrong or insecure link.

/**
 * @param {string | undefined} raw
 * @returns {string | null} the origin with a trailing "/", or null when unset
 */
export function webAppUrl(raw) {
  if (raw === undefined || raw === "") return null;
  const fail = (why) => {
    throw new Error(`PUBLIC_WEB_APP_URL must be an https origin such as https://app.example.com (${why}); got ${JSON.stringify(raw)}`);
  };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail("not a URL");
  }
  if (url.protocol !== "https:") fail("https only");
  if (url.username || url.password) fail("no user or password");
  if (raw !== url.origin && raw !== `${url.origin}/`) fail("no path, query or fragment, lowercase host");
  return `${url.origin}/`;
}
