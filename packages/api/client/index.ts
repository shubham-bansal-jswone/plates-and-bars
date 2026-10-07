import createFetchClient, { type Client } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths } from "./schema";
export type Schemas = components["schemas"];
export type ApiClient = Client<paths>;

/**
 * Typed client for the Plate & Bar API.
 *
 * @param baseUrl  Server root including the version path, e.g. "https://host/api/v1".
 * @param getToken Returns the current access token, or null when signed out.
 *                 Called before every request; public endpoints ignore the header.
 */
export function createClient(
  baseUrl: string,
  getToken: () => string | null | Promise<string | null>,
): ApiClient {
  const client = createFetchClient<paths>({ baseUrl });
  client.use({
    async onRequest({ request }) {
      const token = await getToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  });
  return client;
}
