import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './App.css'

type Task = { id: number; title: string; due: string; tag: string; done: boolean }
type Habit = { id: number; name: string; icon: string; color: string; streak: number; completedToday: boolean }
type Expense = { id: number; title: string; category: string; amount: number; date: string }
type Note = { id: number; title: string; body: string; color: string; updatedAt: string }
type Goal = { id: number; title: string; description: string; target: number; current: number; deadline: string }
type Settings = { name: string; currency: string }

const empty = { tasks: [] as Task[], habits: [] as Habit[], expenses: [] as Expense[], notes: [] as Note[], goals: [] as Goal[], settings: { name: '', currency: 'USD' } }
const navItems = [
  { label: 'Today', icon: 'home' },
  { label: 'Tasks', icon: 'check' },
  { label: 'Habits', icon: 'activity' },
  { label: 'Money', icon: 'wallet' },
  { label: 'Notes', icon: 'note' },
  { label: 'Goals', icon: 'target' },
]

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 5-5 5 5" /><path d="M4 9v5h8V9" /></>,
    check: <><path d="m3 7 3 3 6-7" /><path d="M3 14h10" /></>,
    activity: <path d="M2 8h2l2-4 3 9 2-5h3" />,
    wallet: <><path d="M2.5 5.5h9v8h-9z" /><path d="M9 8.5h3v3H9" /></>,
    note: <><path d="M3 2.5h8v11H3z" /><path d="M5 5.5h4M5 8h4M5 10.5h3" /></>,
    target: <><circle cx="7" cy="8" r="5" /><circle cx="7" cy="8" r="2" /><path d="m10.5 4.5 2-2" /></>,
  }
  return <svg className="icon" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.home}</svg>
}

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const request = indexedDB.open('my-life-db-v2', 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('data')) request.result.createObjectStore('data') }
    request.onerror = () => setReady(true)
    request.onsuccess = () => {
      const read = request.result.transaction('data', 'readonly').objectStore('data').get(key)
      read.onsuccess = () => { if (read.result !== undefined) setValue(read.result as T); setReady(true) }
      read.onerror = () => setReady(true)
    }
  }, [key])
  useEffect(() => {
    if (!ready) return
    const request = indexedDB.open('my-life-db-v2', 1)
    request.onsuccess = () => request.result.transaction('data', 'readwrite').objectStore('data').put(value, key)
  }, [key, value, ready])
  return [value, setValue] as const
}

function reminderDate(due: string, now: Date) {
  const match = due.match(/\b(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*(am|pm)\b|\b([01]\d|2[0-3]):([0-5]\d)\b/i)
  if (!match) return null
  const hour12 = match[1] ? Number(match[1]) : null
  const minute = Number(match[2] ?? match[5] ?? 0)
  const meridiem = match[3]?.toLowerCase()
  const hour = hour12 === null ? Number(match[4]) : (hour12 % 12) + (meridiem === 'pm' ? 12 : 0)
  const date = new Date(now)
  if (/\btomorrow\b/i.test(due)) date.setDate(date.getDate() + 1)
  date.setHours(hour, minute, 0, 0)
  return date
}

function App() {
  const [active, setActive] = useState('Today')
  const [tasks, setTasks] = useStored<Task[]>('tasks', empty.tasks)
  const [habits, setHabits] = useStored<Habit[]>('habits', empty.habits)
  const [expenses, setExpenses] = useStored<Expense[]>('expenses', empty.expenses)
  const [notes, setNotes] = useStored<Note[]>('notes', empty.notes)
  const [goals, setGoals] = useStored<Goal[]>('goals', empty.goals)
  const [settings, setSettings] = useStored<Settings>('settings', empty.settings)
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [form, setForm] = useState<string | null>(null)
  const [command, setCommand] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [notifications, setNotifications] = useState(() => 'Notification' in window && Notification.permission === 'granted')
  const reminded = useRef(new Set<number>())

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2400) }
  const completed = tasks.filter((task) => task.done).length
  const spent = expenses.reduce((sum, item) => sum + item.amount, 0)
  const currency = settings.currency === 'EUR' ? '€' : settings.currency === 'GBP' ? '£' : '$'
  const displayName = settings.name || 'there'
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  const filteredTasks = useMemo(() => search ? tasks.filter((task) => `${task.title} ${task.tag}`.toLowerCase().includes(search.toLowerCase())) : tasks, [tasks, search])
  useEffect(() => {
    const syncPermission = () => setNotifications('Notification' in window && Notification.permission === 'granted')
    window.addEventListener('focus', syncPermission)
    document.addEventListener('visibilitychange', syncPermission)
    return () => {
      window.removeEventListener('focus', syncPermission)
      document.removeEventListener('visibilitychange', syncPermission)
    }
  }, [])

  useEffect(() => {
    const showUpdate = () => setUpdateAvailable(true)
    window.addEventListener('ogapp-update-available', showUpdate)
    return () => window.removeEventListener('ogapp-update-available', showUpdate)
  }, [])

  useEffect(() => {
    const checkReminders = () => {
      if (document.visibilityState !== 'visible') return
      if (!('Notification' in window) || Notification.permission !== 'granted') return
      const now = new Date()
      tasks.forEach((task) => {
        const due = reminderDate(task.due, now)
        const sameMinute = due && due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate() && due.getHours() === now.getHours() && due.getMinutes() === now.getMinutes()
        if (!task.done && sameMinute && !reminded.current.has(task.id)) {
          const showReminder = async () => {
            const registration = await navigator.serviceWorker?.ready
            if (registration) {
              await registration.showNotification('OGApp reminder', {
                body: task.title,
                icon: '/ogapp-icon.svg',
                badge: '/ogapp-icon.svg',
                tag: `task-${task.id}`,
                data: { url: `${window.location.origin}/` },
              })
            } else {
              new Notification('OGApp reminder', { body: task.title, tag: `task-${task.id}` })
            }
          }
          void showReminder()
          reminded.current.add(task.id)
        }
      })
    }
    checkReminders()
    const timer = window.setInterval(checkReminders, 60000)
    const resume = () => { if (document.visibilityState === 'visible') checkReminders() }
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [tasks])

  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') || '').trim()
    if (!title) return
    setTasks([...tasks, { id: Date.now(), title, due: String(data.get('due') || 'Anytime'), tag: String(data.get('tag') || 'Personal'), done: false }])
    setForm(null); notify('Task created')
  }
  const addHabit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget); const name = String(data.get('name') || '').trim()
    if (!name) return
    setHabits([...habits, { id: Date.now(), name, icon: '', color: 'purple', streak: 0, completedToday: false }])
    setForm(null); notify('Habit created')
  }
  const addExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget); const amount = Number(data.get('amount'))
    if (!String(data.get('title') || '').trim() || !Number.isFinite(amount) || amount <= 0) return
    setExpenses([{ id: Date.now(), title: String(data.get('title')), category: String(data.get('category') || 'Other'), amount, date: String(data.get('date') || new Date().toISOString().slice(0, 10)) }, ...expenses])
    setForm(null); notify('Expense saved')
  }
  const addNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget); const title = String(data.get('title') || '').trim()
    if (!title) return
    setNotes([{ id: Date.now(), title, body: String(data.get('body') || ''), color: String(data.get('color') || 'yellow'), updatedAt: new Date().toISOString() }, ...notes])
    setForm(null); notify('Note saved')
  }
  const addGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget); const title = String(data.get('title') || '').trim(); const target = Number(data.get('target'))
    if (!title || !target) return
    setGoals([...goals, { id: Date.now(), title, description: String(data.get('description') || ''), target, current: 0, deadline: String(data.get('deadline') || '') }])
    setForm(null); notify('Goal created')
  }
  const remove = (type: string, id: number) => {
    if (!window.confirm('Delete this item?')) return
    if (type === 'task') setTasks(tasks.filter((item) => item.id !== id))
    if (type === 'habit') setHabits(habits.filter((item) => item.id !== id))
    if (type === 'expense') setExpenses(expenses.filter((item) => item.id !== id))
    if (type === 'note') setNotes(notes.filter((item) => item.id !== id))
    if (type === 'goal') setGoals(goals.filter((item) => item.id !== id))
    notify('Deleted')
  }
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ tasks, habits, expenses, notes, goals, settings }, null, 2)], { type: 'application/json' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'my-life-backup.json'; link.click(); URL.revokeObjectURL(link.href)
  }
  const resetData = () => {
    if (!window.confirm('Delete all of your data from this device?')) return
    setTasks([]); setHabits([]); setExpenses([]); setNotes([]); setGoals([]); notify('All local data deleted')
  }
  const runCommand = () => {
    const text = command.trim()
    if (!text) return
    const lower = text.toLowerCase()
    if (lower.startsWith('expense ') || lower.startsWith('spent ')) {
      const amount = Number(text.match(/(?:\$|usd\s*)?(\d+(?:\.\d{1,2})?)/i)?.[1])
      const title = text.replace(/^(expense|spent)\s+/i, '').replace(/(?:\$|usd\s*)?\d+(?:\.\d{1,2})?/i, '').replace(/\s+(on|for)\s+/i, ' ').trim()
      if (amount && title) setExpenses([{ id: Date.now(), title, category: 'Other', amount, date: new Date().toISOString().slice(0, 10) }, ...expenses])
      else { setForm('expense'); setCommand(''); return }
    } else if (lower.startsWith('habit ')) {
      const name = text.replace(/^habit\s+/i, '').trim()
      if (name) setHabits([...habits, { id: Date.now(), name, icon: '', color: 'purple', streak: 0, completedToday: false }])
    } else if (lower.startsWith('note ')) {
      const body = text.replace(/^note\s+/i, '').trim()
      if (body) setNotes([{ id: Date.now(), title: 'Quick note', body, color: 'yellow', updatedAt: new Date().toISOString() }, ...notes])
    } else if (lower.startsWith('goal ')) {
      const title = text.replace(/^goal\s+/i, '').trim()
      if (title) setGoals([...goals, { id: Date.now(), title, description: '', target: 1, current: 0, deadline: '' }])
    } else {
      const due = /\btomorrow\b/i.test(text) ? 'Tomorrow' : /\btoday\b/i.test(text) ? 'Today' : 'Anytime'
      setTasks([...tasks, { id: Date.now(), title: text, due, tag: 'Personal', done: false }])
    }
    setCommand('')
    notify('Command completed')
  }
  const enableNotifications = async () => {
    if (!('Notification' in window)) { notify('Notifications are not supported in this browser'); return }
    const permission = await Notification.requestPermission()
    setNotifications(permission === 'granted')
    notify(permission === 'granted' ? 'Notifications enabled' : 'Notification permission was not granted')
  }
  const applyUpdate = () => {
    navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' })
    window.location.reload()
  }

  return <div className="app-shell">
    {updateAvailable && <div className="update-banner" role="status"><span>A new OGApp version is ready.</span><button onClick={applyUpdate}>Update now</button></div>}
    <aside className="sidebar">
      <div className="brand"><img className="brand-mark" src="/ogapp-icon.svg" alt="OGApp" /><span>OG<span>App</span></span></div>
      <nav>{navItems.map((item) => <button className={active === item.label ? 'nav-item active' : 'nav-item'} key={item.label} onClick={() => setActive(item.label)}><span className="nav-icon"><Icon name={item.icon} /></span>{item.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy"><span className="privacy-dot" /><div><b>Your data is private</b><small>Stored only on this device</small></div></div><button className="settings" onClick={() => setShowSettings(true)}><span>Settings</span></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><button className="mobile-brand" onClick={() => setActive('Today')}><img src="/ogapp-icon.svg" alt="" /><b>OGApp</b></button><div className="breadcrumb"><span>OGApp</span><b>/</b><strong>{active}</strong></div><div className="top-actions"><button className="icon-button" aria-label="Search" onClick={() => setShowSearch(!showSearch)}>Search</button><button className="avatar" aria-label="Open settings" onClick={() => setShowSettings(true)}><img src="/ogapp-icon.svg" alt="" /></button></div></header>
      {showSearch && <div className="search-bar"><input autoFocus placeholder="Search tasks..." value={search} onChange={(event) => setSearch(event.target.value)} /><button onClick={() => { setSearch(''); setShowSearch(false) }}>Close</button></div>}
      {active === 'Today' ? <Today tasks={filteredTasks} habits={habits} expenses={expenses} completed={completed} spent={spent} currency={currency} name={displayName} dateLabel={dateLabel} command={command} setCommand={setCommand} onCommand={runCommand} onTask={(id) => setTasks(tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task))} onHabit={(id) => setHabits(habits.map((habit) => habit.id === id ? { ...habit, completedToday: !habit.completedToday, streak: habit.completedToday ? Math.max(0, habit.streak - 1) : habit.streak + 1 } : habit))} onAdd={(type) => setForm(type)} onNavigate={setActive} onDelete={remove} /> : <Section active={active} tasks={filteredTasks} habits={habits} expenses={expenses} notes={notes} goals={goals} currency={currency} onAdd={(type) => setForm(type)} onTask={(id) => setTasks(tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task))} onHabit={(id) => setHabits(habits.map((habit) => habit.id === id ? { ...habit, completedToday: !habit.completedToday, streak: habit.completedToday ? Math.max(0, habit.streak - 1) : habit.streak + 1 } : habit))} onGoal={(id, current) => setGoals(goals.map((goal) => goal.id === id ? { ...goal, current } : goal))} onDelete={remove} />}
    </main>
    {form && <Modal title={`Add ${form}`} onClose={() => setForm(null)}>{form === 'task' && <ItemForm onSubmit={addTask} fields={[['title', 'Task title', 'text'], ['due', 'When? (e.g. 9:00 AM)', 'text'], ['tag', 'Category', 'text']]} />}{form === 'habit' && <ItemForm onSubmit={addHabit} fields={[['name', 'Habit name', 'text']]} />}{form === 'expense' && <ItemForm onSubmit={addExpense} fields={[['title', 'What did you spend on?', 'text'], ['amount', 'Amount', 'number'], ['category', 'Category', 'text'], ['date', 'Date', 'date']]} />}{form === 'note' && <ItemForm onSubmit={addNote} fields={[['title', 'Note title', 'text'], ['body', 'Write your note...', 'textarea'], ['color', 'Color: yellow, pink, or blue', 'text']]} />}{form === 'goal' && <ItemForm onSubmit={addGoal} fields={[['title', 'Goal title', 'text'], ['description', 'Why does it matter?', 'textarea'], ['target', 'Number of milestones', 'number'], ['deadline', 'Target date', 'date']]} />}</Modal>}
    {showSettings && <Modal title="Settings" onClose={() => setShowSettings(false)}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setSettings({ name: String(data.get('name') || ''), currency: String(data.get('currency') || 'USD') }); setShowSettings(false); notify('Settings saved') }}><label>Your name<input name="name" defaultValue={settings.name} placeholder="How should OG greet you?" /></label><label>Currency<select name="currency" defaultValue={settings.currency}><option value="USD">USD ($)</option><option value="EUR">EUR (€)</option><option value="GBP">GBP (£)</option></select></label><button className="primary-button">Save settings</button></form><div className="settings-actions"><button onClick={enableNotifications}>{notifications ? 'Notifications enabled' : 'Enable notifications'}</button><button onClick={exportData}>Export my data</button><button className="danger-button" onClick={resetData}>Delete all data</button></div><p className="settings-note">Browser notifications work after permission is granted. Scheduled delivery depends on the browser and device; reliable background push requires a server.</p></Modal>}
    <BottomNav active={active} onChange={setActive} />
    {toast && <div className="toast">{toast}</div>}
  </div>
}

function Today({ tasks, habits, expenses, completed, spent, currency, name, dateLabel, command, setCommand, onCommand, onTask, onHabit, onAdd, onNavigate, onDelete }: { tasks: Task[]; habits: Habit[]; expenses: Expense[]; completed: number; spent: number; currency: string; name: string; dateLabel: string; command: string; setCommand: (value: string) => void; onCommand: () => void; onTask: (id: number) => void; onHabit: (id: number) => void; onAdd: (type: string) => void; onNavigate: (page: string) => void; onDelete: (type: string, id: number) => void }) {
  return <div className="page"><section className="welcome"><div><p className="eyebrow">{dateLabel}</p><h1>Good morning, {name}</h1><p className="subtitle">Your private workspace for making today count.</p></div><div className="progress-ring" style={{ background: `conic-gradient(#000 0 ${tasks.length ? completed / tasks.length * 100 : 0}%, #e5e5e5 0)` }}><div><strong>{tasks.length ? Math.round(completed / tasks.length * 100) : 0}%</strong><small>day done</small></div></div></section><section className="command-card"><div><p className="eyebrow">COMMAND CENTER</p><h2>Tell OG what to do</h2><p>Try “Call Sam tomorrow”, “expense 25 lunch”, “habit read”, or “note buy milk”.</p></div><div className="command-input"><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onCommand() }} placeholder="What should I organize?" /><button onClick={onCommand}>Run</button></div></section><div className="dashboard-grid"><section className="card"><Heading label="YOUR DAY" title={`Tasks ${completed}/${tasks.length}`} action="+ Add task" onAction={() => onAdd('task')} />{tasks.length ? <div className="task-list">{tasks.slice(0, 5).map((task) => <Row key={task.id} done={task.done} onClick={() => onTask(task.id)} onDelete={() => onDelete('task', task.id)} title={task.title} detail={`${task.due} · ${task.tag}`} />)}</div> : <Empty text="No tasks yet. Add the first one." onAdd={() => onAdd('task')} label="Add a task" />}<button className="view-all" onClick={() => onNavigate('Tasks')}>View all tasks <span>→</span></button></section><section className="card"><Heading label="KEEP GOING" title={`Habits ${habits.filter((habit) => habit.completedToday).length}/${habits.length}`} action="+ Add habit" onAction={() => onAdd('habit')} />{habits.length ? <div className="habit-list">{habits.slice(0, 5).map((habit) => <Row key={habit.id} done={habit.completedToday} onClick={() => onHabit(habit.id)} onDelete={() => onDelete('habit', habit.id)} title={habit.name} detail={`Streak: ${habit.streak} day${habit.streak === 1 ? '' : 's'}`} circle />)}</div> : <Empty text="Build a routine that works for you." onAdd={() => onAdd('habit')} label="Add a habit" />}</section><section className="card"><Heading label="THIS MONTH" title="Money" action="+ Add expense" onAction={() => onAdd('expense')} /><div className="money-total"><strong>{currency}{spent.toFixed(2)}</strong><span>tracked so far</span></div>{expenses.length ? <div className="expense-list">{expenses.slice(0, 3).map((expense) => <div className="expense" key={expense.id}><span className="expense-icon"><Icon name="wallet" /></span><span><b>{expense.title}</b><small>{expense.category} · {expense.date}</small></span><strong>{currency}{expense.amount.toFixed(2)}</strong></div>)}</div> : <Empty text="Track your first expense." onAdd={() => onAdd('expense')} label="Add expense" />}<button className="view-all" onClick={() => onNavigate('Money')}>View money <span>→</span></button></section><section className="card focus-card"><p className="eyebrow">YOUR WORKSPACE</p><h2>Everything here belongs to OG.</h2><p className="subtitle">No accounts, no tracking, no shared data. Your information stays on this device.</p></section></div></div>
}

function Section({ active, tasks, habits, expenses, notes, goals, currency, onAdd, onTask, onHabit, onGoal, onDelete }: { active: string; tasks: Task[]; habits: Habit[]; expenses: Expense[]; notes: Note[]; goals: Goal[]; currency: string; onAdd: (type: string) => void; onTask: (id: number) => void; onHabit: (id: number) => void; onGoal: (id: number, current: number) => void; onDelete: (type: string, id: number) => void }) {
  const configs: Record<string, [string, string]> = { Tasks: ['task', 'Add task'], Habits: ['habit', 'Add habit'], Money: ['expense', 'Add expense'], Notes: ['note', 'Add note'], Goals: ['goal', 'Add goal'] }
  const [type, addLabel] = configs[active]
  return <section className="page section-page"><div className="section-heading"><div><p className="eyebrow">OGAPP / {active.toUpperCase()}</p><h1>{active}</h1><p className="subtitle">Your data, your way. Everything is stored on this device.</p></div><button className="primary-button" onClick={() => onAdd(type)}>+ {addLabel}</button></div>{active === 'Tasks' && <div className="full-list card">{tasks.length ? tasks.map((task) => <Row key={task.id} done={task.done} onClick={() => onTask(task.id)} onDelete={() => onDelete('task', task.id)} title={task.title} detail={`${task.due} · ${task.tag}`} />) : <Empty text="You have no tasks." onAdd={() => onAdd('task')} label="Add a task" />}</div>}{active === 'Habits' && <div className="full-list card">{habits.length ? habits.map((habit) => <Row key={habit.id} done={habit.completedToday} onClick={() => onHabit(habit.id)} onDelete={() => onDelete('habit', habit.id)} title={habit.name} detail={`Streak: ${habit.streak} day${habit.streak === 1 ? '' : 's'}`} circle />) : <Empty text="You have no habits." onAdd={() => onAdd('habit')} label="Add a habit" />}</div>}{active === 'Money' && <div className="full-list card">{expenses.length ? expenses.map((expense) => <div className="expense" key={expense.id}><span className="expense-icon"><Icon name="wallet" /></span><span><b>{expense.title}</b><small>{expense.category} · {expense.date}</small></span><strong>{currency}{expense.amount.toFixed(2)}</strong><button className="delete-button" onClick={() => onDelete('expense', expense.id)}>×</button></div>) : <Empty text="No expenses tracked." onAdd={() => onAdd('expense')} label="Add an expense" />}</div>}{active === 'Notes' && <div className="notes-grid">{notes.map((note) => <article className={`note ${note.color}`} key={note.id}><button className="note-delete" onClick={() => onDelete('note', note.id)}>×</button><h3>{note.title}</h3><p>{note.body}</p><small>{new Date(note.updatedAt).toLocaleString()}</small></article>)}<button className="new-note" onClick={() => onAdd('note')}>+ New note</button>{!notes.length && <Empty text="Capture a thought, idea, or reminder." onAdd={() => onAdd('note')} label="Add a note" />}</div>}{active === 'Goals' && <div className="goal-list">{goals.map((goal) => <article className="goals-card card" key={goal.id}><button className="delete-button" onClick={() => onDelete('goal', goal.id)}>×</button><div className="goal-top"><span className="goal-icon"><Icon name="target" /></span><div><p className="eyebrow">IN PROGRESS</p><h2>{goal.title}</h2><p>{goal.description}</p></div></div><div className="goal-edit"><input type="range" min="0" max={goal.target} value={goal.current} onChange={(event) => onGoal(goal.id, Number(event.target.value))} /><b>{goal.current}/{goal.target}</b></div></article>)}{!goals.length && <Empty text="Set a goal and track it one milestone at a time." onAdd={() => onAdd('goal')} label="Add a goal" />}</div>}</section>
}

function Heading({ label, title, action, onAction }: { label: string; title: string; action: string; onAction: () => void }) { return <div className="card-heading"><div><p className="eyebrow">{label}</p><h2>{title}</h2></div><button className="text-button" onClick={onAction}>{action}</button></div> }
function Row({ done, onClick, onDelete, title, detail, circle = false }: { done: boolean; onClick: () => void; onDelete: () => void; title: string; detail: string; circle?: boolean }) { return <div className={done ? 'item-row done' : 'item-row'}><button className={circle ? 'check circle' : 'check'} onClick={onClick}>{done ? '✓' : ''}</button><button className="row-copy" onClick={onClick}><b>{title}</b><small>{detail}</small></button><button className="delete-button" onClick={onDelete} aria-label="Delete">×</button></div> }
function Empty({ text, onAdd, label }: { text: string; onAdd: () => void; label: string }) { return <div className="empty-state"><div className="empty-mark">—</div><p>{text}</p><button className="soft-button" onClick={onAdd}>{label}</button></div> }
function BottomNav({ active, onChange }: { active: string; onChange: (page: string) => void }) { return <nav className="bottom-nav">{navItems.map((item) => <button className={active === item.label ? 'bottom-nav-item active' : 'bottom-nav-item'} key={item.label} onClick={() => onChange(item.label)}><span><Icon name={item.icon} /></span>{item.label}</button>)}</nav> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal"><div className="modal-heading"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div></div> }
function ItemForm({ onSubmit, fields }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; fields: [string, string, string][] }) { return <form className="modal-form" onSubmit={onSubmit}>{fields.map(([name, placeholder, type]) => <label key={name}>{placeholder}{type === 'textarea' ? <textarea name={name} placeholder={placeholder} rows={4} /> : <input required={name === 'title' || name === 'name' || name === 'amount' || name === 'target'} name={name} type={type} placeholder={placeholder} />}</label>)}<button className="primary-button">Save</button></form> }

export default App
