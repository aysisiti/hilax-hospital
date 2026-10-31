// change-password: lets any signed-in, active user change their own password.
// Needs the current password, checks the new one, and clears the
// "must change password" flag that admin-created accounts start with.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://aysisiti.github.io"];

function corsHeaders(origin: string): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin") ?? "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return json({ error: "Server not configured" }, 500, cors);
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, serviceKey, noSession);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Not signed in" }, 401, cors);
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth?.user || !auth.user.email) return json({ error: "Not signed in" }, 401, cors);
  const user = auth.user;

  const { data: me } = await admin.from("users").select("active").eq("id", user.id).maybeSingle();
  if (!me || !me.active) return json({ error: "Not allowed" }, 403, cors);

  if (Number(req.headers.get("content-length") ?? 0) > 2_000) return json({ error: "Request too large" }, 413, cors);
  let current: unknown;
  let next: unknown;
  try {
    const parsed = JSON.parse(await req.text());
    current = parsed?.current_password;
    next = parsed?.new_password;
  } catch {
    return json({ error: "Invalid request" }, 400, cors);
  }
  if (typeof current !== "string" || current.length < 1 || current.length > 72) {
    return json({ error: "Invalid request" }, 400, cors);
  }
  // bcrypt only uses the first 72 bytes, so cap there.
  if (typeof next !== "string" || next.length < 8 || new TextEncoder().encode(next).length > 72) {
    return json({ error: "New password must be 8 to 72 characters" }, 400, cors);
  }
  if (next === current) return json({ error: "New password must be different" }, 400, cors);

  // Verify the current password with a throwaway client (does not touch the caller's session).
  const verifier = createClient(url, anonKey, noSession);
  const { error: verifyErr } = await verifier.auth.signInWithPassword({ email: user.email, password: current });
  if (verifyErr) return json({ error: "Current password is incorrect" }, 400, cors);

  const { error: updErr } = await admin.auth.admin.updateUserById(user.id, { password: next });
  if (updErr) {
    console.error("change-password update failed:", updErr.message);
    return json({ error: "Could not change password" }, 500, cors);
  }
  await admin.from("users").update({ must_change_password: false }).eq("id", user.id);
  return json({ ok: true }, 200, cors);
});
