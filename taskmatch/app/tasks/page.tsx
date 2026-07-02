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
const PAGE_SIZE = 5
const SEVERITIES = ['Low', 'Medium', 'Critical']
const GROUP_COLORS = ['#a78bfa', '#34d399', '#38bdf8', '#fbbf24', '#fb7185', '#2dd4bf', '#fb923c', '#f472b6']

export default function Tasks() {
  const router = useRouter()
  const [tasks, setTasks] = useState<any[]>([])
  const [skills, setSkills] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string>('')
  const [userEmail, setUserEmail] = useState<string>('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ description: '', committed_hours: '', severity: '', start_date: '', due_date: '', group_label: '' })
  const [groupFilter, setGroupFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [groups, setGroups] = useState<any[]>([])
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupForm, setGroupForm] = useState<{ name: string, color: string, members: string[] }>({ name: '', color: GROUP_COLORS[0], members: [] })
  const [taskSkills, setTaskSkills] = useState<{ skill_id: string, min_proficiency: number }[]>([])
  const [recommendations, setRecommendations] = useState<{ [task_id: string]: any[] }>({})
  const [recMeta, setRecMeta] = useState<{ [task_id: string]: { suggested_pair: any, assigned_count: number } }>({})
  const [recPage, setRecPage] = useState<{ [task_id: string]: number }>({})
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [taskAssignees, setTaskAssignees] = useState<{ [task_id: string]: any[] }>({})

  useEffect(() => {
    // Open with a status filter if the dashboard (or a link) passed ?status=...
    const fromUrl = new URLSearchParams(window.location.search).get('status')
    if (fromUrl) setStatusFilter(fromUrl)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setUserEmail(session.user.email || '')
      setUserRole(session.user.user_metadata?.role || 'student')
    })
    fetchTasks()
    fetchSkills()
    fetchGroups()
  }, [])

  const fetchTasks = async () => {
    const { data } = await supabase
      .from('tasks')
      .select('*, task_skills(skill_id, min_proficiency, skills(skill_name))')
      .order('status')
    setTasks(data || [])
    setLoading(false)
  }

  const fetchGroups = async () => {
    const { data } = await supabase.from('groups').select('*')
    setGroups(data || [])
  }

  const groupColor = (name: string) => groups.find(g => g.name === name)?.color || '#a78bfa'

  const createGroup = async () => {
    const name = groupForm.name.trim()
    if (!name) return alert('Enter a group name')
    // Reuse an existing group (e.g. one made on the Students page) or create a new one.
    const existing = groups.find(g => g.name === name)
    if (!existing) {
      const { error } = await supabase.from('groups').insert({ name, color: groupForm.color, created_by: userEmail })
      if (error) return alert(error.message)
    }
    if (groupForm.members.length > 0) {
      await supabase.from('tasks').update({ group_label: name }).in('id', groupForm.members)
    }
    await logActivity({
      action: 'group.tasks_assigned', entity_type: 'group',
      summary: `Assigned ${groupForm.members.length} task${groupForm.members.length === 1 ? '' : 's'} to group '${name}'`,
      details: { members: groupForm.members, existing: !!existing },
    })
    setGroupForm({ name: '', color: GROUP_COLORS[0], members: [] })
    setShowGroupForm(false)
    fetchGroups()
    fetchTasks()
  }

  const fetchSkills = async () => {
    const { data } = await supabase.from('skills').select('*')
    setSkills(data || [])
  }

  const createTask = async () => {
    if (!form.description) return alert('Enter a task description')
    if (taskSkills.length === 0) return alert('Select at least one required skill')

    const severity = form.severity || 'Medium'  // default only if left unset
    const { data, error } = await supabase.from('tasks').insert({
      description: form.description,
      committed_hours: parseFloat(form.committed_hours) || null,
      severity,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      group_label: form.group_label.trim() || null,
      status: 'New'
    }).select().single()

    if (error) return alert(error.message)

    await supabase.from('task_skills').insert(
      taskSkills.map(s => ({ task_id: data.id, skill_id: s.skill_id, min_proficiency: s.min_proficiency }))
    )

    await logActivity({
      action: 'task.created', entity_type: 'task', entity_id: data.id,
      summary: `Created task '${form.description}' (${severity}${form.committed_hours ? `, ${form.committed_hours}h` : ''}${form.group_label ? `, group ${form.group_label}` : ''})`,
      details: { description: form.description, severity, committed_hours: form.committed_hours, group_label: form.group_label, skills: taskSkills },
    })

    setForm({ description: '', committed_hours: '', severity: '', start_date: '', due_date: '', group_label: '' })
    setTaskSkills([])
    setShowForm(false)
    fetchTasks()
  }

  const fetchAssignees = async (task_id: string) => {
    const { data } = await supabase
      .from('assignments')
      .select('id, student_id, status, score, students(name)')
      .eq('task_id', task_id)
    setTaskAssignees(prev => ({ ...prev, [task_id]: data || [] }))
  }

  const loadRecommendations = async (task_id: string) => {
    if (expandedTask === task_id) { setExpandedTask(null); return }
    setExpandedTask(task_id)
    setRecPage(prev => ({ ...prev, [task_id]: 0 }))
    fetchAssignees(task_id)          // who's actually on it (shown for started tasks)
    if (recommendations[task_id]) return
    try {
      const res = await axios.get(`${API}/recommend/${task_id}`)
      setRecommendations(prev => ({ ...prev, [task_id]: res.data.recommendations }))
      setRecMeta(prev => ({ ...prev, [task_id]: { suggested_pair: res.data.suggested_pair, assigned_count: res.data.assigned_count } }))
    } catch {
      setRecommendations(prev => ({ ...prev, [task_id]: [] }))
    }
  }

  const assignStudent = async (task_id: string, student_id: string, name: string) => {
    if (assigning) return           // ignore rapid double-clicks while a request is in flight
    setAssigning(student_id)
    try {
      await axios.post(`${API}/assign`, { task_id, student_id, actor_email: userEmail, actor_role: userRole })
      const res = await axios.get(`${API}/recommend/${task_id}`)
      setRecommendations(prev => ({ ...prev, [task_id]: res.data.recommendations }))
      setRecMeta(prev => ({ ...prev, [task_id]: { suggested_pair: res.data.suggested_pair, assigned_count: res.data.assigned_count } }))
      fetchAssignees(task_id)
      fetchTasks()
      alert(`✅ ${name} assigned!`)
    } catch (err: any) {
      alert(`❌ ${err.response?.data?.detail || 'Failed'}`)
    } finally {
      setAssigning(null)
    }
  }

  const deleteTask = async (id: string, description: string) => {
  if (!confirm(`Delete "${description}"?`)) return
  await supabase.from('task_skills').delete().eq('task_id', id)
  await supabase.from('assignments').delete().eq('task_id', id)
  await supabase.from('tasks').delete().eq('id', id)
  await logActivity({ action: 'task.deleted', entity_type: 'task', entity_id: id, summary: `Deleted task '${description}'` })
  fetchTasks()
}

const updateTaskStatus = async (id: string, status: string) => {
  await supabase.from('tasks').update({ status }).eq('id', id)
  await logActivity({ action: 'task.status_changed', entity_type: 'task', entity_id: id, summary: `Task status set to ${status}`, details: { status } })
  fetchTasks()
}

  const statusColor = (status: string) => {
    if (status === 'New') return 'bg-yellow-500/20 text-yellow-400'
    if (status === 'In Progress') return 'bg-green-500/20 text-green-400'
    if (status === 'Completed') return 'bg-blue-500/20 text-blue-400'
    return 'bg-white/10 text-white/40'
  }

  const severityColor = (severity: string) => {
    if (severity === 'Critical') return 'bg-red-500/20 text-red-400'
    if (severity === 'Medium') return 'bg-amber-500/20 text-amber-400'
    if (severity === 'Low') return 'bg-white/10 text-white/50'
    return 'bg-white/10 text-white/40'
  }

  // SLA-style states. Delayed = breached & not done (active). Closed = breached
  // & not done past the grace window (auto-locked). Late = delivered after due.
  const GRACE_DAYS = 7
  const todayStr = new Date().toISOString().slice(0, 10)
  const daysOverdue = (due: string) => Math.floor((Date.parse(todayStr) - Date.parse(due)) / 86400000)
  const isClosed = (t: any) => t.status !== 'Completed' && t.due_date && daysOverdue(t.due_date) > GRACE_DAYS
  const isDelayed = (t: any) => t.status !== 'Completed' && t.due_date && t.due_date < todayStr && !isClosed(t)
  const isLate = (t: any) => t.status === 'Completed' && t.completed_at && t.completed_at.slice(0, 10) > t.due_date

  const bandChip = (band: string, avg: number | null) => {
    const map: { [k: string]: string } = {
      high: 'bg-emerald-500/20 text-emerald-400',
      avg: 'bg-amber-500/20 text-amber-400',
      low: 'bg-red-500/20 text-red-400',
      unrated: 'bg-white/10 text-white/40',
    }
    const label = band === 'unrated' ? '— unrated' : `${band} ${avg ?? ''}`.trim()
    return <span className={`text-xs px-2 py-0.5 rounded-full ${map[band] || map.unrated}`}>{label}</span>
  }

  const initials = (name: string) =>
    name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  const existingGroups = Array.from(new Set(tasks.map(t => t.group_label).filter(Boolean))) as string[]
  const byGroup = groupFilter === 'all'
    ? tasks
    : groupFilter === '__none__'
      ? tasks.filter(t => !t.group_label)
      : tasks.filter(t => t.group_label === groupFilter)
  const shownTasks = byGroup.filter(t => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'Delayed') return isDelayed(t)
    if (statusFilter === 'Closed') return isClosed(t)
    if (statusFilter === 'Late') return isLate(t)
    return t.status === statusFilter
  })

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <main className="flex-1 p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Tasks</h1>
            <p className="text-xs text-white/40 mt-1">Click a task to see recommendations</p>
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
                + New task
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
                <p className="text-sm font-medium text-white">Create / assign group</p>
                <p className="text-xs text-white/40">Name it (or reuse an existing group), pick a colour, and add tasks</p>
              </div>
            </div>

            <input
              list="task-group-names"
              placeholder="Group name e.g. Test Group"
              value={groupForm.name}
              onChange={e => setGroupForm({ ...groupForm, name: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition mb-4"
            />
            <datalist id="task-group-names">
              {groups.map(g => <option key={g.id} value={g.name} />)}
            </datalist>

            <p className="text-xs text-white/40 mb-2">Colour <span className="text-white/25">(used only when creating a new group)</span></p>
            <div className="flex gap-2 mb-4">
              {GROUP_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setGroupForm({ ...groupForm, color: c })}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full border-2 transition ${groupForm.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  aria-label={c} />
              ))}
            </div>

            <p className="text-xs text-white/40 mb-2">Add tasks ({groupForm.members.length} selected)</p>
            <div className="flex flex-col gap-1 mb-4 max-h-56 overflow-y-auto">
              {tasks.length === 0 ? (
                <p className="text-xs text-white/30">No tasks yet — create a task first.</p>
              ) : tasks.map(t => {
                const checked = groupForm.members.includes(t.id)
                return (
                  <button key={t.id} type="button"
                    onClick={() => setGroupForm(prev => ({
                      ...prev,
                      members: checked ? prev.members.filter(id => id !== t.id) : [...prev.members, t.id],
                    }))}
                    className={`flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg border transition ${checked
                      ? 'border-indigo-500 bg-indigo-500/20 text-white'
                      : 'border-white/10 text-white/50 hover:text-white'}`}>
                    <span className={`w-3.5 h-3.5 rounded-sm border shrink-0 ${checked ? 'bg-indigo-400 border-indigo-400' : 'border-white/30'}`} />
                    {t.description} <span className="text-white/30">· {t.status}</span>
                    {t.group_label && <span className="ml-auto text-white/30">now: {t.group_label}</span>}
                  </button>
                )
              })}
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

        {/* Create task form */}
        {showForm && userRole === 'leader' && (
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-5 mb-6">
            <p className="text-sm font-medium text-white mb-4">New task</p>
            <div className="flex flex-col gap-3 mb-4">
              <input
                placeholder="Task description e.g. Build login page"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="text-xs text-white/30 mb-1">Severity</label>
                  <select
                    value={form.severity}
                    onChange={e => setForm({ ...form, severity: e.target.value })}
                    className={`bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-indigo-500 transition ${form.severity ? 'text-white' : 'text-white/30'}`}>
                    <option value="" disabled hidden>Severity</option>
                    {SEVERITIES.map(s => <option key={s} value={s} className="text-white">{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-white/30 mb-1">Committed hours</label>
                  <input
                    placeholder="e.g. 8"
                    value={form.committed_hours}
                    onChange={e => setForm({ ...form, committed_hours: e.target.value })}
                    className="bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="text-xs text-white/30 mb-1">Start date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={e => setForm({ ...form, start_date: e.target.value })}
                    className={`bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition ${form.start_date ? 'text-white' : 'text-white/30'}`}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-white/30 mb-1">Due date</label>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={e => setForm({ ...form, due_date: e.target.value })}
                    className={`bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 transition ${form.due_date ? 'text-white' : 'text-white/30'}`}
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <label className="text-xs text-white/30 mb-1">Group / team</label>
                <input
                  list="task-groups"
                  placeholder="Type new or pick existing"
                  value={form.group_label}
                  onChange={e => setForm({ ...form, group_label: e.target.value })}
                  className="bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500 transition"
                />
                <datalist id="task-groups">
                  {existingGroups.map(g => <option key={g} value={g} />)}
                </datalist>
              </div>
            </div>

            <p className="text-xs text-white/40 mb-2">Required skills</p>
            <div className="flex flex-col gap-2 mb-4">
              {skills.map(skill => {
                const selected = taskSkills.find(s => s.skill_id === skill.id)
                return (
                  <div key={skill.id} className="flex items-center gap-3">
                    <button
                      onClick={() => setTaskSkills(prev =>
                        prev.find(s => s.skill_id === skill.id)
                          ? prev.filter(s => s.skill_id !== skill.id)
                          : [...prev, { skill_id: skill.id, min_proficiency: 1 }]
                      )}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition ${selected
                        ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                        : 'border-white/10 text-white/40 hover:text-white'}`}>
                      {skill.skill_name}
                    </button>
                    {selected && (
                      <select
                        value={selected.min_proficiency}
                        onChange={e => setTaskSkills(prev =>
                          prev.map(s => s.skill_id === skill.id
                            ? { ...s, min_proficiency: parseInt(e.target.value) }
                            : s
                          )
                        )}
                        className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-1 text-xs text-white outline-none">
                        <option value={1}>Min: Beginner</option>
                        <option value={2}>Min: Intermediate</option>
                        <option value={3}>Min: Advanced</option>
                      </select>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex gap-3">
              <button onClick={createTask}
                className="text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
                Create task
              </button>
              <button onClick={() => { setShowForm(false); setTaskSkills([]) }}
                className="text-sm px-4 py-2 border border-white/10 text-white/60 hover:text-white rounded-lg transition">
                Cancel
              </button>
              <button onClick={() => { setForm({ description: '', committed_hours: '', severity: '', start_date: '', due_date: '', group_label: '' }); setTaskSkills([]) }}
                className="ml-auto text-sm px-4 py-2 border border-white/10 text-white/60 hover:text-white rounded-lg transition">
                Clear all
              </button>
            </div>
          </div>
        )}

        {/* Status + Group filters */}
        <div className="flex gap-3 mb-4 flex-wrap items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Status:</span>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white outline-none">
              <option value="all">All</option>
              <option value="New">New</option>
              <option value="In Progress">Ongoing</option>
              <option value="Completed">Completed</option>
              <option value="Late">Completed · Late</option>
              <option value="Delayed">Delayed</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <div className="w-px h-5 bg-white/10" />
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

        {/* Tasks list */}
        <div className="flex flex-col gap-3">
          {loading ? (
            <p className="text-white/40 text-sm">Loading...</p>
          ) : shownTasks.length === 0 ? (
            <p className="text-white/40 text-sm">{tasks.length === 0 ? 'No tasks yet.' : 'No tasks in this group.'}</p>
          ) : (
            shownTasks.map(task => (
              <div key={task.id} className="bg-[#1a1a1a] border rounded-xl overflow-hidden"
                style={{ borderColor: task.group_label ? groupColor(task.group_label) : 'rgba(255,255,255,0.1)' }}>
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-white/5 transition"
                  onClick={() => loadRecommendations(task.id)}>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{task.description}</p>
                    <div className="flex gap-2 mt-1 flex-wrap items-center">
                      {task.severity && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${severityColor(task.severity)}`}>
                          {task.severity}
                        </span>
                      )}
                      {task.group_label && (
                        <span className="text-xs px-2 py-0.5 rounded-full border"
                          style={{ backgroundColor: `${groupColor(task.group_label)}22`, color: groupColor(task.group_label), borderColor: `${groupColor(task.group_label)}55` }}>
                          {task.group_label}
                        </span>
                      )}
                      {task.task_skills?.map((ts: any) => (
                        <span key={ts.skill_id} className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                          {ts.skills?.skill_name} · {PROFICIENCY[ts.min_proficiency]}+
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-xs text-white/40 shrink-0">
                    {task.committed_hours != null && <p>{task.committed_hours}h committed</p>}
                    {(task.start_date || task.due_date) && (
                      <p>{task.start_date || '…'} → {task.due_date || '…'}</p>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${statusColor(task.status)}`}>
                    {task.status}
                  </span>
                  {isLate(task) && (
                    <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-400" title={`Delivered after due ${task.due_date}`}>
                      Late
                    </span>
                  )}
                  {isDelayed(task) && (
                    <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400" title={`SLA breached — past due ${task.due_date}`}>
                      Delayed
                    </span>
                  )}
                  {isClosed(task) && (
                    <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/50" title={`Auto-closed — overdue more than ${GRACE_DAYS} days`}>
                      Closed 🔒
                    </span>
                  )}
                  {userRole === 'leader' && (
                    <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                      <select
                        value={task.status}
                        onChange={e => updateTaskStatus(task.id, e.target.value)}
                        disabled={isClosed(task)}
                        title={isClosed(task) ? 'Closed — locked' : ''}
                        className="bg-[#1a1a1a] border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none disabled:opacity-40">
                        <option value="New">New</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                      </select>
                      <button
                        onClick={() => deleteTask(task.id, task.description)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition">
                        Delete
                      </button>
                    </div>
                  )}
                  <Link href={`/tasks/${task.id}`} onClick={e => e.stopPropagation()}
                    className="text-xs text-white/40 hover:text-white border border-white/10 rounded-lg px-2 py-1 transition">
                    Open ↗
                  </Link>
                  <span className="text-white/30 text-xs">{expandedTask === task.id ? '▲' : '▼'}</span>
                </div>

                {/* Expanded panel: assigned team + (for open tasks) recommendations */}
                {expandedTask === task.id && (
                  <div className="border-t border-white/10 p-4">
                    {/* Who's actually on it — shown once the task has started */}
                    <p className="text-xs text-white/40 mb-2">Assigned team ({(taskAssignees[task.id] || []).length})</p>
                    {(taskAssignees[task.id] || []).length === 0 ? (
                      <p className="text-white/40 text-xs mb-4">No one assigned yet.</p>
                    ) : (
                      <div className="flex flex-col gap-2 mb-4">
                        {taskAssignees[task.id].map((a: any) => (
                          <div key={a.id} className="flex items-center gap-3 bg-white/5 rounded-lg p-2.5">
                            <div className="w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-semibold shrink-0">{initials(a.students?.name)}</div>
                            <span className="flex-1 text-sm text-white">{a.students?.name}</span>
                            {a.score != null && <span className="text-xs text-white/40">score {a.score}</span>}
                            <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(a.status)}`}>{a.status}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {task.status === 'Completed' || isClosed(task) ? (
                      <p className="text-white/30 text-xs italic">{isClosed(task) ? 'Task closed — assignment locked.' : 'Task completed.'}</p>
                    ) : (
                    <>
                    <p className="text-xs text-white/40 mb-3">{task.status === 'New' ? 'Recommended students' : 'Recommended to add'}</p>
                    {!recommendations[task.id] ? (
                      <p className="text-white/40 text-xs">Loading...</p>
                    ) : (() => {
                      const assignedIds = new Set((taskAssignees[task.id] || []).map((a: any) => a.student_id))
                      const list = recommendations[task.id].filter((r: any) => !assignedIds.has(r.student_id))
                      const meta = recMeta[task.id]
                      if (list.length === 0) return <p className="text-white/40 text-xs">No more students to add.</p>
                      const page = recPage[task.id] || 0
                      const pageCount = Math.ceil(list.length / PAGE_SIZE)
                      const start = page * PAGE_SIZE
                      const pageItems = list.slice(start, start + PAGE_SIZE)
                      return (
                        <>
                          {meta?.suggested_pair && (
                            <div className="mb-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
                              <p className="text-xs font-medium text-indigo-300 mb-1">⚖️ Suggested balanced pair</p>
                              <p className="text-xs text-white/60">{meta.suggested_pair.reason}</p>
                            </div>
                          )}
                          {meta && meta.assigned_count < 2 && (
                            <div className="mb-3 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                              ⚠ This task has {meta.assigned_count} assignee{meta.assigned_count === 1 ? '' : 's'} — assign at least 2 people.
                            </div>
                          )}
                          <div className="flex flex-col gap-2">
                            {pageItems.map((r: any) => (
                              <div key={r.student_id} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${r.qualified ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white/10 text-white/40'}`}>
                                  {initials(r.name)}
                                </div>
                                <div className="flex-1">
                                  <p className="text-sm text-white flex items-center gap-2 flex-wrap">
                                    {r.name}
                                    {bandChip(r.band, r.avg_score)}
                                    {!r.qualified && (
                                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                                        {r.over_wip ? 'WIP full' : 'Skills below min'}
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-xs text-white/40">
                                    Skill match {r.match_score}/3 · {r.met_count}/{r.total_required} skills ·{' '}
                                    <span className={r.wip >= 2 ? 'text-orange-400' : 'text-green-400'}>WIP {r.wip}/3</span>
                                  </p>
                                  <p className="text-xs text-white/30 mt-0.5 italic">{r.justification}</p>
                                </div>
                                {userRole === 'leader' && (
                                  <button
                                    onClick={() => assignStudent(task.id, r.student_id, r.name)}
                                    disabled={r.over_wip || isClosed(task) || assigning === r.student_id}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:hover:bg-transparent">
                                    {assigning === r.student_id ? 'Assigning…' : 'Assign'}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>

                          {pageCount > 1 && (
                            <div className="flex items-center justify-between mt-3">
                              <span className="text-xs text-white/40">
                                {start + 1}–{Math.min(start + PAGE_SIZE, list.length)} of {list.length}
                              </span>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setRecPage(prev => ({ ...prev, [task.id]: page - 1 }))}
                                  disabled={page === 0}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:hover:bg-transparent">
                                  ← Prev
                                </button>
                                <button
                                  onClick={() => setRecPage(prev => ({ ...prev, [task.id]: page + 1 }))}
                                  disabled={page >= pageCount - 1}
                                  className="text-xs px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:bg-white/10 transition disabled:opacity-30 disabled:hover:bg-transparent">
                                  Next →
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )
                    })()}
                    </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  )
}