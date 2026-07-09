'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import Link from 'next/link'
import { logActivity } from '../lib/log'
import Sidebar from '../components/Sidebar'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const PROFICIENCY = ['', 'Beginner', 'Intermediate', 'Advanced']
const PROGRAMMES = ['CS', 'IT', 'IS']  // UTP programmes: Computer Science, Information Technology, Information Systems
// Bright palette that stays readable on the dark background
const GROUP_COLORS = ['#a78bfa', '#34d399', '#38bdf8', '#fbbf24', '#fb7185', '#2dd4bf', '#fb923c', '#f472b6']

const bandClass = (band: string) => ({
  high: 'bg-emerald-500/20 text-emerald-400',
  avg: 'bg-amber-500/20 text-amber-400',
  low: 'bg-red-500/20 text-red-400',
  unrated: 'bg-white/10 text-white/40',
}[band] || 'bg-white/10 text-white/40')

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
  }, [])

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
    if (!confirm(msg)) return
    try {
      const headers = await authHeader()
      await axios.post(`${API}/set-role`, { user_id: acct.id, role: newRole }, { headers })
      await fetchAccounts()
      alert(`✅ ${acct.email} is now a ${newRole}.`)
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Could not change the role. Check the API is running and configured.')
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
    if (!name) return alert('Enter a group name')
    const { error } = await supabase.from('groups').insert({ name, color: groupForm.color, created_by: userEmail })
    if (error) return alert(error.message.includes('duplicate') ? `A group named "${name}" already exists.` : error.message)
    if (groupForm.members.length > 0) {
      await supabase.from('students').update({ group_label: name }).in('id', groupForm.members)
    }
    await logActivity({
      action: 'group.created', entity_type: 'group',
      summary: `Created group '${name}' with ${groupForm.members.length} member${groupForm.members.length === 1 ? '' : 's'}`,
      details: { color: groupForm.color, members: groupForm.members },
    })
    setGroupForm({ name: '', color: GROUP_COLORS[0], members: [] })
    setShowGroupForm(false)
    fetchGroups()
    fetchStudents()
  }

  const disbandGroup = async (name: string) => {
    if (!confirm(`Disband "${name}"? Its members and tasks will be ungrouped — the students and tasks themselves are kept.`)) return
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

  const toggleSkill = (skill_id: string, list: any[], setList: any) => {
    setList((prev: any[]) =>
      prev.find(s => s.skill_id === skill_id)
        ? prev.filter(s => s.skill_id !== skill_id)
        : [...prev, { skill_id, proficiency: 1 }]
    )
  }

  const updateProficiency = (skill_id: string, proficiency: number, list: any[], setList: any) => {
    setList((prev: any[]) =>
      prev.map(s => s.skill_id === skill_id ? { ...s, proficiency } : s)
    )
  }

  const addStudent = async () => {
    if (!form.name || !form.matric || !form.email) return alert('Fill in name, matric and email')
    const { data, error } = await supabase.from('students').insert({
      name: form.name,
      matric: form.matric,
      programme: form.programme,
      year: parseInt(form.year),
      email: form.email,
      group_label: form.group_label.trim() || null
    }).select().single()
    if (error) return alert(error.message)
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
    alert(`✅ ${form.name} added successfully!`)
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
    if (error) return alert(`Upload failed: ${error.message}`)
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    await supabase.from('students').update({ avatar_url: pub.publicUrl }).eq('id', studentId)
    await logActivity({ action: 'student.photo_updated', entity_type: 'student', entity_id: studentId, summary: `Updated profile photo for ${name}` })
    fetchStudents()
  }

  const removeFromGroup = async (id: string, name: string, group: string) => {
    if (!confirm(
      `Remove ${name} from the group "${group}"?\n\n` +
      `They STAY in the project — their profile, skills and history are kept. ` +
      `Only their group membership is cleared.`
    )) return
    await supabase.from('students').update({ group_label: null }).eq('id', id)
    await logActivity({
      action: 'student.removed_from_group', entity_type: 'student', entity_id: id,
      summary: `Removed ${name} from group '${group}'`, details: { group },
    })
    fetchStudents()
  }

  const removeStudent = async (id: string, name: string) => {
    if (!confirm(
      `⚠ REMOVE FROM THE WHOLE PROJECT\n\n` +
      `You are about to permanently delete ${name} from TaskMatch entirely — ` +
      `their profile, declared skills, and assignment history will all be removed.\n\n` +
      `This is NOT just removing them from a group. This cannot be undone.\n\nContinue?`
    )) return
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

  // Cluster ordering: rank groups by how recently they were created (newest first),
  // ungrouped students fall to the bottom. Lower rank = higher up.
  const groupCreatedAt: { [name: string]: number } = {}
  groups.forEach(g => { groupCreatedAt[g.name] = new Date(g.created_at).getTime() })
  const groupRank = (label: string | null) =>
    !label ? Number.POSITIVE_INFINITY
      : groupCreatedAt[label] != null ? -groupCreatedAt[label]   // newest created_at → most negative → top
        : Number.MAX_SAFE_INTEGER                                // labelled but no group row → just above ungrouped

  // Filter chips ordered newest-group-first to match the roster clustering.
  const existingGroups = (Array.from(new Set(students.map(s => s.group_label).filter(Boolean))) as string[])
    .sort((a, b) => groupRank(a) - groupRank(b))

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
              <div>
                <p className="text-sm font-medium text-white">Create group</p>
                <p className="text-xs text-white/40">Name it, pick a colour, and add your students</p>
              </div>
            </div>
            <input
              placeholder="Group name e.g. Test Group"
              value={groupForm.name}
              onChange={e => setGroupForm({ ...groupForm, name: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition mb-4"
            />

            <p className="text-xs text-white/40 mb-2">Colour</p>
            <div className="flex gap-2 mb-4">
              {GROUP_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setGroupForm({ ...groupForm, color: c })}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full border-2 transition ${groupForm.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  aria-label={c} />
              ))}
            </div>

            <p className="text-xs text-white/40 mb-2">Add students ({groupForm.members.length} selected)</p>
            <p className="text-xs text-white/30 mb-2">Only students not yet in a group are shown — disband a group to free its members.</p>
            <div className="flex flex-col gap-1 mb-4 max-h-56 overflow-y-auto">
              {(() => {
                const ungrouped = students.filter(s => !s.group_label)
                return ungrouped.length === 0 ? (
                  <p className="text-xs text-white/30">
                    {students.length === 0 ? 'No students yet — add students first.' : 'All students are already in a group.'}
                  </p>
                ) : ungrouped.map(s => {
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
                Create group
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

            <p className="text-xs text-white/40 mb-2">Assign skills</p>
            <div className="flex flex-col gap-2 mb-4">
              {skills.map(skill => {
                const selected = selectedSkills.find(s => s.skill_id === skill.id)
                return (
                  <div key={skill.id} className="flex items-center gap-3">
                    <button
                      onClick={() => toggleSkill(skill.id, selectedSkills, setSelectedSkills)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition ${selected
                        ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                        : 'border-white/10 text-white/40 hover:text-white'}`}>
                      {skill.skill_name}
                    </button>
                    {selected && (
                      <select
                        value={selected.proficiency}
                        onChange={e => updateProficiency(skill.id, parseInt(e.target.value), selectedSkills, setSelectedSkills)}
                        className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-1 text-xs text-white outline-none">
                        <option value={1}>Beginner</option>
                        <option value={2}>Intermediate</option>
                        <option value={3}>Advanced</option>
                      </select>
                    )}
                  </div>
                )
              })}
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

        {/* Group filter — always shown so the filtering ability is visible */}
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          <span className="text-xs text-white/40 mr-1">Group:</span>
          {['all', ...existingGroups, '__none__'].map(g => (
            <button key={g} onClick={() => setGroupFilter(g)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition ${groupFilter === g
                ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                : 'border-white/10 text-white/40 hover:text-white'}`}>
              {g !== 'all' && g !== '__none__' && (
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: groupColor(g) }} />
              )}
              {g === 'all' ? 'All' : g === '__none__' ? 'No group' : g}
            </button>
          ))}
        </div>

        {/* Students list */}
        <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-white">
              Team roster ({shownStudents.length}{groupFilter !== 'all' ? ` of ${students.length}` : ''})
            </p>
            {userRole === 'leader' && groupFilter !== 'all' && groupFilter !== '__none__' && (
              <button onClick={() => disbandGroup(groupFilter)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
                Disband "{groupFilter}"
              </button>
            )}
          </div>
          {loading ? (
            <p className="text-white/40 text-sm">Loading...</p>
          ) : (
            <div className="flex flex-col gap-3">
              {shownStudents.map(s => (
                <div key={s.id} className="bg-white/5 rounded-lg p-3 border"
                  style={{ borderColor: s.group_label ? groupColor(s.group_label) : 'rgba(255,255,255,0.08)' }}>
                  <div className="flex items-stretch gap-4">
                    {/* Left block — identity + skills (avatar vertically centered) */}
                    <div className="flex-1 flex gap-4 items-center">
                      {s.avatar_url ? (
                        <img src={s.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-lg font-semibold shrink-0">
                          {initials(s.name)}
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="flex items-center gap-2 flex-wrap">
                          <Link href={`/students/${s.id}`} className="text-sm font-medium text-white hover:underline">{s.name}</Link>
                          {s.group_label && (
                            <span className="text-xs px-2 py-0.5 rounded-full border"
                              style={{ backgroundColor: `${groupColor(s.group_label)}22`, color: groupColor(s.group_label), borderColor: `${groupColor(s.group_label)}55` }}>
                              {s.group_label}
                            </span>
                          )}
                          {userRole === 'leader' && (() => {
                            const acct = accountFor(s)
                            if (!acct) return (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/30 border border-white/10">
                                no login account
                              </span>
                            )
                            if (acct.role === 'leader') return (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                leader
                              </span>
                            )
                            return null
                          })()}
                        </p>
                        <p className="text-xs text-white/40">{s.matric} · {s.programme} · Year {s.year}</p>
                        <div className="flex gap-2 flex-wrap mt-2">
                          {(s.student_skills || []).length === 0 ? (
                            <span className="text-xs text-white/30">No skills declared</span>
                          ) : s.student_skills.map((ss: any) => (
                            <span key={ss.skill_id} className="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400">
                              {ss.skills?.skill_name} · {PROFICIENCY[ss.proficiency]}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Right block — rating + actions (leader) / See profile (everyone) */}
                    <div className="flex flex-col items-end justify-between gap-3 border-l border-white/10 pl-4 shrink-0">
                      {userRole === 'leader' && stats[s.id] && (
                        <div className="text-right">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${bandClass(stats[s.id].band)}`}>
                            {stats[s.id].band === 'unrated' ? '— unrated' : `${stats[s.id].avg_score} · ${stats[s.id].band}`}
                          </span>
                          <p className="text-[10px] text-white/30 mt-1">{stats[s.id].completed_count} done</p>
                        </div>
                      )}
                      <div className="flex gap-2 flex-wrap justify-end">
                        <Link href={`/students/${s.id}`}
                          className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/60 hover:text-white transition">
                          See profile
                        </Link>
                        {userRole === 'leader' && (
                          <>
                            <button onClick={() => editingStudent === s.id ? setEditingStudent(null) : startEditing(s)}
                              className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/60 hover:text-white transition">
                              {editingStudent === s.id ? 'Cancel' : 'Edit skills'}
                            </button>
                            {(() => {
                              const acct = accountFor(s)
                              if (!acct) return null   // no login account to promote/demote
                              return acct.role === 'leader' ? (
                                <button onClick={() => changeRole(acct, 'student')}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition">
                                  Revoke leader
                                </button>
                              ) : (
                                <button onClick={() => changeRole(acct, 'leader')}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 transition">
                                  Make leader
                                </button>
                              )
                            })()}
                            {s.group_label && (
                              <button onClick={() => removeFromGroup(s.id, s.name, s.group_label)}
                                className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition">
                                Remove from group
                              </button>
                            )}
                            <button onClick={() => removeStudent(s.id, s.name)}
                              className="text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition">
                              Remove from project
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Edit panel — leader only */}
                  {editingStudent === s.id && userRole === 'leader' && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-white/40">Edit skills for {s.name}</p>
                        <label className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/60 hover:text-white cursor-pointer transition">
                          Upload photo
                          <input type="file" accept="image/*" className="hidden"
                            onChange={e => uploadStudentAvatar(s.id, s.name, e.target.files && e.target.files[0] ? e.target.files[0] : undefined)} />
                        </label>
                      </div>
                      <div className="flex flex-col gap-2 mb-3">
                        {skills.map(skill => {
                          const existing = editSkills.find(es => es.skill_id === skill.id)
                          return (
                            <div key={skill.id} className="flex items-center gap-3">
                              <button
                                onClick={() => toggleSkill(skill.id, editSkills, setEditSkills)}
                                className={`text-xs px-3 py-1.5 rounded-lg border transition ${existing
                                  ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                                  : 'border-white/10 text-white/40 hover:text-white'}`}>
                                {skill.skill_name}
                              </button>
                              {existing && (
                                <select
                                  value={existing.proficiency}
                                  onChange={e => updateProficiency(skill.id, parseInt(e.target.value), editSkills, setEditSkills)}
                                  className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-1 text-xs text-white outline-none">
                                  <option value={1}>Beginner</option>
                                  <option value={2}>Intermediate</option>
                                  <option value={3}>Advanced</option>
                                </select>
                              )}
                            </div>
                          )
                        })}
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