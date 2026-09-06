import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const SUPABASE_URL = 'https://dpiwdhtbhwjgatvcfkcb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PSZnTEo74jObih_6TTpXVQ_tJwzTnXY';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const uuid = () => crypto.randomUUID();
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
const dateObj = (value) => new Date(`${value}T12:00:00`);
const fmtDate = (value, opts = { month:'short', day:'numeric', year:'numeric' }) => value ? dateObj(value).toLocaleDateString(undefined, opts) : 'No date';
const dayName = (value) => dateObj(value).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
const isoDate = (d) => d.toISOString().slice(0, 10);

let state = {
  user: null,
  profile: null,
  settings: { theme:'system', notifications_enabled:false, daily_summary:true, week_starts:'monday' },
  tasks: [], occurrences: [], subtasks: [], milestones: [], evaluations: [], categories: [],
  month: new Date(),
  online: navigator.onLine,
  busy: false
};

function setLoading(show, text='Loading Lunar') {
  const el = $('loading');
  if (!el) return;
  if ($('loadingText')) $('loadingText').textContent = text;
  el.classList.toggle('hidden', !show);
}

function toast(message, type='normal') {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function setError(message='') {
  const el = $('authError');
  if (el) el.textContent = message;
}

function applyTheme() {
  const theme = state.settings.theme || 'system';
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

function displayName() {
  return state.profile?.display_name || state.profile?.username || state.user?.user_metadata?.username || state.user?.email?.split('@')[0] || 'there';
}

function priorityRank(value) { return value === 'high' ? 3 : value === 'medium' ? 2 : 1; }
function typeLabel(value) { return value === 'goal' ? 'Goal' : value === 'recurring' ? 'Routine' : 'Task'; }
function getTask(id) { return state.tasks.find(t => t.id === id); }
function getOccurrences(taskId) { return state.occurrences.filter(o => o.task_id === taskId); }
function getTodayOccurrences() { return state.occurrences.filter(o => o.scheduled_date === today()); }

function cacheKey() { return `lunar-cache-${state.user?.id || 'guest'}`; }
function saveCache() {
  if (!state.user) return;
  try { localStorage.setItem(cacheKey(), JSON.stringify({ tasks:state.tasks, occurrences:state.occurrences, subtasks:state.subtasks, milestones:state.milestones, evaluations:state.evaluations, categories:state.categories, settings:state.settings })); } catch {}
}
function loadCache() {
  try { return JSON.parse(localStorage.getItem(cacheKey()) || 'null'); } catch { return null; }
}

async function query(table, options = {}) {
  let q = supabase.from(table).select(options.select || '*');
  if (options.eq) for (const [key, value] of Object.entries(options.eq)) q = q.eq(key, value);
  if (options.order) q = q.order(options.order.column, { ascending: options.order.ascending !== false });
  if (options.limit) q = q.limit(options.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function loadData() {
  if (!state.user) return;
  setLoading(true, 'Loading your progress');
  try {
    const uid = state.user.id;
    const [profile, settings, tasks, occurrences, subtasks, milestones, evaluations, categories] = await Promise.all([
      query('lunar_profiles', { eq:{id:uid}, limit:1 }),
      query('lunar_settings', { eq:{user_id:uid}, limit:1 }),
      query('lunar_tasks', { eq:{user_id:uid}, order:{column:'created_at', ascending:false} }),
      query('lunar_task_occurrences', { eq:{user_id:uid}, order:{column:'scheduled_date', ascending:true} }),
      query('lunar_subtasks', { eq:{user_id:uid}, order:{column:'position', ascending:true} }),
      query('lunar_milestones', { eq:{user_id:uid}, order:{column:'position', ascending:true} }),
      query('lunar_evaluations', { eq:{user_id:uid}, order:{column:'evaluation_date', ascending:false} }),
      query('lunar_categories', { eq:{user_id:uid}, order:{column:'created_at', ascending:true} })
    ]);
    state.profile = profile[0] || null;
    state.settings = { ...state.settings, ...(settings[0] || {}) };
    state.tasks = tasks;
    state.occurrences = occurrences;
    state.subtasks = subtasks;
    state.milestones = milestones;
    state.evaluations = evaluations;
    state.categories = categories;
    markMissedLocally();
    saveCache();
    applyTheme();
    renderEverything();
  } catch (error) {
    console.error(error);
    const cached = loadCache();
    if (cached) {
      Object.assign(state, cached, { user:state.user, profile:state.profile });
      markMissedLocally();
      applyTheme();
      renderEverything();
      toast('You are offline. Showing your saved copy.', 'warn');
    } else {
      toast(error.message || 'Could not load Lunar.', 'error');
      showApp(false);
    }
  } finally {
    setLoading(false);
  }
}

function markMissedLocally() {
  const now = today();
  for (const o of state.occurrences) if (o.status === 'upcoming' && o.scheduled_date < now) o.status = 'missed';
}

function showApp(loggedIn) {
  $('auth')?.classList.toggle('hidden', loggedIn);
  $('app')?.classList.toggle('hidden', !loggedIn);
  if (loggedIn) renderEverything();
}

function stats() {
  const past = state.occurrences.filter(o => o.scheduled_date <= today());
  const done = past.filter(o => o.status === 'completed').length;
  const missed = past.filter(o => o.status === 'missed').length;
  const rate = past.length ? Math.round(done / past.length * 100) : 0;
  return { done, missed, total:past.length, rate, streak:currentStreak() };
}

function currentStreak() {
  const completed = new Set(state.occurrences.filter(o => o.status === 'completed').map(o => o.scheduled_date));
  let cursor = dateObj(today());
  let streak = 0;
  while (completed.has(isoDate(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function bestStreak() {
  const days = [...new Set(state.occurrences.filter(o => o.status === 'completed').map(o => o.scheduled_date))].sort();
  let best = 0, run = 0, previous = null;
  for (const day of days) {
    if (previous && (dateObj(day) - dateObj(previous)) === 86400000) run++;
    else run = 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

function progress(task) {
  const list = getOccurrences(task.id);
  const done = list.filter(o => o.status === 'completed').length;
  return { done, total:list.length, pct:list.length ? Math.round(done/list.length*100) : 0 };
}

function renderEverything() {
  renderHeader();
  renderHome();
  renderTasks();
  renderCategories();
  renderCalendar();
  renderInsights();
  renderHistory();
  renderProfile();
  renderCreateForm();
}

function renderHeader() {
  if ($('topGreeting')) $('topGreeting').textContent = `Good to see you, ${displayName()}`;
  if ($('topDate')) $('topDate').textContent = new Date().toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  if ($('avatar')) $('avatar').textContent = displayName().slice(0,1).toUpperCase();
  if ($('offline')) $('offline').classList.toggle('hidden', state.online);
}

function taskRow(task, occurrence) {
  const done = occurrence.status === 'completed';
  return `<div class="task-row ${done ? 'is-done':''}">
    <button class="check ${done ? 'done':''}" data-complete="${occurrence.id}" aria-label="${done?'Completed':'Complete'}"></button>
    <button class="task-main" data-open-task="${task.id}">
      <strong>${esc(task.title)}</strong>
      <span>${dayName(occurrence.scheduled_date)}${occurrence.scheduled_time ? ` · ${esc(String(occurrence.scheduled_time).slice(0,5))}`:''} · ${typeLabel(task.task_type)}</span>
    </button>
    <span class="priority ${esc(task.priority)}">${esc(task.priority)}</span>
    <button class="icon-mini" data-menu="${task.id}" aria-label="Task menu">•••</button>
  </div>`;
}

function renderHome() {
  const s = stats();
  const todayItems = getTodayOccurrences().sort((a,b) => String(a.scheduled_time||'').localeCompare(String(b.scheduled_time||'')));
  const doneToday = todayItems.filter(o => o.status === 'completed').length;
  if ($('homeTitle')) $('homeTitle').textContent = `Build the day, ${displayName()}.`;
  if ($('stats')) $('stats').innerHTML = [
    ['Today', `${doneToday}/${todayItems.length}`, 'actions completed', todayItems.length ? Math.round(doneToday/todayItems.length*100) : 0],
    ['Current streak', `${s.streak} days`, `Best is ${bestStreak()} days`, null],
    ['Consistency', `${s.rate}%`, `${s.done} completed · ${s.missed} missed`, null],
    ['Active plans', state.tasks.filter(t => t.status === 'active').length, `${state.tasks.filter(t=>t.task_type==='goal'&&t.status==='active').length} active goals`, null]
  ].map(([label,value,foot,pct]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong>${pct !== null ? `<i class="progress"><b style="width:${pct}%"></b></i>`:''}<small>${foot}</small></article>`).join('');
  if ($('todayCount')) $('todayCount').textContent = `${doneToday}/${todayItems.length}`;
  if ($('todayTasks')) $('todayTasks').innerHTML = todayItems.length ? todayItems.map(o => taskRow(getTask(o.task_id) || {title:'Task', priority:'medium', task_type:'one_time'}, o)).join('') : emptyState('Your day is clear.', 'Create one useful action and start small.', 'Create a task');
  const goals = state.tasks.filter(t => t.task_type === 'goal' && t.status === 'active').slice(0,3);
  if ($('goalPreview')) $('goalPreview').innerHTML = goals.length ? goals.map(t => { const p=progress(t); return `<article class="plan-card"><div><span class="eyebrow">Goal</span><h3>${esc(t.title)}</h3><p>${t.end_date ? `Ends ${fmtDate(t.end_date)}` : 'Ongoing'}</p></div><strong>${p.pct}%</strong><i class="progress"><b style="width:${p.pct}%"></b></i><small>${p.done} of ${p.total} actions complete</small></article>`; }).join('') : emptyState('No active goals yet.', 'Give something important a finish line.', 'Create a goal');
  bindDynamic();
}

function renderTasks() {
  const search = ($('taskSearch')?.value || '').trim().toLowerCase();
  const filter = $('taskFilter')?.value || 'all';
  const sort = $('taskSort')?.value || 'new';
  let tasks = [...state.tasks];
  if (search) tasks = tasks.filter(t => `${t.title} ${t.description||''} ${(t.tags||[]).join(' ')}`.toLowerCase().includes(search));
  if (['active','paused','archived'].includes(filter)) tasks = tasks.filter(t => t.status === filter);
  if (['goal','recurring'].includes(filter)) tasks = tasks.filter(t => t.task_type === filter);
  if (filter === 'completed') tasks = tasks.filter(t => progress(t).total && progress(t).pct === 100);
  if (sort === 'priority') tasks.sort((a,b) => priorityRank(b.priority)-priorityRank(a.priority));
  if (sort === 'title') tasks.sort((a,b) => a.title.localeCompare(b.title));
  if (sort === 'start') tasks.sort((a,b) => String(a.start_date).localeCompare(String(b.start_date)));
  if ($('allTasks')) $('allTasks').innerHTML = tasks.length ? tasks.map(t => {
    const p=progress(t); const tags=(t.tags||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('');
    return `<article class="task-card"><div class="task-card-top"><div><span class="eyebrow">${typeLabel(t.task_type)}</span><h3>${esc(t.title)}</h3><p>${t.start_date ? fmtDate(t.start_date) : ''}${t.end_date ? ` → ${fmtDate(t.end_date)}`:''}</p>${tags}</div><span class="priority ${esc(t.priority)}">${esc(t.priority)}</span></div>${p.total ? `<div class="progress"><b style="width:${p.pct}%"></b></div><div class="task-card-foot"><small>${p.done}/${p.total} completed</small><span>${p.pct}%</span></div>`:''}<div class="card-actions"><button class="text-btn" data-open-task="${t.id}">Open</button><button class="text-btn" data-menu="${t.id}">More</button></div></article>`;
  }).join('') : emptyState('Nothing here yet.', 'Create a plan and Lunar will turn it into daily actions.', 'Create something');
  bindDynamic();
}

function emptyState(title, text, action) { return `<div class="empty"><div class="empty-mark">✦</div><strong>${esc(title)}</strong><p>${esc(text)}</p>${action ? `<button class="btn primary" data-view="create">${esc(action)}</button>`:''}</div>`; }

function renderCategories() {
  if ($('category')) $('category').innerHTML = `<option value="">No category</option>${state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="__new">＋ New category</option>`;
}

function renderCreateForm() {
  if ($('startDate') && !$('startDate').value) $('startDate').value = today();
  if ($('endDate') && !$('endDate').value) $('endDate').value = today();
  if ($('recurrenceDays')) $('recurrenceDays').querySelectorAll('.day-chip').forEach(b => b.classList.toggle('active', b.dataset.day === String(new Date().getDay())));
  renderCategories();
}

function renderCalendar() {
  const root = $('calendarGrid'); if (!root) return;
  const month = state.month;
  const year = month.getFullYear(), m = month.getMonth();
  const first = new Date(year,m,1); const offset = (first.getDay()+6)%7;
  const days = new Date(year,m+1,0).getDate();
  const previous = new Date(year,m,0).getDate();
  const cells = [];
  for (let i=0;i<offset;i++) cells.push({day:previous-offset+i+1, muted:true, date:isoDate(new Date(year,m-1,previous-offset+i+1))});
  for (let d=1;d<=days;d++) cells.push({day:d, date:isoDate(new Date(year,m,d))});
  while (cells.length<42) { const d=cells.length-offset-days+1; cells.push({day:d, muted:true, date:isoDate(new Date(year,m+1,d))}); }
  if ($('calendarTitle')) $('calendarTitle').textContent = month.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  root.innerHTML = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<span class="cal-week">${x}</span>`).join('') + cells.map(c => {
    const items=state.occurrences.filter(o=>o.scheduled_date===c.date);
    const dots=items.slice(0,4).map(o=>`<i class="cal-dot ${o.status}"></i>`).join('');
    return `<button class="cal-day ${c.muted?'muted':''} ${c.date===today()?'today':''}" data-cal-date="${c.date}"><span>${c.day}</span><div>${dots}</div></button>`;
  }).join('');
}

function renderInsights() {
  const s=stats();
  if ($('insightStats')) $('insightStats').innerHTML = `<div class="metric"><span>Completion</span><strong>${s.rate}%</strong></div><div class="metric"><span>Best streak</span><strong>${bestStreak()}d</strong></div><div class="metric"><span>Completed</span><strong>${s.done}</strong></div><div class="metric"><span>Missed</span><strong>${s.missed}</strong></div>`;
  if ($('weeklyBars')) {
    const now=dateObj(today()); const start=new Date(now); start.setDate(now.getDate()-6);
    const bars=[]; for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);const key=isoDate(d);const total=state.occurrences.filter(o=>o.scheduled_date===key).length;const done=state.occurrences.filter(o=>o.scheduled_date===key&&o.status==='completed').length;bars.push(`<div class="bar-col"><span>${done}</span><i style="height:${Math.max(4,total?done/total*100:0)}%"></i><small>${d.toLocaleDateString(undefined,{weekday:'narrow'})}</small></div>`)}
    $('weeklyBars').innerHTML=bars.join('');
  }
}

function renderHistory() {
  if (!$('historyList')) return;
  const groups={};
  [...state.occurrences].filter(o=>o.scheduled_date<=today()).sort((a,b)=>b.scheduled_date.localeCompare(a.scheduled_date)).forEach(o=>(groups[o.scheduled_date] ||= []).push(o));
  const dates=Object.keys(groups).slice(0,14);
  $('historyList').innerHTML=dates.length ? dates.map(d=>`<section class="history-day"><strong>${dayName(d)}</strong>${groups[d].map(o=>`<div class="history-item"><span class="history-state ${o.status}">${o.status==='completed'?'✓':o.status==='missed'?'!':'•'}</span><span>${esc(getTask(o.task_id)?.title||'Task')}</span><small>${esc(o.status)}</small></div>`).join('')}</section>`).join('') : emptyState('No history yet.', 'Your completed actions will appear here.');
}

function renderProfile() {
  if ($('profileName')) $('profileName').value = state.profile?.display_name || '';
  if ($('profileUsername')) $('profileUsername').value = state.profile?.username || '';
  if ($('themeSelect')) $('themeSelect').value = state.settings.theme || 'system';
  if ($('dailySummary')) $('dailySummary').classList.toggle('on', !!state.settings.daily_summary);
  if ($('notifications')) $('notifications').classList.toggle('on', !!state.settings.notifications_enabled);
  if ($('profileEmail')) $('profileEmail').textContent = state.user?.email || '';
}

function openView(name) {
  const valid=['home','tasks','create','calendar','insights','history','profile'];
  if (!valid.includes(name)) name='home';
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  history.replaceState(null,'',`#${name}`);
  if(name==='calendar') renderCalendar();
  window.scrollTo({top:0,behavior:'smooth'});
}
window.showView = openView;

async function signIn(event) {
  event.preventDefault(); if (state.busy) return;
  state.busy=true; setError(''); const email=$('authEmail').value.trim(); const password=$('authPassword').value;
  try { const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) throw error; } catch(e) { setError(e.message || 'Could not sign in.'); toast(e.message || 'Sign in failed.','error'); } finally { state.busy=false; }
}

async function signUp(event) {
  event.preventDefault(); if (state.busy) return;
  state.busy=true; setError(''); const email=$('authEmail').value.trim(); const password=$('authPassword').value; const username=$('authUsername').value.trim();
  if(username.length<2){setError('Choose a username with at least 2 characters.');state.busy=false;return;}
  try {
    const {data,error}=await supabase.auth.signUp({email,password,options:{data:{username}}});
    if(error) throw error;
    if(data.session) { await ensureProfile(data.user,username); toast('Welcome to Lunar.'); }
    else { setError('Account created. Check your email to confirm it, then sign in.'); toast('Check your email.'); }
  } catch(e) { setError(e.message || 'Could not create account.'); toast(e.message || 'Sign up failed.','error'); } finally { state.busy=false; }
}

async function ensureProfile(user, username) {
  if(!user) return;
  const {data:existing}=await supabase.from('lunar_profiles').select('*').eq('id',user.id).maybeSingle();
  if(!existing){
    await supabase.from('lunar_profiles').insert({id:user.id,username:username || user.user_metadata?.username || 'lunar',display_name:username || null,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'});
  }
  const {data:settings}=await supabase.from('lunar_settings').select('*').eq('user_id',user.id).maybeSingle();
  if(!settings) await supabase.from('lunar_settings').insert({user_id:user.id,theme:'system',notifications_enabled:false,daily_summary:true,week_starts:'monday'});
}

async function signOut() { await supabase.auth.signOut(); state.user=null; showApp(false); openView('home'); }

async function createCategory(name) {
  const clean=name.trim(); if(!clean || !state.user) return null;
  const row={id:uuid(),user_id:state.user.id,name:clean,icon:'•',created_at:new Date().toISOString()};
  const {error}=await supabase.from('lunar_categories').insert(row); if(error) throw error; state.categories.push(row); renderCategories(); return row.id;
}

function recurrenceDates(task) {
  const start=dateObj(task.start_date); const end=dateObj(task.end_date || task.start_date); const dates=[]; const rule=task.recurrence_rule || {};
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const weekday=d.getDay();
    if(task.task_type==='recurring') { const selected=Array.isArray(rule.days) ? rule.days.map(Number) : [weekday]; if(selected.includes(weekday)) dates.push(isoDate(d)); }
    else dates.push(isoDate(d));
  }
  return dates;
}

async function createTask(event) {
  event.preventDefault(); if(!state.user || state.busy) return;
  const title=$('taskTitle').value.trim(); if(!title){toast('Give the plan a title.','error');return;}
  state.busy=true; setLoading(true,'Building your plan');
  try {
    let categoryId=$('category').value || null;
    if(categoryId==='__new'){ const name=prompt('Category name'); categoryId=name ? await createCategory(name) : null; }
    const type=document.querySelector('input[name="taskType"]:checked')?.value || 'goal';
    const start=$('startDate').value || today(); const end=type==='one_time' ? start : ($('endDate').value || start);
    const rule=type==='recurring' ? {days:[...document.querySelectorAll('.day-chip.active')].map(b=>Number(b.dataset.day))} : null;
    const tags=$('tags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,8);
    const task={id:uuid(),user_id:state.user.id,category_id:categoryId,title,description:$('taskDescription').value.trim()||null,task_type:type,priority:$('priority').value,recurrence_rule:rule,start_date:start,end_date:end,reminder_time:$('reminderTime').value||null,status:'active',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),estimated_minutes:Number($('estimatedMinutes').value)||null,tags};
    const {error}=await supabase.from('lunar_tasks').insert(task); if(error) throw error;
    const dates=recurrenceDates(task); const rows=dates.map((date,index)=>({id:uuid(),task_id:task.id,user_id:state.user.id,scheduled_date:date,scheduled_time:task.reminder_time,status:'upcoming',completed_at:null,duration_minutes:null,notes:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),skipped_at:null,actual_minutes:null,estimated_minutes:task.estimated_minutes,occurrence_key:`${task.id}:${date}`}));
    if(rows.length){const {error:occError}=await supabase.from('lunar_task_occurrences').insert(rows);if(occError)throw occError;}
    const subRows=[...document.querySelectorAll('.subtask-input')].map((input,i)=>input.value.trim()).filter(Boolean).map((title,i)=>({id:uuid(),task_id:task.id,user_id:state.user.id,title,position:i,completed:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}));
    if(subRows.length) await supabase.from('lunar_subtasks').insert(subRows);
    state.tasks.unshift(task); state.occurrences.push(...rows); state.subtasks.push(...subRows); saveCache();
    $('createForm').reset(); $('startDate').value=today(); $('endDate').value=today(); document.querySelector('[data-type="goal"]')?.click();
    toast('Plan created. Keep going.'); renderEverything(); openView('home');
  } catch(e) { console.error(e); toast(e.message || 'Could not create the plan.','error'); }
  finally { state.busy=false; setLoading(false); }
}

async function completeOccurrence(id, button) {
  const occurrence=state.occurrences.find(o=>o.id===id); if(!occurrence || occurrence.status==='completed') return;
  occurrence.status='completed'; occurrence.completed_at=new Date().toISOString(); occurrence.updated_at=new Date().toISOString(); saveCache(); renderEverything(); toast('Done. One more step forward.');
  const {error}=await supabase.from('lunar_task_occurrences').update({status:'completed',completed_at:occurrence.completed_at,updated_at:occurrence.updated_at}).eq('id',id).eq('user_id',state.user.id);
  if(error){ occurrence.status='upcoming'; occurrence.completed_at=null; saveCache(); renderEverything(); toast('Could not save that change.','error'); }
}

async function taskAction(id, action) {
  const task=getTask(id); if(!task) return;
  closeModal();
  const next=getOccurrences(id).find(o=>['upcoming','due'].includes(o.status));
  try {
    if(action==='complete' && next) await completeOccurrence(next.id);
    if(action==='skip' && next){ next.status='skipped'; next.skipped_at=new Date().toISOString(); await supabase.from('lunar_task_occurrences').update({status:'skipped',skipped_at:next.skipped_at}).eq('id',next.id).eq('user_id',state.user.id); renderEverything(); toast('Skipped for now.'); }
    if(action==='pause'||action==='archive'){const status=action==='pause'?(task.status==='paused'?'active':'paused'):(task.status==='archived'?'active':'archived');task.status=status;await supabase.from('lunar_tasks').update({status,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',state.user.id);renderEverything();toast(status==='paused'?'Plan paused.':status==='archived'?'Plan archived.':'Plan active again.');}
    if(action==='delete' && confirm(`Delete “${task.title}” and its history?`)){await supabase.from('lunar_task_occurrences').delete().eq('task_id',id).eq('user_id',state.user.id);await supabase.from('lunar_subtasks').delete().eq('task_id',id).eq('user_id',state.user.id);await supabase.from('lunar_tasks').delete().eq('id',id).eq('user_id',state.user.id);state.tasks=state.tasks.filter(t=>t.id!==id);state.occurrences=state.occurrences.filter(o=>o.task_id!==id);renderEverything();toast('Plan deleted.');}
    if(action==='extend'){const end=dateObj(task.end_date||today());end.setDate(end.getDate()+7);const newEnd=isoDate(end);const extraDates=recurrenceDates({...task,end_date:newEnd}).filter(d=>!getOccurrences(id).some(o=>o.scheduled_date===d));const rows=extraDates.map(d=>({id:uuid(),task_id:id,user_id:state.user.id,scheduled_date:d,scheduled_time:task.reminder_time,status:'upcoming',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),occurrence_key:`${id}:${d}`,completed_at:null,duration_minutes:null,notes:null,skipped_at:null,actual_minutes:null,estimated_minutes:task.estimated_minutes}));task.end_date=newEnd;await supabase.from('lunar_tasks').update({end_date:newEnd,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',state.user.id);if(rows.length)await supabase.from('lunar_task_occurrences').insert(rows);state.occurrences.push(...rows);renderEverything();toast('Plan extended by 7 days.');}
  } catch(e){toast(e.message||'Action failed.','error');}
}

function openTaskMenu(id) {
  const t=getTask(id); if(!t)return;
  openModal(`<div class="modal-head"><div><span class="eyebrow">${typeLabel(t.task_type)}</span><h2>${esc(t.title)}</h2></div><button class="icon-btn" data-close>×</button></div><div class="action-list"><button data-action="complete">Complete next action</button><button data-action="skip">Skip next action</button><button data-action="pause">${t.status==='paused'?'Resume':'Pause'} plan</button><button data-action="extend">Extend by 7 days</button><button data-action="archive">${t.status==='archived'?'Restore':'Archive'} plan</button><button class="danger" data-action="delete">Delete plan</button></div>`);
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>taskAction(id,b.dataset.action));
}

function openTaskDetail(id) {
  const t=getTask(id); if(!t)return; const p=progress(t); const subs=state.subtasks.filter(s=>s.task_id===id);
  openModal(`<div class="modal-head"><div><span class="eyebrow">${typeLabel(t.task_type)} · ${esc(t.priority)}</span><h2>${esc(t.title)}</h2><p class="modal-muted">${esc(t.description||'No description.')}</p></div><button class="icon-btn" data-close>×</button></div><div class="detail-grid"><div><span>Progress</span><strong>${p.pct}%</strong></div><div><span>Actions</span><strong>${p.done}/${p.total}</strong></div><div><span>Start</span><strong>${fmtDate(t.start_date)}</strong></div><div><span>End</span><strong>${t.end_date?fmtDate(t.end_date):'Ongoing'}</strong></div></div>${subs.length?`<div class="sub-list"><h3>Subtasks</h3>${subs.map(s=>`<div><span class="history-state ${s.completed?'completed':''}">${s.completed?'✓':'•'}</span>${esc(s.title)}</div>`).join('')}</div>`:''}`);
}

function openModal(html) { $('modalRoot').innerHTML=`<div class="modal-backdrop" data-close><section class="modal" onclick="event.stopPropagation()">${html}</section></div>`; $('modalRoot').querySelector('[data-close]')?.addEventListener('click',closeModal); }
function closeModal(){if($('modalRoot'))$('modalRoot').innerHTML='';}

async function saveProfile(){if(!state.user)return;const display=$('profileName').value.trim();const username=$('profileUsername').value.trim();if(username.length<2){toast('Username is too short.','error');return;}const {error}=await supabase.from('lunar_profiles').update({display_name:display||null,username,updated_at:new Date().toISOString()}).eq('id',state.user.id);if(error){toast(error.message,'error');return;}state.profile={...state.profile,display_name:display||null,username};renderHeader();toast('Profile saved.');}
async function saveSettings(){const theme=$('themeSelect').value;const daily=$('dailySummary').classList.contains('on');const notifications=$('notifications').classList.contains('on');const patch={theme,daily_summary:daily,notifications_enabled:notifications,updated_at:new Date().toISOString()};const {error}=await supabase.from('lunar_settings').update(patch).eq('user_id',state.user.id);if(error){toast(error.message,'error');return;}state.settings={...state.settings,...patch};applyTheme();toast('Settings saved.');}

function bindDynamic(){
  document.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>completeOccurrence(b.dataset.complete,b));
  document.querySelectorAll('[data-open-task]').forEach(b=>b.onclick=()=>openTaskDetail(b.dataset.openTask));
  document.querySelectorAll('[data-menu]').forEach(b=>b.onclick=()=>openTaskMenu(b.dataset.menu));
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>openView(b.dataset.view));
}

function bindStatic(){
  $('authForm')?.addEventListener('submit', e => state.signup ? signUp(e) : signIn(e));
  $('authSwitch')?.addEventListener('click',()=>{state.signup=!state.signup;$('authSubmit').textContent=state.signup?'Create account':'Sign in';$('authSwitch').textContent=state.signup?'Already have an account? Sign in':'New here? Create an account';$('usernameField').classList.toggle('hidden',!state.signup);setError('');});
  $('signOut')?.addEventListener('click',signOut);
  $('createForm')?.addEventListener('submit',createTask);
  $('taskSearch')?.addEventListener('input',renderTasks);$('taskFilter')?.addEventListener('change',renderTasks);$('taskSort')?.addEventListener('change',renderTasks);
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>openView(b.dataset.view)));
  document.querySelectorAll('[data-type]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-type]').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelector(`input[name="taskType"][value="${b.dataset.type}"]`).checked=true;const recurring=b.dataset.type==='recurring';$('recurrenceBox')?.classList.toggle('hidden',!recurring);$('endField')?.classList.toggle('hidden',b.dataset.type==='one_time');}));
  document.querySelectorAll('.day-chip').forEach(b=>b.addEventListener('click',()=>b.classList.toggle('active')));
  $('prevMonth')?.addEventListener('click',()=>{state.month.setMonth(state.month.getMonth()-1);renderCalendar();});$('nextMonth')?.addEventListener('click',()=>{state.month.setMonth(state.month.getMonth()+1);renderCalendar();});$('todayMonth')?.addEventListener('click',()=>{state.month=new Date();renderCalendar();});
  $('themeSelect')?.addEventListener('change',saveSettings);$('saveProfile')?.addEventListener('click',saveProfile);$('saveSettings')?.addEventListener('click',saveSettings);
  $('notifications')?.addEventListener('click',()=> $('notifications').classList.toggle('on'));$('dailySummary')?.addEventListener('click',()=> $('dailySummary').classList.toggle('on'));
  $('addSubtask')?.addEventListener('click',()=>{const wrap=$('subtasks');const row=document.createElement('div');row.className='subtask-row';row.innerHTML='<input class="subtask-input field-input" type="text" placeholder="Another small step"><button type="button" class="mini-btn remove-sub">×</button>';row.querySelector('.remove-sub').onclick=()=>row.remove();wrap.appendChild(row);});
  $('installApp')?.addEventListener('click',installApp);
  window.addEventListener('online',()=>{state.online=true;renderHeader();toast('Back online.');});window.addEventListener('offline',()=>{state.online=false;renderHeader();toast('Offline mode. Your saved data is still available.','warn');});
  window.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
}

let installPrompt=null;
async function installApp(){if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}else toast('Use your browser menu and choose “Install app”.');}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});

async function init(){
  bindStatic();
  applyTheme();
  const hash=location.hash.replace('#',''); if(hash)openView(hash);
  setLoading(true,'Starting Lunar');
  try {
    const {data:{session}}=await supabase.auth.getSession();
    if(session?.user){state.user=session.user;await ensureProfile(session.user,session.user.user_metadata?.username);showApp(true);await loadData();}
    else showApp(false);
  } catch(e){console.error(e);showApp(false);toast('Lunar could not start. Refresh and try again.','error');}
  finally{setLoading(false);}
  supabase.auth.onAuthStateChange(async (_event,session)=>{if(session?.user){state.user=session.user;await ensureProfile(session.user,session.user.user_metadata?.username);showApp(true);await loadData();}else{state.user=null;showApp(false);}});
}

init();
