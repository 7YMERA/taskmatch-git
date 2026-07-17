'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import Link from 'next/link'
import { logActivity } from '../lib/log'
import Sidebar from '../components/Sidebar'
import SkillPicker from '../components/SkillPicker'
import { toast, confirmDialog } from '../lib/ui'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PROGRAMMES = ['CS', 'IT', 'IS']  // UTP programmes: Computer Science, Information Technology, Information Systems
// Bright palette that stays readable on the dark background
const GROUP_COLORS = ['#a78bfa', '#34d399', '#38bdf8', '#fbbf24', '#fb7185', '#2dd4bf', '#fb923c', '#f472b6']

export default function Students() {
  const router = useRouter()
  const [students, setStudents] = useState<any[]>([])
  const [skills, setSkills] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string>('')
  const [userEmail, setUserEmail] = useState<string>('')
  const [showForm, setShowForm] = useState(false)
  const [editingStudent, setEditingStudent] = useState<string | null>(null)
  const [editSkills, setEditSkills] = useState<{ skill_id: string, proficiency: number }[]>([])
  const [form, setForm] = useState({ name: '', matric: '', programme: '', year: '', email: '', group_label: '' })
  const [accounts, setAccounts] = useState<any[]>([])          // signup (login) accounts, from the admin API
  const [addMode, setAddMode] = useState<'existing' | 'blank'>('existing')
  const [pickedAccountId, setPickedAccountId] = useState('')
  const [selectedSkills, setSelectedSkills] = useState<{ skill_id: string, proficiency: number }[]>([])
  const [stats, setStats] = useState<{ [student_id: string]: any }>({})
  const [wip, setWip] = useState<{ [student_id: string]: any }>({})
  const [wipLimit, setWipLimit] = useState(3)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)   // per-row "⋯" actions menu
  const [groupFilter, setGroupFilter] = useState('all')
  const [groups, setGroups] = useState<any[]>([])
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupForm, setGroupForm] = useState<{ name: string, color: string, members: string[] }>({ name: '', color: GROUP_COLORS[0], members: [] })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      const role = session?.user?.user_metadata?.role || 'student'
      setUserRole(role)
      setUserEmail(session.user.email || '')
      if (role === 'leader') fetchAccounts()   // account list + role controls are leader-only
    })
    fetchStudents()
    fetchSkills()
    fetchStats()
    fetchGroups()
    fetchWip()
  }, [])

  const fetchWip = async () => {
    try {
      const res = await axios.get(`${API}/wip`)
      const map: { [id: string]: any } = {}
      for (const s of res.data.students) map[s.student_id] = s
      setWip(map)
      setWipLimit(res.data.wip_limit ?? 3)
    } catch { /* backend may be down; WIP just won't show */ }
  }

  // Bearer header for the leader-gated admin endpoints on the API.
  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session ? { Authorization: `Bearer ${session.access_token}` } : {}
  }

  const fetchAccounts = async () => {
    try {
      const headers = await authHeader()
      const res = await axios.get(`${API}/accounts`, { headers })
      setAccounts(res.data.accounts || [])
    } catch {
      // Not a leader, or the server has no admin key configured — the feature just stays hidden.
    }
  }

  const changeRole = async (acct: any, newRole: 'leader' | 'student') => {
    const promoting = newRole === 'leader'
    const msg = promoting
      ? `Make ${acct.email} a leader?\n\nLeaders can add/remove students, manage tasks, change roles, and view the activity log.`
      : `Revoke leader from ${acct.email}?\n\nThey become a regular student and lose access to management tools.`
    if (!(await confirmDialog({ message: msg, confirmLabel: promoting ? 'Make leader' : 'Revoke', danger: !promoting }))) return
    try {
      const headers = await authHeader()
      await axios.post(`${API}/set-role`, { user_id: acct.id, role: newRole }, { headers })
      await fetchAccounts()
      toast(`${acct.email} is now a ${newRole}.`, 'success')
    } catch (e: any) {
      toast(e?.response?.data?.detail || 'Could not change the role. Check the API is running and configured.', 'error')
    }
  }

  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API}/student-stats`)
      const map: { [id: string]: any } = {}
      for (const s of res.data.stats) map[s.student_id] = s
      setStats(map)
    } catch { /* backend may be down; scores just won't show */ }
  }

  const fetchGroups = async () => {
    const { data } = await supabase.from('groups').select('*')
    setGroups(data || [])
  }

  const createGroup = async () => {
    const name = groupForm.name.trim()
    if (!name) return toast('Enter a group name', 'error')
    // Reuse an existing group (incl. one created on the Tasks tab) instead of erroring —
    // this is what lets you ADD members to an existing group.
    const existing = groups.find(g => g.name === name)
    if (!existing) {
      const { error } = await supabase.from('groups').insert({ name, color: groupForm.color, created_by: userEmail })
      if (error && !error.message.toLowerCase().includes('duplicate')) return toast(error.message, 'error')
    }
    if (groupForm.members.length > 0) {
      await supabase.from('students').update({ group_label: name }).in('id', groupForm.members)
    }
    const n = groupForm.members.length
    await logActivity({
      action: existing ? 'group.members_added' : 'group.created', entity_type: 'group',
      summary: existing
        ? `Added ${n} member${n === 1 ? '' : 's'} to group '${name}'`
        : `Created group '${name}' with ${n} member${n === 1 ? '' : 's'}`,
      details: { color: groupForm.color, members: groupForm.members, reused: !!existing },
    })
    setGroupForm({ name: '', color: GROUP_COLORS[0], members: [] })
    setShowGroupForm(false)
    fetchGroups()
    fetchStudents()
  }

  const disbandGroup = async (name: string) => {
    if (!(await confirmDialog({ title: `Disband "${name}"?`, message: 'Its members and tasks will be ungrouped — the students and tasks themselves are kept.', danger: true, confirmLabel: 'Disband' }))) return
    await supabase.from('students').update({ group_label: null }).eq('group_label', name)
    await supabase.from('tasks').update({ group_label: null }).eq('group_label', name)
    await supabase.from('groups').delete().eq('name', name)
    await logActivity({ action: 'group.disbanded', entity_type: 'group', summary: `Disbanded group '${name}'` })
    setGroupFilter('all')
    fetchGroups()
    fetchStudents()
  }

  const fetchStudents = async () => {
    const { data } = await supabase
      .from('students')
      .select('*, student_skills(skill_id, proficiency, skills(skill_name))')
      .order('name', { ascending: true })   // stable alphabetical order (was unordered → recently-edited rows sank to the bottom)
    setStudents(data || [])
    setLoading(false)
  }

  const fetchSkills = async () => {
    const { data } = await supabase.from('skills').select('*')
    setSkills(data || [])
  }


  const addStudent = async () => {
    if (!form.name || !form.matric || !form.email) return toast('Fill in name, matric and email', 'error')
    const { data, error } = await supabase.from('students').insert({
      name: form.name,
      matric: form.matric,
      programme: form.programme,
      year: parseInt(form.year),
      email: form.email,
      group_label: form.group_label.trim() || null
    }).select().single()
    if (error) return toast(error.message, 'error')
    if (selectedSkills.length > 0) {
      await supabase.from('student_skills').insert(
        selectedSkills.map(s => ({ student_id: data.id, skill_id: s.skill_id, proficiency: s.proficiency }))
      )
    }
    await logActivity({
      action: 'student.added', entity_type: 'student', entity_id: data.id,
      summary: `Added student ${form.name} (${form.matric}, ${form.programme})${form.group_label ? ` to group ${form.group_label}` : ''}`,
      details: { matric: form.matric, programme: form.programme, email: form.email, group_label: form.group_label, skills: selectedSkills },
    })
    setForm({ name: '', matric: '', programme: '', year: '', email: '', group_label: '' })
    setSelectedSkills([])
    setPickedAccountId('')
    setShowForm(false)
    fetchStudents()
    fetchAccounts()   // the picked account is now on the roster — refresh so it drops out of the picker
    toast(`${form.name} added successfully!`, 'success')
  }

  const startEditing = (student: any) => {
    setEditingStudent(student.id)
    setEditSkills(student.student_skills?.map((ss: any) => ({
      skill_id: ss.skill_id,
      proficiency: ss.proficiency
    })) || [])
  }

  const saveSkills = async (student_id: string) => {
    await supabase.from('student_skills').delete().eq('student_id', student_id)
    if (editSkills.length > 0) {
      await supabase.from('student_skills').insert(
        editSkills.map(s => ({ student_id, skill_id: s.skill_id, proficiency: s.proficiency }))
      )
    }
    const who = students.find(s => s.id === student_id)?.name || student_id
    await logActivity({
      action: 'student.skills_updated', entity_type: 'student', entity_id: student_id,
      summary: `Updated skills for ${who} (${editSkills.length} skill${editSkills.length === 1 ? '' : 's'})`,
      details: { skills: editSkills },
    })
    setEditingStudent(null)
    fetchStudents()
  }

  const uploadStudentAvatar = async (studentId: string, name: string, file?: File) => {
    if (!file) return
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `${studentId}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' })
    if (error) return toast(`Upload failed: ${error.message}`, 'error')
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    await supabase.from('students').update({ avatar_url: pub.publicUrl }).eq('id', studentId)
    await logActivity({ action: 'student.photo_updated', entity_type: 'student', entity_id: studentId, summary: `Updated profile photo for ${name}` })
    fetchStudents()
  }

  const removeFromGroup = async (id: string, name: string, group: string) => {
    if (!(await confirmDialog({
      title: `Remove ${name} from "${group}"?`,
      message: 'They stay in the project — their profile, skills and history are kept. Only their group membership is cleared.',
      confirmLabel: 'Remove from group',
    }))) return
    await supabase.from('students').update({ group_label: null }).eq('id', id)
    await logActivity({
      action: 'student.removed_from_group', entity_type: 'student', entity_id: id,
      summary: `Removed ${name} from group '${group}'`, details: { group },
    })
    fetchStudents()
  }

  const removeStudent = async (id: string, name: string) => {
    if (!(await confirmDialog({
      title: `Remove ${name} from the project?`,
      message: `This permanently deletes ${name} from TaskMatch — their profile, declared skills, and assignment history. This is NOT just removing them from a group, and it can't be undone.`,
      danger: true, confirmLabel: 'Remove from project',
    }))) return
    await supabase.from('students').delete().eq('id', id)
    await logActivity({ action: 'student.removed', entity_type: 'student', entity_id: id, summary: `Removed student ${name} from the project` })
    fetchStudents()
  }

  const initials = (name: string) =>
    name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  const groupColor = (name: string) => groups.find(g => g.name === name)?.color || '#a78bfa'

  // Link roster rows to login accounts by email (the only join between the two).
  const accountByEmail: { [email: string]: any } = {}
  accounts.forEach(a => { if (a.email) accountByEmail[a.email.toLowerCase()] = a })
  const accountFor = (s: any) => accountByEmail[(s.email || '').toLowerCase()]
  // Accounts that exist but aren't on the roster yet — the pool for "assign existing account".
  const unassignedAccounts = accounts.filter(a => !a.on_roster)

  // WIP as a small slot meter, coloured only when it matters (amber on the last slot, red at limit).
  const wipMeter = (sid: string) => {
    const w = wip[sid]
    if (!w) return <div className="w-14 shrink-0" />
    const atLimit = w.wip >= wipLimit
    const fill = atLimit ? '#ef4444' : w.wip >= wipLimit - 1 ? '#f59e0b' : 'rgba(255,255,255,0.5)'
    return (
      <div className="flex items-center gap-1.5 shrink-0 w-14" title={`${w.wip} of ${wipLimit} active tasks`}>
        <span className="flex gap-0.5">
          {Array.from({ length: wipLimit }).map((_, i) => (
            <span key={i} className="w-1 h-3.5 rounded-sm" style={{ backgroundColor: i < w.wip ? fill : 'rgba(255,255,255,0.1)' }} />
          ))}
        </span>
        <span className="text-xs tabular-nums" style={{ color: atLimit ? '#f87171' : 'rgba(255,255,255,0.4)' }}>{w.wip}/{wipLimit}</span>
      </div>
    )
  }

  // Cluster ordering: rank groups by how recently they were created (newest first),
  // ungrouped students fall to the bottom. Lower rank = higher up.
  const groupCreatedAt: { [name: string]: number } = {}
  groups.forEach(g => { groupCreatedAt[g.name] = new Date(g.created_at).getTime() })
  const groupRank = (label: string | null) =>
    !label ? Number.POSITIVE_INFINITY
      : groupCreatedAt[label] != null ? -groupCreatedAt[label]   // newest created_at → most negative → top
        : Number.MAX_SAFE_INTEGER                                // labelled but no group row → just above ungrouped

  // Groups come from the canonical `groups` table (shared with the Tasks tab) unioned with any
  // labels present on the roster — so a group made on either tab shows here, even with no members yet.
  const existingGroups = (Array.from(new Set([
    ...groups.map(g => g.name),
    ...students.map(s => s.group_label).filter(Boolean),
  ])) as string[]).sort((a, b) => groupRank(a) - groupRank(b))

  const filteredStudents = groupFilter === 'all'
    ? students
    : groupFilter === '__none__'
      ? students.filter(s => !s.group_label)
      : students.filter(s => s.group_label === groupFilter)

  // Clustered: newest group block on top, then by name within each group.
  const shownStudents = filteredStudents.slice().sort((a, b) => {
    const ra = groupRank(a.group_label), rb = groupRank(b.group_label)
    if (ra !== rb) return ra - rb
    return (a.name || '').localeCompare(b.name || '')
  })

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <main className="flex-1 p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Students</h1>
          </div>
          {userRole === 'leader' && (
            <div className="flex gap-2">
              <button onClick={() => { setShowGroupForm(!showGroupForm); setShowForm(false) }}
                className="flex items-center gap-2 text-sm px-4 py-2 border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 rounded-lg transition">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Create group
              </button>
              <button onClick={() => { setShowForm(!showForm); setShowGroupForm(false) }}
                className="text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
                + Add student
              </button>
            </div>
          )}
        </div>

        {/* Create group form — leader only */}
        {showGroupForm && userRole === 'leader' && (
          <div className="bg-gradient-to-br from-violet-500/10 to-transparent border border-violet-500/30 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              {(() => {
                const isExisting = groups.some(g => g.name === groupForm.name.trim())
                return (
                  <div>
                    <p className="text-sm font-medium text-white">{isExisting ? `Add students to “${groupForm.name.trim()}”` : 'Create a group'}</p>
                    <p className="text-xs text-white/40">{isExisting ? 'Pick students below — anyone in another group will be moved here' : 'Name it, pick a colour, and add students (typing an existing name adds to that group)'}</p>
                  </div>
                )
              })()}
            </div>
            <input
              list="existing-group-names"
              placeholder="Group name — type new, or pick an existing one to add members"
              value={groupForm.name}
              onChange={e => setGroupForm({ ...groupForm, name: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition mb-4"
            />
            <datalist id="existing-group-names">
              {existingGroups.map(g => <option key={g} value={g} />)}
            </datalist>

            <p className="text-xs text-white/40 mb-2">Colour <span className="text-white/25">(only used when creating a new group)</span></p>
            <div className="flex gap-2 mb-4">
              {GROUP_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setGroupForm({ ...groupForm, color: c })}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full border-2 transition ${groupForm.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  aria-label={c} />
              ))}
            </div>

            <p className="text-xs text-white/40 mb-2">Select students ({groupForm.members.length} selected)</p>
            <p className="text-xs text-white/30 mb-2">Anyone already in another group will be moved here.</p>
            <div className="flex flex-col gap-1 mb-4 max-h-56 overflow-y-auto">
              {(() => {
                const target = groupForm.name.trim()
                // Show everyone except those already in the target group; note their current group.
                const list = students.filter(s => !(target && s.group_label === target))
                return list.length === 0 ? (
                  <p className="text-xs text-white/30">
                    {students.length === 0 ? 'No students yet — add students first.' : 'Everyone is already in this group.'}
                  </p>
                ) : list.map(s => {
                  const checked = groupForm.members.includes(s.id)
                  return (
                    <button key={s.id} type="button"
                      onClick={() => setGroupForm(prev => ({
                        ...prev,
                        members: checked ? prev.members.filter(id => id !== s.id) : [...prev.members, s.id],
                      }))}
                      className={`flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border transition ${checked
                        ? 'border-indigo-500 bg-indigo-500/20 text-white'
                        : 'border-white/10 text-white/50 hover:text-white'}`}>
                      <span className={`w-3.5 h-3.5 rounded-sm border shrink-0 ${checked ? 'bg-indigo-400 border-indigo-400' : 'border-white/30'}`} />
                      {s.name} <span className="text-white/30">· {s.matric}</span>
                      {s.group_label && s.group_label !== target && <span className="ml-auto text-white/30">in {s.group_label}</span>}
                    </button>
                  )
                })
              })()}
            </div>

            <div className="flex gap-3">
              <button onClick={createGroup}
                className="flex items-center gap-2 text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Save group
              </button>
              <button onClick={() => { setShowGroupForm(false); setGroupForm({ name: '', color: GROUP_COLORS[0], members: [] }) }}
                className="text-sm px-4 py-2 border border-white/10 text-white/60 hover:text-white rounded-lg transition">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add student form — leader only */}
        {showForm && userRole === 'leader' && (
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mb-6">
            <p className="text-sm font-medium text-white mb-4">New student</p>

            {/* Source: attach a roster row to someone who already signed up, or type in someone new. */}
            <div className="flex gap-2 mb-4">
              <button type="button"
                onClick={() => setAddMode('existing')}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${addMode === 'existing'
                  ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                  : 'border-white/10 text-white/40 hover:text-white'}`}>
                Assign existing account
              </button>
              <button type="button"
                onClick={() => { setAddMode('blank'); setPickedAccountId(''); setForm({ ...form, name: '', email: '' }) }}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${addMode === 'blank'
                  ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                  : 'border-white/10 text-white/40 hover:text-white'}`}>
                Enter manually
              </button>
            </div>

            {addMode === 'existing' && (
              <div className="mb-4">
                <p className="text-xs text-white/40 mb-2">
                  Signed-up accounts not yet on the roster ({unassignedAccounts.length})
                </p>
                {unassignedAccounts.length === 0 ? (
                  <p className="text-xs text-white/30">
                    Everyone who has signed up is already on the roster. Switch to “Enter manually” to add
                    someone who hasn’t created an account yet.
                  </p>
                ) : (
                  <select
                    value={pickedAccountId}
                    onChange={e => {
                      const a = accounts.find(x => x.id === e.target.value)
                      setPickedAccountId(e.target.value)
                      if (a) setForm(f => ({ ...f, name: a.name || f.name, email: a.email || '' }))
                    }}
                    className={`w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 transition ${pickedAccountId ? 'text-white' : 'text-white/40'}`}>
                    <option value="">Select an account…</option>
                    {unassignedAccounts.map(a => (
                      <option key={a.id} value={a.id} className="text-white">
                        {a.email}{a.name ? ` — ${a.name}` : ''}{a.role === 'leader' ? ' (leader)' : ''}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-white/30 mt-2">
                  Email is taken from the account and locked so the roster row stays linked to their login. Fill in the rest below.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { key: 'name', placeholder: 'Full name' },
                { key: 'matric', placeholder: 'Matric no. e.g. 22001874' },
                { key: 'email', placeholder: 'Email' },
                { key: 'year', placeholder: 'Year e.g. 3' },
              ].map(f => (
                <input key={f.key}
                  placeholder={f.placeholder}
                  value={(form as any)[f.key]}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  readOnly={addMode === 'existing' && f.key === 'email'}
                  className={`bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition ${addMode === 'existing' && f.key === 'email' ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              ))}
              <select
                value={form.programme}
                onChange={e => setForm({ ...form, programme: e.target.value })}
                className={`bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 transition ${form.programme ? 'text-white' : 'text-white/20'}`}>
                <option value="" disabled hidden>Programme</option>
                {PROGRAMMES.map(p => (
                  <option key={p} value={p} className="text-white">{p}</option>
                ))}
              </select>
              <input
                list="student-groups"
                placeholder="Group / team (type new or pick existing)"
                value={form.group_label}
                onChange={e => setForm({ ...form, group_label: e.target.value })}
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
              />
              <datalist id="student-groups">
                {existingGroups.map(g => <option key={g} value={g} />)}
              </datalist>
            </div>

            <p className="text-xs text-white/40 mb-2">Assign skills <span className="text-white/25">— click a skill, then set B / I / A</span></p>
            <div className="mb-4">
              <SkillPicker skills={skills} value={selectedSkills} onChange={setSelectedSkills} />
            </div>

            <div className="flex gap-3">
              <button onClick={addStudent}
                className="text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
                Save student
              </button>
              <button onClick={() => { setShowForm(false); setSelectedSkills([]) }}
                className="text-sm px-4 py-2 border border-white/10 text-white/60 hover:text-white rounded-lg transition">
                Cancel
              </button>
              <button onClick={() => { setForm({ name: '', matric: '', programme: '', year: '', email: '', group_label: '' }); setSelectedSkills([]) }}
                className="ml-auto text-sm px-4 py-2 border border-white/10 text-white/60 hover:text-white rounded-lg transition">
                Clear all
              </button>
            </div>
          </div>
        )}

        {/* Group filter — a compact dropdown so a long group list stays tidy */}
        <div className="flex gap-2 mb-4 items-center">
          <span className="text-xs text-white/40">Group:</span>
          {groupFilter !== 'all' && groupFilter !== '__none__' && (
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: groupColor(groupFilter) }} />
          )}
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none max-w-[16rem]">
            <option value="all">All groups ({students.length})</option>
            {existingGroups.map(g => (
              <option key={g} value={g}>{g} ({students.filter(s => s.group_label === g).length})</option>
            ))}
            <option value="__none__">No group ({students.filter(s => !s.group_label).length})</option>
          </select>
        </div>

        {/* Students list */}
        <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-white">
              Team roster ({shownStudents.length}{groupFilter !== 'all' ? ` of ${students.length}` : ''})
            </p>
            {userRole === 'leader' && groupFilter !== 'all' && groupFilter !== '__none__' && (
              <div className="flex gap-2">
                <button onClick={() => { setGroupForm({ name: groupFilter, color: groupColor(groupFilter), members: [] }); setShowGroupForm(true); setShowForm(false) }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 transition">
                  + Add students
                </button>
                <button onClick={() => disbandGroup(groupFilter)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                  Disband
                </button>
              </div>
            )}
          </div>
          {loading ? (
            <p className="text-white/40 text-sm">Loading...</p>
          ) : (
            <div className="flex flex-col gap-3">
              {shownStudents.map(s => (
                <div key={s.id} className={`rounded-lg border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02] transition ${menuOpen === s.id ? 'relative z-30' : ''}`}>
                  <div className="flex items-center gap-4 p-4">
                    {s.avatar_url ? (
                      <img src={s.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-white/10 text-white/50 flex items-center justify-center text-base font-medium shrink-0">
                        {initials(s.name)}
                      </div>
                    )}
                    <div className="w-52 shrink-0 min-w-0">
                      <div className="flex items-center gap-2">
                        {s.group_label && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: groupColor(s.group_label) }} title={s.group_label} />}
                        <Link href={`/students/${s.id}`} className="text-sm font-medium text-white hover:underline truncate">{s.name}</Link>
                        {userRole === 'leader' && (() => {
                          const acct = accountFor(s)
                          if (!acct) return <span className="text-[11px] text-white/25 shrink-0" title="No login account linked to this roster row">no login</span>
                          if (acct.role === 'leader') return <span className="text-[11px] text-indigo-300/70 shrink-0" title="This account is a leader">leader</span>
                          return null
                        })()}
                      </div>
                      <p className="text-xs text-white/40 truncate mt-0.5">{s.matric} · {s.programme} · Year {s.year}</p>
                    </div>

                    {/* Middle column — skills + what they're working on now (fills the row) */}
                    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(s.student_skills || []).length === 0 ? (
                          <span className="text-xs text-white/25">No skills declared</span>
                        ) : (s.student_skills || []).slice(0, 5).map((ss: any) => (
                          <span key={ss.skill_id} className="text-xs px-2 py-0.5 rounded-md border border-white/[0.08] text-white/55">{ss.skills?.skill_name}</span>
                        ))}
                        {(s.student_skills || []).length > 5 && <span className="text-[11px] text-white/30">+{(s.student_skills || []).length - 5}</span>}
                      </div>
                      {(() => {
                        const at = wip[s.id]?.active_tasks || []
                        return at.length === 0
                          ? <span className="text-[11px] text-white/30 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-emerald-400/60" /> Available · no active tasks</span>
                          : <span className="text-[11px] text-white/40 truncate">On: {at.map((t: any) => t.description).filter(Boolean).join(', ')}</span>
                      })()}
                    </div>

                    {userRole === 'leader' && stats[s.id] && (() => {
                      const st = stats[s.id]
                      const color = st.band === 'high' ? '#10b981' : st.band === 'avg' ? '#f59e0b' : st.band === 'low' ? '#ef4444' : 'rgba(255,255,255,0.25)'
                      return (
                        <div className="flex items-center gap-1.5 shrink-0" title={`Rating: ${st.band} · ${st.completed_count} completed`}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-xs text-white/45 tabular-nums w-7">{st.band === 'unrated' ? '—' : st.avg_score}</span>
                        </div>
                      )
                    })()}

                    {wipMeter(s.id)}

                    {userRole === 'leader' && (
                      <div className="relative shrink-0">
                        <button onClick={() => setMenuOpen(menuOpen === s.id ? null : s.id)}
                          className="w-8 h-8 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition flex items-center justify-center text-lg leading-none">⋯</button>
                        {menuOpen === s.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />
                            <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-[#202020] border border-white/10 rounded-lg shadow-xl py-1">
                              <Link href={`/students/${s.id}`} className="block px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition">See profile</Link>
                              <button onClick={() => { setMenuOpen(null); startEditing(s) }} className="block w-full text-left px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition">Edit skills &amp; photo</button>
                              {(() => {
                                const acct = accountFor(s)
                                if (!acct) return null
                                return acct.role === 'leader'
                                  ? <button onClick={() => { setMenuOpen(null); changeRole(acct, 'student') }} className="block w-full text-left px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition">Revoke leader</button>
                                  : <button onClick={() => { setMenuOpen(null); changeRole(acct, 'leader') }} className="block w-full text-left px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition">Make leader</button>
                              })()}
                              {s.group_label && <button onClick={() => { setMenuOpen(null); removeFromGroup(s.id, s.name, s.group_label) }} className="block w-full text-left px-3 py-1.5 text-xs text-amber-400/80 hover:bg-white/10 transition">Remove from group</button>}
                              <div className="my-1 h-px bg-white/10" />
                              <button onClick={() => { setMenuOpen(null); removeStudent(s.id, s.name) }} className="block w-full text-left px-3 py-1.5 text-xs text-red-400/80 hover:bg-white/10 transition">Remove from project</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Edit panel — leader only */}
                  {editingStudent === s.id && userRole === 'leader' && (
                    <div className="mx-3 mb-3 pt-3 border-t border-white/10">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-white/40">Edit skills for {s.name}</p>
                        <label className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/60 hover:text-white cursor-pointer transition">
                          Upload photo
                          <input type="file" accept="image/*" className="hidden"
                            onChange={e => uploadStudentAvatar(s.id, s.name, e.target.files && e.target.files[0] ? e.target.files[0] : undefined)} />
                        </label>
                      </div>
                      <div className="mb-3">
                        <SkillPicker skills={skills} value={editSkills} onChange={setEditSkills} />
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => saveSkills(s.id)}
                          className="text-xs px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
                          Save changes
                        </button>
                        <button onClick={() => setEditingStudent(null)}
                          className="text-xs px-3 py-2 border border-white/10 text-white/60 rounded-lg transition">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}