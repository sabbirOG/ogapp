import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './App.css'
import { StepCounter } from './native/stepCounter'
import type { StepCounterStatus } from './native/stepCounter'

type Recurrence = 'daily' | 'weekly' | ''
type Task = { id: number; title: string; due: string; tag: string; done: boolean; recurrence?: Recurrence }
type HabitPeriod = 'daily' | 'weekly' | 'monthly'
type Habit = { id: number; name: string; icon: string; color: string; streak: number; period?: HabitPeriod; completedPeriod?: string; completedToday?: boolean }
type Expense = { id: number; title: string; category: string; amount: number; date: string }
type Note = { id: number; title: string; body: string; color: string; updatedAt: string }
type Goal = { id: number; title: string; description: string; target: number; current: number; deadline: string }
type Settings = { name: string; currency: string; timeFormat?: '12h' | '24h' }
type DailyReport = { id: string; date: string; text: string }
type PrayerSchedule = { date: string; timings: Record<string, string>; source: string }

const empty = { tasks: [] as Task[], habits: [] as Habit[], expenses: [] as Expense[], notes: [] as Note[], goals: [] as Goal[], reports: [] as DailyReport[], settings: { name: '', currency: 'USD', timeFormat: '12h' as const } }
const navItems = [
  { label: 'Today', icon: 'home' },
  { label: 'Tasks', icon: 'check' },
  { label: 'Habits', icon: 'activity' },
  { label: 'Money', icon: 'wallet' },
  { label: 'Notes', icon: 'note' },
  { label: 'Goals', icon: 'target' },
  { label: 'Reports', icon: 'note' },
]
const localDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const habitPeriodKey = (date: Date, period: HabitPeriod) => {
  if (period === 'monthly') return `${date.getFullYear()}-${date.getMonth() + 1}`
  if (period === 'weekly') {
    const start = new Date(date)
    start.setDate(date.getDate() - date.getDay())
    return localDateKey(start)
  }
  return localDateKey(date)
}
const habitIsComplete = (habit: Habit, date = new Date()) => {
  const period = habit.period || 'daily'
  return habit.completedPeriod === habitPeriodKey(date, period) || (!habit.completedPeriod && period === 'daily' && habit.completedToday === true)
}

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

function isDueThisMinute(task: Task, now: Date) {
  const due = reminderDate(task.due, now)
  if (!due) return false
  const sameTime = due.getHours() === now.getHours() && due.getMinutes() === now.getMinutes()
  if (!sameTime) return false
  if (task.recurrence === 'daily') return true
  if (task.recurrence === 'weekly') return due.getDay() === now.getDay()
  return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate()
}

function prayerDate(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date
}

async function showAppNotification(title: string, options: NotificationOptions) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  if (registration) {
    await registration.showNotification(title, options)
    return
  }
  new Notification(title, options)
}

function App() {
  const [active, setActive] = useState('Today')
  const [tasks, setTasks] = useStored<Task[]>('tasks', empty.tasks)
  const [habits, setHabits] = useStored<Habit[]>('habits', empty.habits)
  const [expenses, setExpenses] = useStored<Expense[]>('expenses', empty.expenses)
  const [notes, setNotes] = useStored<Note[]>('notes', empty.notes)
  const [goals, setGoals] = useStored<Goal[]>('goals', empty.goals)
  const [reports, setReports] = useStored<DailyReport[]>('reports', empty.reports)
  const [settings, setSettings] = useStored<Settings>('settings', empty.settings)
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [form, setForm] = useState<string | null>(null)
  const [command, setCommand] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [notifications, setNotifications] = useState(() => 'Notification' in window && Notification.permission === 'granted')
  const [clock, setClock] = useState(() => new Date())
  const [prayers, setPrayers] = useState<PrayerSchedule | null>(null)
  const [prayerError, setPrayerError] = useState('')
  const [walking, setWalking] = useState<StepCounterStatus | null>(null)
  const reminded = useRef(new Set<string>())
  const reported = useRef(new Set<string>())

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2400) }
  useEffect(() => {
    let mounted = true
    void StepCounter.getStatus().then((status) => {
      if (!mounted) return
      setWalking(status)
      if (status.available && status.authorized) {
        void StepCounter.startTracking({ goal: status.goal }).then((started) => {
          if (mounted) setWalking(started)
        }).catch(() => undefined)
      }
    }).catch(() => undefined)
    const listener = StepCounter.addListener?.('stepsChanged', (status: StepCounterStatus) => {
      if (mounted) setWalking(status)
    })
    return () => {
      mounted = false
      void listener?.then((handle) => handle.remove())
      void StepCounter.stopTracking().catch(() => undefined)
    }
  }, [])
  const completed = tasks.filter((task) => task.done).length
  const spent = expenses.reduce((sum, item) => sum + item.amount, 0)
  const currency = settings.currency === 'EUR' ? '€' : settings.currency === 'GBP' ? '£' : settings.currency === 'BDT' ? '৳' : '$'
  const displayName = settings.name || 'there'
  const notificationName = settings.name.trim()
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  const filteredTasks = useMemo(() => search ? tasks.filter((task) => `${task.title} ${task.tag}`.toLowerCase().includes(search.toLowerCase())) : tasks, [tasks, search])
  const today = localDateKey(clock)
  const timeFormat = settings.timeFormat || '12h'
  const clockLabel = clock.toLocaleTimeString('en-BD', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: timeFormat === '12h' })
  const formatPrayerTime = (value: string) => {
    const [hour, minute] = value.split(':').map(Number)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '--:--'
    const prayerDateValue = new Date()
    prayerDateValue.setHours(hour, minute, 0, 0)
    return prayerDateValue.toLocaleTimeString('en-BD', { hour: 'numeric', minute: '2-digit', hour12: timeFormat === '12h' })
  }
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    fetch(`https://api.aladhan.com/v1/timingsByCity/${today.split('-').reverse().join('-')}?city=Dhaka&country=Bangladesh&method=3`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Prayer time request failed (${response.status})`)
        return response.json() as Promise<{ data?: { timings?: Record<string, string>; meta?: { method?: { name?: string } } } }>
      })
      .then((payload) => {
        if (!payload.data?.timings) throw new Error('Prayer time response was incomplete')
        setPrayers({ date: today, timings: payload.data.timings, source: payload.data.meta?.method?.name || 'Muslim World League' })
        setPrayerError('')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setPrayerError('Prayer times could not be refreshed. Check your connection.')
      })
    return () => controller.abort()
  }, [today])
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
        const reminderKey = `${task.id}-${localDateKey(now)}`
        if (!task.done && isDueThisMinute(task, now) && !reminded.current.has(reminderKey)) {
        void showAppNotification(notificationName ? `OGApp reminder for ${notificationName}` : 'OGApp reminder', {
          body: notificationName ? `${notificationName}, ${task.title}` : task.title,
          icon: '/ogapp-icon.svg',
          badge: '/ogapp-icon.svg',
          tag: `task-${task.id}`,
          data: { url: `${window.location.origin}/` },
        })
        reminded.current.add(reminderKey)
        }
      })
      if (prayers?.date === localDateKey(now)) {
        ;(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const).forEach((name) => {
          const time = prayers.timings[name]?.split(' ')[0]
          const due = time ? prayerDate(time) : null
          const reminderKey = `prayer-${name}-${localDateKey(now)}`
          if (due && due.getHours() === now.getHours() && due.getMinutes() === now.getMinutes() && !reminded.current.has(reminderKey)) {
            void showAppNotification(notificationName ? `${name} prayer time for ${notificationName}` : `${name} prayer time`, {
              body: notificationName ? `${notificationName}, it is time for ${name} prayer in Dhaka.` : `It is time for ${name} prayer in Dhaka.`,
              icon: '/ogapp-icon.svg',
              badge: '/ogapp-icon.svg',
              tag: reminderKey,
              data: { url: `${window.location.origin}/` },
            })
            reminded.current.add(reminderKey)
          }
        })
      }
    }
    checkReminders()
    const timer = window.setInterval(checkReminders, 60000)
    const resume = () => { if (document.visibilityState === 'visible') checkReminders() }
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [notificationName, prayers, tasks])

  useEffect(() => {
    const checkDailyReport = () => {
      if (document.visibilityState !== 'visible') return
      const now = new Date()
      if (now.getHours() !== 23 || now.getMinutes() !== 0) return
      const date = localDateKey(now)
      if (reported.current.has(date) || reports.some((report) => report.date === date)) return
      const done = tasks.filter((task) => task.done).length
      const spentToday = expenses.filter((expense) => expense.date === date).reduce((sum, expense) => sum + expense.amount, 0)
      const completedHabits = habits.filter((habit) => habitIsComplete(habit, now)).length
      const text = `${notificationName ? `${notificationName}, ` : ''}${done}/${tasks.length} tasks complete · ${completedHabits}/${habits.length} habits complete · ${currency}${spentToday.toFixed(2)} spent today`
      setReports([{ id: date, date, text }, ...reports].slice(0, 90))
      reported.current.add(date)
      if ('Notification' in window && Notification.permission === 'granted') {
        void showAppNotification(notificationName ? `Daily report for ${notificationName}` : 'OGApp daily report', { body: text, icon: '/ogapp-icon.svg', badge: '/ogapp-icon.svg', tag: `daily-report-${date}`, data: { url: `${window.location.origin}/` } })
      }
    }
    checkDailyReport()
    const timer = window.setInterval(checkDailyReport, 60000)
    document.addEventListener('visibilitychange', checkDailyReport)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', checkDailyReport) }
  }, [currency, expenses, habits, notificationName, reports, setReports, tasks])

  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title') || '').trim()
    if (!title) return
    setTasks([...tasks, { id: Date.now(), title, due: String(data.get('due') || 'Anytime'), tag: String(data.get('tag') || 'Personal'), recurrence: String(data.get('recurrence') || '') as Recurrence, done: false }])
    setForm(null); notify('Task created')
  }
  const addHabit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget); const name = String(data.get('name') || '').trim()
    if (!name) return
    setHabits([...habits, { id: Date.now(), name, icon: '', color: 'purple', streak: 0, period: String(data.get('period') || 'daily') as HabitPeriod, completedPeriod: '' }])
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
    const blob = new Blob([JSON.stringify({ tasks, habits, expenses, notes, goals, reports, settings }, null, 2)], { type: 'application/json' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'my-life-backup.json'; link.click(); URL.revokeObjectURL(link.href)
  }
  const resetData = () => {
    if (!window.confirm('Delete all of your data from this device?')) return
    setTasks([]); setHabits([]); setExpenses([]); setNotes([]); setGoals([]); setReports([]); setSettings(empty.settings); notify('All local data deleted')
  }
  const runCommand = () => {
    const text = command.trim()
    if (!text) return
    const lower = text.toLowerCase()
    if (/^(delete|remove)\b/i.test(text)) {
      const wantsLast = /\b(last|latest)\b/i.test(text)
      const requested = text.replace(/^(delete|remove)\s+(?:the\s+)?(?:last\s+)?(?:task|reminder)?\s*/i, '').trim().toLowerCase()
      const candidates = requested ? tasks.filter((task) => task.title.toLowerCase().includes(requested) || requested.includes(task.title.toLowerCase())) : tasks
      const target = wantsLast ? candidates[candidates.length - 1] : candidates[0]
      if (!target) {
        notify('No matching task found')
        setCommand('')
        return
      }
      setTasks(tasks.filter((task) => task.id !== target.id))
      setCommand('')
      notify(`Deleted "${target.title}"`)
    } else if (lower.startsWith('expense ') || lower.startsWith('spent ') || /^(add|spent)\s+\d+(?:\.\d{1,2})?\s*(tk|taka)\b/i.test(text)) {
      const amount = Number(text.match(/(?:\$|usd\s*|tk\s*|taka\s*)?(\d+(?:\.\d{1,2})?)/i)?.[1])
      const title = text.replace(/^(expense|spent|add)\s+/i, '').replace(/(?:\$|usd\s*|tk\s*|taka\s*)?\d+(?:\.\d{1,2})?/i, '').replace(/\s+(on|for)\s+/i, ' ').replace(/\b(tk|taka)\b/i, '').trim()
      if (amount && title) setExpenses([{ id: Date.now(), title, category: 'Other', amount, date: localDateKey(new Date()) }, ...expenses])
      else { setForm('expense'); setCommand(''); return }
    } else if (lower.startsWith('habit ')) {
      const name = text.replace(/^habit\s+/i, '').trim()
      if (name) setHabits([...habits, { id: Date.now(), name, icon: '', color: 'purple', streak: 0, period: 'daily', completedPeriod: '' }])
    } else if (lower.startsWith('note ')) {
      const body = text.replace(/^note\s+/i, '').trim()
      if (body) setNotes([{ id: Date.now(), title: 'Quick note', body, color: 'yellow', updatedAt: new Date().toISOString() }, ...notes])
    } else if (lower.startsWith('goal ')) {
      const title = text.replace(/^goal\s+/i, '').trim()
      if (title) setGoals([...goals, { id: Date.now(), title, description: '', target: 1, current: 0, deadline: '' }])
    } else {
      const recurrence: Recurrence = /\b(daily|every day)\b/i.test(text) ? 'daily' : /\b(weekly|every week)\b/i.test(text) ? 'weekly' : ''
      const cleaned = text.replace(/\b(every day|daily|every week|weekly)\b/ig, '').trim()
      const time = cleaned.match(/\b(0?[1-9]|1[0-2])(?::[0-5]\d)?\s*(am|pm)\b|\b([01]\d|2[0-3]):[0-5]\d\b/i)?.[0]
      const due = time || (/\btomorrow\b/i.test(cleaned) ? 'Tomorrow' : /\btoday\b/i.test(cleaned) ? 'Today' : 'Anytime')
      const title = cleaned.replace(/^(?:create|add|set|schedule|remind)\s+(?:me\s+)?(?:for\s+)?(?:a\s+)?/i, '').replace(/\breminder\b/i, '').replace(/\bat\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|(?:[01]\d|2[0-3]):[0-5]\d)\b/i, '').replace(/\b(namaz|namaj|salah|salat)\b/i, 'Namaj').replace(/\s+/g, ' ').trim() || 'Reminder'
      const normalizedTitle = title.toLowerCase()
      const duplicate = tasks.some((task) => task.title.toLowerCase() === normalizedTitle && task.due.toLowerCase() === due.toLowerCase() && (task.recurrence || '') === recurrence)
      if (duplicate) {
        notify('That reminder already exists')
        setCommand('')
        return
      }
      setTasks([...tasks, { id: Date.now(), title, due, recurrence, tag: 'Personal', done: false }])
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
  const enableWalking = async () => {
    const permission = await StepCounter.requestPermission()
    if (!permission.granted) {
      notify('Activity permission was not granted')
      return
    }
    const status = await StepCounter.startTracking({ goal: 10000 })
    setWalking(status)
    notify(status.available ? 'Walking tracking enabled' : 'Step counter is unavailable on this device')
  }
  const applyUpdate = () => {
    navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' })
    window.location.reload()
  }

  return <div className="app-shell">
    {updateAvailable && <div className="update-banner" role="status"><span>A new OGApp version is ready.</span><button onClick={applyUpdate}>Update now</button></div>}
    <aside className="sidebar">
      <div className="brand"><span>OG<span>App</span></span></div>
      <nav>{navItems.map((item) => <button className={active === item.label ? 'nav-item active' : 'nav-item'} key={item.label} onClick={() => setActive(item.label)}><span className="nav-icon"><Icon name={item.icon} /></span>{item.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy"><span className="privacy-dot" /><div><b>Your data is private</b><small>Stored only on this device</small></div></div><button className="settings" onClick={() => setShowSettings(true)}><span>Settings</span></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><button className="mobile-brand" onClick={() => setActive('Today')}><img src="/ogapp-icon.svg" alt="" /><b>OGApp</b></button><div className="breadcrumb"><span>OGApp</span><b>/</b><strong>{active}</strong></div><div className="top-actions"><button className="icon-button" aria-label="Search" onClick={() => setShowSearch(!showSearch)}>Search</button><button className="avatar" aria-label="Open settings" onClick={() => setShowSettings(true)}><img src="/ogapp-icon.svg" alt="" /></button></div></header>
      {showSearch && <div className="search-bar"><input autoFocus placeholder="Search tasks..." value={search} onChange={(event) => setSearch(event.target.value)} /><button onClick={() => { setSearch(''); setShowSearch(false) }}>Close</button></div>}
      {active === 'Today' ? <Today tasks={filteredTasks} habits={habits} expenses={expenses} walking={walking} onEnableWalking={enableWalking} completed={completed} spent={spent} currency={currency} name={displayName} dateLabel={dateLabel} clockLabel={clockLabel} prayers={prayers} prayerError={prayerError} formatPrayerTime={formatPrayerTime} command={command} setCommand={setCommand} onCommand={runCommand} onTask={(id) => setTasks(tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task))} onHabit={(id) => setHabits(habits.map((habit) => habit.id === id ? { ...habit, completedPeriod: habitIsComplete(habit) ? '' : habitPeriodKey(new Date(), habit.period || 'daily'), completedToday: !habitIsComplete(habit) } : habit))} onAdd={(type) => setForm(type)} onNavigate={setActive} onDelete={remove} /> : <Section active={active} tasks={filteredTasks} habits={habits} expenses={expenses} notes={notes} goals={goals} reports={reports} currency={currency} onAdd={(type) => setForm(type)} onTask={(id) => setTasks(tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task))} onHabit={(id) => setHabits(habits.map((habit) => habit.id === id ? { ...habit, completedPeriod: habitIsComplete(habit) ? '' : habitPeriodKey(new Date(), habit.period || 'daily'), completedToday: !habitIsComplete(habit) } : habit))} onGoal={(id, current) => setGoals(goals.map((goal) => goal.id === id ? { ...goal, current } : goal))} onDelete={remove} />}
    </main>
    {form && <Modal title={`Add ${form}`} onClose={() => setForm(null)}>{form === 'task' && <ItemForm onSubmit={addTask} fields={[['title', 'Task title', 'text'], ['due', 'When? (e.g. 9:00 AM)', 'text'], ['recurrence', 'Repeat: daily, weekly, or blank', 'text'], ['tag', 'Category', 'text']]} />}{form === 'habit' && <ItemForm onSubmit={addHabit} fields={[['name', 'Habit name', 'text'], ['period', 'Track this habit', 'select']]} />}{form === 'expense' && <ItemForm onSubmit={addExpense} fields={[['title', 'What did you spend on?', 'text'], ['amount', 'Amount', 'number'], ['category', 'Category', 'text'], ['date', 'Date', 'date']]} />}{form === 'note' && <ItemForm onSubmit={addNote} fields={[['title', 'Note title', 'text'], ['body', 'Write your note...', 'textarea'], ['color', 'Color: yellow, pink, or blue', 'text']]} />}{form === 'goal' && <ItemForm onSubmit={addGoal} fields={[['title', 'Goal title', 'text'], ['description', 'Why does it matter?', 'textarea'], ['target', 'Number of milestones', 'number'], ['deadline', 'Target date', 'date']]} />}</Modal>}
    {showSettings && <Modal title="Settings" onClose={() => setShowSettings(false)}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setSettings({ name: String(data.get('name') || ''), currency: String(data.get('currency') || 'USD'), timeFormat: String(data.get('timeFormat') || '12h') as '12h' | '24h' }); setShowSettings(false); notify('Settings saved') }}><label>Your name<input name="name" defaultValue={settings.name} placeholder="How should OG greet you?" /></label><label>Currency<select name="currency" defaultValue={settings.currency}><option value="USD">USD ($)</option><option value="BDT">BDT (৳)</option><option value="EUR">EUR (€)</option><option value="GBP">GBP (£)</option></select></label><fieldset className="format-field"><legend>Time format</legend><div className="format-options"><label><input type="radio" name="timeFormat" value="12h" defaultChecked={(settings.timeFormat || '12h') === '12h'} />12-hour <span>1:15 PM</span></label><label><input type="radio" name="timeFormat" value="24h" defaultChecked={settings.timeFormat === '24h'} />24-hour <span>13:15</span></label></div></fieldset><button className="primary-button">Save settings</button></form><div className="settings-actions"><button onClick={enableNotifications}>{notifications ? 'Notifications enabled' : 'Enable notifications'}</button><button onClick={exportData}>Export my data</button><button className="danger-button" onClick={resetData}>Delete all data</button></div><p className="settings-note">Daily reports are generated at 11:00 PM while OGApp is open. Closed-app delivery requires a hosted push service.</p></Modal>}
    <BottomNav active={active} onChange={setActive} />
    {toast && <div className="toast">{toast}</div>}
  </div>
}

function Today({ tasks, habits, expenses, walking, onEnableWalking, completed, spent, currency, name, dateLabel, clockLabel, prayers, prayerError, formatPrayerTime, command, setCommand, onCommand, onTask, onHabit, onAdd, onNavigate, onDelete }: { tasks: Task[]; habits: Habit[]; expenses: Expense[]; walking: StepCounterStatus | null; onEnableWalking: () => void; completed: number; spent: number; currency: string; name: string; dateLabel: string; clockLabel: string; prayers: PrayerSchedule | null; prayerError: string; formatPrayerTime: (value: string) => string; command: string; setCommand: (value: string) => void; onCommand: () => void; onTask: (id: number) => void; onHabit: (id: number) => void; onAdd: (type: string) => void; onNavigate: (page: string) => void; onDelete: (type: string, id: number) => void }) {
  const prayerNames = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
  return <div className="page"><section className="welcome"><div><p className="eyebrow">{dateLabel} · {clockLabel} · Dhaka</p><h1>Good morning, {name}</h1><p className="subtitle">Your private workspace for making today count.</p></div><div className="progress-ring" style={{ background: `conic-gradient(#000 0 ${tasks.length ? completed / tasks.length * 100 : 0}%, #e5e5e5 0)` }}><div><strong>{tasks.length ? Math.round(completed / tasks.length * 100) : 0}%</strong><small>day done</small></div></div></section><section className="card walking-card"><div className="card-heading"><div><p className="eyebrow">WALKING</p><h2>{walking?.available && walking.authorized ? `${walking.steps.toLocaleString()} / ${walking.goal.toLocaleString()} steps` : 'Phone step counter'}</h2></div>{walking?.available && walking.authorized ? <span className="prayer-source">Native tracking</span> : <button className="primary-button" onClick={onEnableWalking}>Enable on Android</button>}</div><p className="subtitle">{walking?.available && walking.authorized ? 'Today is persisted on this device. You will be notified when the goal is reached.' : 'Real step data is available in the Android app only. The web/PWA does not fabricate steps.'}</p></section><section className="command-card"><div><h2>Tell OG what to do</h2></div><div className="command-input"><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onCommand() }} placeholder="Try: remind me for namaj at 1:15pm" /><button onClick={onCommand}>Run</button></div></section><section className="card prayer-card"><div className="card-heading"><div><p className="eyebrow">DHAKA PRAYER TIMES</p><h2>Namaj schedule</h2></div><span className="prayer-source">{prayers?.source || 'Loading...'}</span></div>{prayerError ? <p className="prayer-error">{prayerError}</p> : prayers ? <div className="prayer-list">{prayerNames.map((prayer) => <div key={prayer}><b>{prayer}</b><span>{prayers.timings[prayer] ? formatPrayerTime(prayers.timings[prayer].split(' ')[0]) : '--:--'}</span></div>)}</div> : <p className="subtitle">Getting today&apos;s verified times from Aladhan...</p>}</section><div className="dashboard-grid"><section className="card"><Heading label="YOUR DAY" title={`Tasks ${completed}/${tasks.length}`} action="+ Add task" onAction={() => onAdd('task')} />{tasks.length ? <div className="task-list">{tasks.slice(0, 5).map((task) => <Row key={task.id} done={task.done} onClick={() => onTask(task.id)} onDelete={() => onDelete('task', task.id)} title={task.title} detail={`${task.due}${task.recurrence ? ` · ${task.recurrence}` : ''} · ${task.tag}`} />)}</div> : <Empty text="No tasks yet. Add the first one." onAdd={() => onAdd('task')} label="Add a task" />}<button className="view-all" onClick={() => onNavigate('Tasks')}>View all tasks <span>→</span></button></section><section className="card"><Heading label="KEEP GOING" title={`Habits ${habits.filter((habit) => habitIsComplete(habit)).length}/${habits.length}`} action="+ Add habit" onAction={() => onAdd('habit')} />{habits.length ? <div className="habit-list">{habits.slice(0, 5).map((habit) => <Row key={habit.id} done={habitIsComplete(habit)} onClick={() => onHabit(habit.id)} onDelete={() => onDelete('habit', habit.id)} title={habit.name} detail={`${habit.period || 'daily'} · Streak: ${habit.streak} day${habit.streak === 1 ? '' : 's'}`} circle />)}</div> : <Empty text="Build a routine that works for you." onAdd={() => onAdd('habit')} label="Add a habit" />}</section><section className="card"><Heading label="THIS MONTH" title="Money" action="+ Add expense" onAction={() => onAdd('expense')} /><div className="money-total"><strong>{currency}{spent.toFixed(2)}</strong><span>tracked so far</span></div>{expenses.length ? <div className="expense-list">{expenses.slice(0, 3).map((expense) => <div className="expense" key={expense.id}><span className="expense-icon"><Icon name="wallet" /></span><span><b>{expense.title}</b><small>{expense.category} · {expense.date}</small></span><strong>{currency}{expense.amount.toFixed(2)}</strong></div>)}</div> : <Empty text="Track your first expense." onAdd={() => onAdd('expense')} label="Add expense" />}<button className="view-all" onClick={() => onNavigate('Money')}>View money <span>→</span></button></section><section className="card focus-card"><p className="eyebrow">YOUR WORKSPACE</p><h2>Everything here belongs to OG.</h2><p className="subtitle">No accounts, no tracking, no shared data. Your information stays on this device.</p></section></div></div>
}

function Section({ active, tasks, habits, expenses, notes, goals, reports, currency, onAdd, onTask, onHabit, onGoal, onDelete }: { active: string; tasks: Task[]; habits: Habit[]; expenses: Expense[]; notes: Note[]; goals: Goal[]; reports: DailyReport[]; currency: string; onAdd: (type: string) => void; onTask: (id: number) => void; onHabit: (id: number) => void; onGoal: (id: number, current: number) => void; onDelete: (type: string, id: number) => void }) {
  const configs: Record<string, [string, string]> = { Tasks: ['task', 'Add task'], Habits: ['habit', 'Add habit'], Money: ['expense', 'Add expense'], Notes: ['note', 'Add note'], Goals: ['goal', 'Add goal'], Reports: ['report', ''] }
  const [type, addLabel] = configs[active]
  return <section className="page section-page"><div className="section-heading"><div><p className="eyebrow">OGAPP / {active.toUpperCase()}</p><h1>{active}</h1><p className="subtitle">Your data, your way. Everything is stored on this device.</p></div>{addLabel && <button className="primary-button" onClick={() => onAdd(type)}>+ {addLabel}</button>}</div>{active === 'Reports' && <div className="full-list card">{reports.length ? reports.map((report) => <article className="report-row" key={report.id}><b>{report.date}</b><p>{report.text}</p></article>) : <Empty text="Your daily reports will appear here at 11:00 PM." onAdd={() => undefined} label="" />}</div>}{active === 'Tasks' && <div className="full-list card">{tasks.length ? tasks.map((task) => <Row key={task.id} done={task.done} onClick={() => onTask(task.id)} onDelete={() => onDelete('task', task.id)} title={task.title} detail={`${task.due}${task.recurrence ? ` · ${task.recurrence}` : ''} · ${task.tag}`} />) : <Empty text="You have no tasks." onAdd={() => onAdd('task')} label="Add a task" />}</div>}{active === 'Habits' && <div className="full-list card">{habits.length ? habits.map((habit) => <Row key={habit.id} done={habitIsComplete(habit)} onClick={() => onHabit(habit.id)} onDelete={() => onDelete('habit', habit.id)} title={habit.name} detail={`${habit.period || 'daily'} · Streak: ${habit.streak} day${habit.streak === 1 ? '' : 's'}`} circle />) : <Empty text="You have no habits." onAdd={() => onAdd('habit')} label="Add a habit" />}</div>}{active === 'Money' && <div className="full-list card">{expenses.length ? expenses.map((expense) => <div className="expense" key={expense.id}><span className="expense-icon"><Icon name="wallet" /></span><span><b>{expense.title}</b><small>{expense.category} · {expense.date}</small></span><strong>{currency}{expense.amount.toFixed(2)}</strong><button className="delete-button" onClick={() => onDelete('expense', expense.id)}>×</button></div>) : <Empty text="No expenses tracked." onAdd={() => onAdd('expense')} label="Add an expense" />}</div>}{active === 'Notes' && <div className="notes-grid">{notes.map((note) => <article className={`note ${note.color}`} key={note.id}><button className="note-delete" onClick={() => onDelete('note', note.id)}>×</button><h3>{note.title}</h3><p>{note.body}</p><small>{new Date(note.updatedAt).toLocaleString()}</small></article>)}<button className="new-note" onClick={() => onAdd('note')}>+ New note</button>{!notes.length && <Empty text="Capture a thought, idea, or reminder." onAdd={() => onAdd('note')} label="Add a note" />}</div>}{active === 'Goals' && <div className="goal-list">{goals.map((goal) => <article className="goals-card card" key={goal.id}><button className="delete-button" onClick={() => onDelete('goal', goal.id)}>×</button><div className="goal-top"><span className="goal-icon"><Icon name="target" /></span><div><p className="eyebrow">IN PROGRESS</p><h2>{goal.title}</h2><p>{goal.description}</p></div></div><div className="goal-edit"><input type="range" min="0" max={goal.target} value={goal.current} onChange={(event) => onGoal(goal.id, Number(event.target.value))} /><b>{goal.current}/{goal.target}</b></div></article>)}{!goals.length && <Empty text="Set a goal and track it one milestone at a time." onAdd={() => onAdd('goal')} label="Add a goal" />}</div>}</section>
}

function Heading({ label, title, action, onAction }: { label: string; title: string; action: string; onAction: () => void }) { return <div className="card-heading"><div><p className="eyebrow">{label}</p><h2>{title}</h2></div><button className="text-button" onClick={onAction}>{action}</button></div> }
function Row({ done, onClick, onDelete, title, detail, circle = false }: { done: boolean; onClick: () => void; onDelete: () => void; title: string; detail: string; circle?: boolean }) { return <div className={done ? 'item-row done' : 'item-row'}><button className={circle ? 'check circle' : 'check'} onClick={onClick}>{done ? '✓' : ''}</button><button className="row-copy" onClick={onClick}><b>{title}</b><small>{detail}</small></button><button className="delete-button" onClick={onDelete} aria-label="Delete">×</button></div> }
function Empty({ text, onAdd, label }: { text: string; onAdd: () => void; label: string }) { return <div className="empty-state"><div className="empty-mark">—</div><p>{text}</p><button className="soft-button" onClick={onAdd}>{label}</button></div> }
function BottomNav({ active, onChange }: { active: string; onChange: (page: string) => void }) { return <nav className="bottom-nav">{navItems.map((item) => <button className={active === item.label ? 'bottom-nav-item active' : 'bottom-nav-item'} key={item.label} onClick={() => onChange(item.label)}><span><Icon name={item.icon} /></span>{item.label}</button>)}</nav> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal"><div className="modal-heading"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div></div> }
function ItemForm({ onSubmit, fields }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; fields: [string, string, string][] }) { return <form className="modal-form" onSubmit={onSubmit}>{fields.map(([name, placeholder, type]) => <label key={name}>{placeholder}{name === 'recurrence' ? <select name={name} defaultValue=""><option value="">Once</option><option value="daily">Every day</option><option value="weekly">Every week</option></select> : name === 'period' ? <select name={name} defaultValue="daily"><option value="daily">Track every day</option><option value="weekly">Track every week</option><option value="monthly">Track every month</option></select> : type === 'textarea' ? <textarea name={name} placeholder={placeholder} rows={4} /> : <input required={name === 'title' || name === 'name' || name === 'amount' || name === 'target'} name={name} type={type} placeholder={placeholder} />}</label>)}<button className="primary-button">Save</button></form> }

export default App
