import { createClient } from '@supabase/supabase-js'

// Dedicated client for writing audit entries. activity_logs has RLS that
// allows INSERT + SELECT but denies UPDATE/DELETE, so rows are append-only.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type LogEntry = {
  action: string          // e.g. 'task.created', 'student.skills_updated'
  entity_type: string     // 'task' | 'student' | 'assignment' | 'comment' | 'skill'
  entity_id?: string | null
  summary?: string
  details?: any
}

/**
 * Append one immutable row to activity_logs, stamped with the current
 * user's email + role. Best-effort: a logging failure never blocks or
 * throws into the calling action.
 */
export async function logActivity(entry: LogEntry) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('activity_logs').insert({
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      summary: entry.summary ?? null,
      details: entry.details ?? null,
      actor_email: session?.user?.email ?? null,
      actor_role: session?.user?.user_metadata?.role ?? null,
    })
  } catch {
    /* swallow — auditing must not break the underlying action */
  }
}
