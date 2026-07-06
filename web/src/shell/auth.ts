/* shell/auth.ts — the console's identity store + the boot gate over the seam.
   HTTP mode gates on GET /auth/me (B1, CAS_0028c746); sim mode never calls
   this (Jean Mensah stays the sim canon). Fail-closed: anything that is not
   a clean 200 lands on the login page — a broken backend must never boot a
   console that then leaks errors block by block. */

export interface AuthIdentity {
  actor_id: string;
  display_name: string;
  handle: string;
  email: string | null;
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
  platform_role: string;
}

/** The module-level identity store — null in sim mode and while logged out. */
export const auth: { identity: AuthIdentity | null } = { identity: null };

export type GateResult = { kind: "in"; identity: AuthIdentity } | { kind: "login"; error?: string };

const UNREACHABLE = "numu is unreachable — try again";

function asIdentity(body: unknown): AuthIdentity | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b["actor_id"] !== "string") return null;
  return {
    actor_id: b["actor_id"],
    display_name: typeof b["display_name"] === "string" ? b["display_name"] : b["actor_id"],
    handle: typeof b["handle"] === "string" ? b["handle"] : "",
    email: typeof b["email"] === "string" ? b["email"] : null,
    avatar_url: typeof b["avatar_url"] === "string" ? b["avatar_url"] : null,
    first_name: typeof b["first_name"] === "string" ? b["first_name"] : null,
    last_name: typeof b["last_name"] === "string" ? b["last_name"] : null,
    platform_role: typeof b["platform_role"] === "string" ? b["platform_role"] : "member",
  };
}

/** The boot gate: 200 → in (store + client actor aligned) · 401 → login ·
    anything else → login, fail-closed, with the unreachable note. */
export async function fetchMe(client: NumuClientApi): Promise<GateResult> {
  try {
    const res = await client.request("GET", "/auth/me");
    if (res.status === 200) {
      const identity = asIdentity(res.body);
      if (identity) {
        auth.identity = identity;
        client.actor = identity.actor_id;
        return { kind: "in", identity };
      }
      return { kind: "login", error: UNREACHABLE };
    }
    if (res.status === 401) return { kind: "login" };
    return { kind: "login", error: UNREACHABLE };
  } catch {
    return { kind: "login", error: UNREACHABLE };
  }
}

/** Synthesize the record shape the existing renderers (settings account head,
    user-record self view) already know from the live identity — HTTP mode's
    replacement for the sim's CCD.users row. Null in sim / logged out. */
export function identityRecord(): ConsoleUserRecordData | null {
  const i = auth.identity;
  if (!i) return null;
  return {
    id: i.actor_id,
    type: "user",
    name: i.display_name,
    handle: i.handle,
    firstName: i.first_name ?? "",
    lastName: i.last_name ?? "",
    email: i.email ?? "",
    phone: "",
    country: "",
    kind: "human",
    status: "active",
    role: i.platform_role === "admin" ? "platform admin" : "member",
    accent: "var(--accent)",
    joined: "",
    lastActive: "",
    timezone: "",
    locale: "",
    notes: "",
    kyc: { status: "—", method: "—", date: "—" },
    memberships: [],
    activity: [],
    owned: [],
  };
}

/** Persist a self-edit to the caller's own actor: GET for the etag → PATCH If-Match → re-fetch
    /auth/me so the chrome (avatar chip, settings head) updates live. Returns whether it stuck. */
export async function saveProfile(
  client: NumuClientApi,
  field: string,
  value: string,
): Promise<boolean> {
  const id = auth.identity?.actor_id;
  if (!id) return false;
  const cur = await client.request("GET", `/api/objects/actor/${id}`);
  if (cur.status !== 200) return false;
  const etag = (cur.body as { etag?: string } | null)?.etag;
  const res = await client.request("PATCH", `/api/objects/actor/${id}`, {
    body: { [field]: value },
    headers: etag ? { "If-Match": etag } : {},
  });
  if (res.status === 200) {
    await fetchMe(client);
    return true;
  }
  return false;
}

/** Logout is total by design (AUTH.md §2): 204 → a clean full reload back
    through the gate (the console's mounts have no teardown contract). */
export async function doLogout(client: NumuClientApi): Promise<boolean> {
  try {
    const res = await client.request("POST", "/auth/logout");
    return res.status === 204;
  } catch {
    return false;
  }
}
