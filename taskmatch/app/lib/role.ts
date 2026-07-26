// Testing "view as" role override. Purely client-side — it changes the role the UI uses
// (leader ↔ student) without touching the account's real Supabase role, so testers can try
// both perspectives from one account. Backend admin actions (promote/demote, list accounts)
// still verify the REAL role, so this can't grant real privileges.

const KEY = 'tm_role_override'

export function getRoleOverride(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function setRoleOverride(role: string | null) {
  try {
    if (role) localStorage.setItem(KEY, role)
    else localStorage.removeItem(KEY)
  } catch { /* private mode */ }
}

// Effective role for the UI — a testing override wins over the account's real role.
export function effectiveRole(session: any): string {
  return getRoleOverride() || session?.user?.user_metadata?.role || 'student'
}
