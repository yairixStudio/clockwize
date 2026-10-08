# Backlog

Small, non-urgent tasks for this project. Harvest Season (`harvest-season`) does the `open` ones before Claude's weekly quota resets, each on its own `backlog/*` branch, never pushed — and waits for your approval to merge. Proposals (`proposed`) don't run until you say yes.

<!--
Format: one task per "##" section, one "- key: value" per line. Keys in English, values in any language.
status:     open · proposed · blocked · done · dropped
added:      YYYY-MM-DD
priority:   1 high · 2 normal · 3 low
complexity: low · medium · high   (picks the model — `models` in the settings; by default low→Sonnet, medium→Opus, high→Fable)
tokens:     rough estimate of total agent tokens incl. ~60k fixed overhead (low ≈ 100k, medium ≈ 200k, high ≈ 400k)
details:    what to do and what counts as done; name files/areas
result:     filled by the agent — date · branch · what changed (in the owner's language) · actual tokens
cleared:    set when the owner clears a done task from the widget's done list (date); the task stays here
-->

## Fix /clients links that point to a missing route
- status: done
- added: 2026-10-08
- priority: 3
- complexity: low
- tokens: 30000
- details: client/src/pages/ClientDetail.jsx links the 'לקוחות' breadcrumb to /clients (~line 736) and calls navigate('/clients') after deleting a client (~lines 174, 299), but App.jsx has no /clients route, so the catch-all silently redirects to /. Point them at '/' (the dashboard lists clients) or add a real route. Done when no code references the /clients path without a matching route and the e2e suite (npm run test:e2e) still passes.
- result: 2026-10-08 · feature/desktop-app-tests-ux · הקישורים והניווט ל-/clients הופנו לדשבורד (שמציג את הלקוחות)

## Associate form labels with their inputs (htmlFor/id)
- status: done
- added: 2026-10-08
- priority: 3
- complexity: medium
- tokens: 80000
- details: Forms in client/src (Login.jsx, Register.jsx, ClientModal.jsx, ProjectModal.jsx, TaskModal.jsx and other modals) render <label className="form-label"> as a sibling of the control with no htmlFor/id, so screen readers and Playwright getByLabel can't resolve them (e2e/helpers.js has a field() workaround). Add useId-based id/htmlFor pairs. Done when getByLabel('שם לקוח *') etc. resolve in the e2e specs, client unit tests and npm run test:e2e pass.
- result: 2026-10-08 · feature/backlog-fixes · כל התוויות בטפסים ובמודאלים מקושרות לשדות (useId), ה-e2e משתמש ב-getByLabel

## Make the closed mobile sidebar inert
- status: done
- added: 2026-10-08
- priority: 3
- complexity: low
- tokens: 30000
- details: On mobile (<=768px) client/src/components/Layout.jsx keeps the off-canvas sidebar (links and the 'סגור תפריט' button) in the accessibility tree and tab order while it is closed. Add the inert attribute (or aria-hidden + tabIndex=-1) to the <aside> when isMobile && !isMobileSidebarOpen. Done when e2e/mobile.spec.js still passes and, when closed, the sidebar links are not reachable with Tab.
- result: 2026-10-08 · feature/desktop-app-tests-ux · הסיידבר הסגור במובייל מקבל inert, כך שאינו נגיש ב-Tab ובקורא מסך

## Fix forced password reset bypass on login
- status: done
- added: 2026-10-08
- priority: 1
- complexity: medium
- tokens: 200000
- details: client/src/App.jsx GuestRoute + client/src/store/useStore.js:100 completeAuth: when the server answers requiresPasswordReset, completeAuth marks the user authenticated and GuestRoute redirects to / before Login.jsx opens its reset prompt, so the admin-forced reset never happens. Also the new-password prompt renders type=text (client/src/components/Modal/CustomModal.jsx:91 ignores the 'password' type passed from Login.jsx:93). Done when the it.fails tests in client/src/App.test.jsx pass as normal tests, the prompt masks the password, and client unit tests + npm run test:e2e pass.
- result: 2026-10-08 · feature/backlog-fixes · איפוס כפוי נאכף גם בשרת (token ייעודי ל-15 דקות, אין session לפני האיפוס), שדה הסיסמה מוסתר, הגבלת ניסיונות

## Make addon enablement per workspace, not per user
- status: done
- added: 2026-10-08
- priority: 2
- complexity: medium
- tokens: 200000
- details: server/database.js:409 user_addons has UNIQUE(user_id, addon_id), so a member of two workspaces gets a 500 when enabling the same addon in the second one. Rebuild the table with UNIQUE(workspace_id, addon_id) in a migration that keeps existing rows (back up first). Done when the it.fails test 'a member of two workspaces can toggle the same addon in both' in server/tests/catalog-sources-addons.test.js passes as a normal test and npm --prefix server test is green.
- result: 2026-10-08 · feature/backlog-fixes · מפתח ייחודי (workspace_id, addon_id) עם migration שנבדק על עותק; גם integrations

## Stop account deletion and workspace deletion from orphaning or wiping shared data
- status: done
- added: 2026-10-08
- priority: 2
- complexity: medium
- tokens: 200000
- details: server/database.js: clients.user_id is ON DELETE CASCADE, so a member deleting their account wipes clients (and their projects/entries) they created in someone else's workspace; deleting a workspace (server/routes/workspaces.js:154) leaves its clients/projects/entries orphaned because workspace_id has no FK. Decide ownership by workspace: reassign or keep shared records, and delete workspace-scoped rows explicitly when a workspace is deleted. Done when the two it.fails tests in server/tests/auth-profile-admin.test.js:113 and server/tests/workspaces-isolation.test.js:380 pass as normal tests.
- result: 2026-10-08 · feature/backlog-fixes · מחיקת workspace מוחקת את כל הנתונים שלו; מחיקת חשבון מעבירה רשומות משותפות לבעלים

## Fix monthly recurrence on the 29th-31st
- status: done
- added: 2026-10-08
- priority: 3
- complexity: low
- tokens: 100000
- details: server/routes/reminders.js:217 and server/routes/planned-slots.js:38 use setMonth for monthly repeats, which overflows into the next month when the start day is 29-31 (Jan 31 -> Mar 3). Clamp to the last day of the target month. Also planned-slots.js:115 should 400 when the series end is before the start. Done when the three it.fails tests in server/tests/reminders-alerts-slots.test.js pass as normal tests.
- result: 2026-10-08 · feature/backlog-fixes · קיטום לסוף חודש עם שמירת היום המקורי (recurrence_day), ו-400 לסדרה שמסתיימת לפני תחילתה

## Small API validation gaps found by the test suite
- status: done
- added: 2026-10-08
- priority: 3
- complexity: low
- tokens: 100000
- details: Fix the remaining it.fails cases: credentials PUT wipes omitted fields (server/routes/credentials.js:190), quick status change away from paid keeps paid_date (server/routes/payments.js:494), expenses PUT accepts amount <= 0 (server/routes/expenses.js:265), catalog price 0 stored as NULL (server/routes/catalog.js:76,112). Done when those it.fails tests in server/tests pass as normal tests and npm --prefix server test is green.
- result: 2026-10-08 · feature/backlog-fixes · credentials/payments/expenses/catalog: שדות שלא נשלחו נשמרים, paid_date מתנקה, סכום לא חיובי נדחה, מחיר 0 נשמר

## Restrict who can manage global client sources and addon keys
- status: done
- added: 2026-10-08
- priority: 2
- complexity: medium
- tokens: 200000
- details: server/routes/client_sources.js:99,120 lets any user create a global source (visible to all workspaces) or claim a global one for their workspace; server/routes/addons.js lets any workspace member, any role, change addon API keys. Limit global sources to system admins and addon secrets to workspace owner/admin. Done when new tests in server/tests/catalog-sources-addons.test.js cover both rules and the suite is green.
- result: 2026-10-08 · feature/backlog-fixes · מקורות גלובליים רק לאדמין מערכת; תוספים ומפתחות API רק לבעלים/מנהל

## Agree on day boundaries between StatsBar and the stats API
- status: done
- added: 2026-10-08
- priority: 3
- complexity: medium
- tokens: 200000
- details: client/src/components/StatsBar.jsx sends date ranges as UTC midnight while server/routes/stats.js:91-94 rounds to UTC days, so in Israel the dashboard range is shifted by 2-3 hours. Pick one rule (local day boundaries sent as ISO with offset is the natural one), apply it on both sides, and add tests on both sides. Done when a range for 'today' in Asia/Jerusalem counts an entry at 01:00 local time.
- result: 2026-10-08 · feature/backlog-fixes · טווחים וחודשים נשלחים כרגעים מקומיים והשרת משתמש בהם כמו שהם

## Split the client bundle per route
- status: done
- added: 2026-10-08
- priority: 3
- complexity: medium
- tokens: 200000
- details: client is a single 1MB JS chunk. Convert the page imports in client/src/App.jsx to React.lazy with Suspense around the Layout Outlet. Caution: page CSS files define classes used by other pages, so keep CSS in one file (vite build.cssCodeSplit: false) and keep the import order, then compare screenshots of every route before/after. Done when the main chunk is under 500kB and npm run test:e2e passes.
- result: 2026-10-08 · feature/backlog-fixes · React.lazy לכל העמודים, CSS אחד באותו סדר; החבילה הראשית ירדה מ-1,026kB ל-412kB
