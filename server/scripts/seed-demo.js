// Fills a running Clockwize server with realistic demo data, for UI work and screenshots.
// Point it at a server running on a throwaway database - never at your real one:
//   CLOCKWIZE_DB_PATH=/tmp/demo.db CLOCKWIZE_SESSION_FILE=off PORT=3980 node index.js
//   node scripts/seed-demo.js http://127.0.0.1:3980
// Demo login: demo@clockwize.test / demo-password-1234
const BASE = (process.argv[2] || 'http://127.0.0.1:3980').replace(/\/$/, '');
const DEMO = { email: 'demo@clockwize.test', password: 'demo-password-1234', name: 'נועה לוי' };

let token = null;
let workspaceId = null;

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(workspaceId && { 'X-Workspace-Id': workspaceId })
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const daysAgo = (days, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

async function main() {
  const health = await api('GET', '/health');
  if (health?.status !== 'ok') throw new Error('server not healthy');

  let session;
  try {
    session = await api('POST', '/auth/register', DEMO);
  } catch {
    session = await api('POST', '/auth/login', { email: DEMO.email, password: DEMO.password });
  }
  token = session.token;
  workspaceId = session.currentWorkspace.id;

  const clients = [
    { name: 'סטודיו אורנים', email: 'hello@oranim.test', phone: '050-1234567', hourly_rate: 280, is_favorite: 1 },
    { name: 'קפה ברחוב', email: 'owner@cafe.test', phone: '052-7654321', hourly_rate: 220 },
    { name: 'TechNova Ltd', email: 'ops@technova.test', phone: '03-5551234', hourly_rate: 350 },
    { name: 'עמותת גשר', email: 'info@gesher.test', hourly_rate: 180 }
  ];
  const projectPlans = [
    [0, 'מיתוג מחדש', 'hourly', null, ['קונספט לוגו', 'שפה גרפית', 'מצגת ללקוח']],
    [0, 'אתר תדמית', 'fixed', 12000, ['אפיון', 'עיצוב דף בית', 'פיתוח', 'השקה']],
    [1, 'תפריט דיגיטלי', 'hourly', null, ['צילום מנות', 'עימוד תפריט']],
    [2, 'דשבורד ניהול', 'hourly', null, ['מחקר משתמשים', 'אב-טיפוס', 'בדיקות שמישות', 'מסירה לפיתוח']],
    [2, 'אפליקציית מובייל', 'fixed', 28000, ['Onboarding', 'מסך תשלום']],
    [3, 'קמפיין גיוס', 'hourly', null, ['קופי', 'באנרים']]
  ];

  const createdClients = [];
  for (const client of clients) createdClients.push(await api('POST', '/clients', client));

  const tasks = [];
  for (const [clientIndex, name, pricing, fixed, taskNames] of projectPlans) {
    const project = await api('POST', '/projects', {
      client_id: createdClients[clientIndex].id,
      name,
      pricing_type: pricing,
      fixed_price: fixed,
      hourly_rate: pricing === 'hourly' ? clients[clientIndex].hourly_rate : null,
      estimated_hours: 40
    });
    for (const [i, taskName] of taskNames.entries()) {
      const task = await api('POST', '/tasks', {
        project_id: project.id,
        name: taskName,
        status: i === 0 ? 'completed' : i === 1 ? 'in_progress' : 'pending'
      });
      tasks.push({ project, task });
    }
  }

  // ~3 weeks of work, a few sessions a day on weekdays
  let n = 0;
  for (let day = 20; day >= 0; day--) {
    const weekday = daysAgo(day, 9).getDay();
    if (weekday === 5 || weekday === 6) continue;
    for (const [start, hours] of [[9, 2.5], [13, 1.5], [16, 2]]) {
      if ((day + start) % 3 === 0) continue;
      const { project, task } = tasks[n++ % tasks.length];
      const from = daysAgo(day, start, (n * 7) % 30);
      const to = new Date(from.getTime() + hours * 3600 * 1000);
      await api('POST', '/timer/entries', {
        project_id: project.id,
        task_id: task.id,
        start_time: from.toISOString(),
        end_time: to.toISOString(),
        notes: n % 4 === 0 ? 'פגישת סטטוס עם הלקוח' : ''
      });
    }
  }

  for (const [i, amount] of [4200, 6000, 3500, 9800].entries()) {
    await api('POST', '/payments', {
      project_id: tasks[i * 3].project.id,
      amount,
      date: daysAgo(i * 6 + 2, 12).toISOString(),
      status: i === 3 ? 'pending' : 'paid',
      notes: i === 3 ? 'חשבונית נשלחה' : 'העברה בנקאית'
    });
  }

  for (const lead of [
    { name: 'מאפיית השכונה', company: 'מאפיית השכונה', status: 'new', expected_value: 5000, priority: 'high' },
    { name: 'דני כהן', company: 'כהן ייעוץ', status: 'contacted', expected_value: 12000 },
    { name: 'GreenLeaf', company: 'GreenLeaf', status: 'proposal', expected_value: 30000, priority: 'high' }
  ]) {
    await api('POST', '/leads', lead).catch((e) => console.warn('lead skipped:', e.message));
  }

  // One running timer so the timer UI has something to show
  await api('POST', '/timer/start', { project_id: tasks[4].project.id, task_id: tasks[4].task.id })
    .catch((e) => console.warn('timer skipped:', e.message));

  console.log(`Seeded ${createdClients.length} clients, ${projectPlans.length} projects, ${tasks.length} tasks, ${n} time entries.`);
  console.log(`Login: ${DEMO.email}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
