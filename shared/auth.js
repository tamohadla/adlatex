import { supabase } from "./supabaseClient.js";

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function requireSession(redirectUrl = "../auth/login.html") {
  const session = await getSession();
  if (!session) {
    window.location.href = redirectUrl;
    return null;
  }
  return session;
}

export async function logout(redirectUrl = "../auth/login.html") {
  await supabase.auth.signOut();
  window.location.href = redirectUrl;
}

// Role detection:
// We rely on a boolean RPC `is_manager()` already used in yarn section.
export async function isManager() {
  const { data, error } = await supabase.rpc("is_manager");
  if (error) {
    // fallback: treat as non-manager
    console.warn("is_manager RPC missing/failed", error);
    return false;
  }
  return !!data;
}
