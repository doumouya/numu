/* shell/workspaces.ts — the REAL tenancy (console v2, CAS_e6695638): in HTTP
   mode the rail's workspace marks and the topbar chip come from the caller's
   reachable workspace rows, never from the sim's demo tenants. Empty until
   the operator creates one (Settings → Directory) — a clean org shows
   nothing it doesn't have. */

export interface Ws {
  id: string;
  name: string;
  slug: string;
}

let cache: Ws[] = [];

export function workspaces(): Ws[] {
  return cache;
}

export async function loadWorkspaces(client: NumuClientApi): Promise<Ws[]> {
  try {
    const res = await client.request("GET", "/api/objects/workspace?limit=100");
    const items =
      res.status === 200
        ? (((res.body as { items?: Array<{ id: string; data: Record<string, unknown> }> } | null)?.items ?? []))
        : [];
    cache = items.map((e) => ({
      id: e.id,
      name: typeof e.data["name"] === "string" ? (e.data["name"] as string) : e.id,
      slug: typeof e.data["slug"] === "string" ? (e.data["slug"] as string) : "",
    }));
  } catch {
    cache = [];
  }
  return cache;
}
