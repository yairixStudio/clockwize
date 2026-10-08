# Clockwize ⏰

מערכת ניהול זמן וחיוב לפרילנסרים - ניהול לקוחות, פרויקטים, משימות ומעקב שעות עבודה.

## תכונות עיקריות

- 👤 **הרשמה והתחברות** - מערכת משתמשים מאובטחת
- 👥 **ניהול לקוחות** - שם, כתובת, טלפון, פרטי בנק, ח.פ
- 📁 **ניהול פרויקטים** - מחיר קבוע או לפי שעה
- ✅ **ניהול משימות** - בתוך כל פרויקט עם סטטוסים
- ⏱️ **טיימר עבודה** - מעקב זמנים עם אינטרוולים
- 💰 **תמחור מדורג** - מחשבון → לקוח → פרויקט → משימה
- 🔗 **שיתוף ללקוח** - לינק לצפייה בסטטוס הפרויקטים
- 📊 **סטטיסטיקות** - בכל מסך מוצגים נתונים רלוונטיים

## טכנולוגיות

### Backend
- Node.js + Express
- SQLite (better-sqlite3)
- JWT Authentication
- bcryptjs

### Frontend
- React 18 + Vite
- React Router v6
- Zustand (State Management)
- CSS מותאם אישית (RTL)

## התקנה

```bash
# התקנת כל התלויות (root + client + server + desktop)
npm run install:all

# יצירת קובץ הסביבה של השרת (חובה - השרת לא יעלה בלעדיו)
cp server/.env.example server/.env
printf 'JWT_SECRET=%s\nENCRYPTION_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > server/.env

# הפעלת פיתוח (שרת + קליינט)
npm run dev
```

בריצה הראשונה השרת יוצר אוטומטית את `server/clockwize.db` עם כל הסכמה ומשתמש אדמין ברירת-מחדל.

## כתובות

- **Frontend (פיתוח):** http://localhost:5001 (Vite; פורט 5000 תפוס ב-macOS)
- **Backend API:** http://localhost:3000 (אם תפוס - הפורט הפנוי הבא, נשמר ב-`.server-port`)

## אפליקציית Desktop ל-macOS

אפליקציה אמיתית עם חלון, אייקון ב-Dock, טיימר בשורת התפריט, ווידג'ט למרכז העדכונים ו-Control ל-Control Center / שורת התפריט.

```bash
npm run desktop:install   # בונה ומתקין את /Applications/Clockwize.app (מגבה את ה-DB לפני כן)
npm run desktop           # הרצת פיתוח, בפרופיל נפרד ("Clockwize Dev") ליד האפליקציה המותקנת
```

- **השרת רץ בתוך האפליקציה** (Electron utilityProcess, ה-Node המובנה - אין צורך ב-Node במערכת), מתוך תיקיית הפרויקט, עם אותו `server/clockwize.db`, `server/.env` ו-`uploads/`. החלון טוען את ה-client הבנוי (`client/dist`) מאותו שרת - אחרי שינוי ב-client מספיק `npm run build`.
- **שרת אחד לכל DB**: קובץ נעילה (`clockwize.db.lock`) מונע משני שרתים לדרוס זה את זה. אם `npm run dev` כבר רץ, האפליקציה מתחברת אליו; ו-`npm run dev` שמופעל כשהאפליקציה פתוחה מודיע על כך, וה-client של הפיתוח עובד מול השרת של האפליקציה.
- **סגירת החלון לא מכבה** את האפליקציה (הטיימר ממשיך); לחיצה על האייקון ב-Dock מחזירה אותו, ו-⌘Q יוצא ועוצר את השרת.
- **שורת התפריט**: לחיצה על השעון פותחת חלונית עם הטיימר החי, השהה/המשך/עצור, סיכום היום והשבוע והפעלה מהירה של עבודה אחרונה. קליק ימני - תפריט קצר.
- **ווידג'ט ו-Control** (`desktop/widget`, WidgetKit): נבנים ונחתמים אוטומטית ב-`desktop:install` כשיש Xcode ותעודת חתימה במחזיק המפתחות; אחרת האפליקציה מותקנת בלעדיהם. הווידג'ט קורא את המצב מהאפליקציה דרך ערוץ מקומי (127.0.0.1) עם סוד שנוצר בכל התקנה, ולא מקבל את טוקן המשתמש.
- **Passkey**: Electron לא יכול להציג את חלונית ה-Passkey של macOS, ולכן הכפתור באפליקציה פותח את ההתחברות בדפדפן; אחרי האישור שם האפליקציה מתחברת לבד.
- **נשארים מחוברים**: ההתחברות מתחדשת לבד (מתנתקים רק אחרי שנה בלי שימוש, או כשהסיסמה משתנה). אם השרת לא זמין לרגע, האפליקציה מנסה שוב במקום לנתק.
- **נעילת Touch ID**: בפתיחת האפליקציה היא מבקשת טביעת אצבע (תפריט Clockwize ← "נעילה עם Touch ID בפתיחה" כדי לכבות).
- **לוג השרת**: `~/Library/Logs/Clockwize/server.log` (גם מהתפריט Clockwize ← "פתח את קובץ הלוג של השרת").

## בדיקות ו-CI

```bash
npm --prefix server test     # vitest + supertest על DB בזיכרון (כולל בידוד בין workspaces)
npm --prefix client test     # vitest + Testing Library (utils, store, api, קומפוננטות)
npm run build && npm run test:e2e   # Playwright מול שרת זמני (דסקטופ + מובייל)
npm run test:desktop         # Playwright מול אפליקציית ה-Electron עצמה
npm test                     # שרת + client + e2e
```

הבדיקות לעולם לא נוגעות בנתונים האמיתיים: כל הנתיבים ניתנים להחלפה במשתני סביבה (`CLOCKWIZE_DB_PATH`, `CLOCKWIZE_UPLOADS_DIR`, `CLOCKWIZE_BACKUP_DIR`, `CLOCKWIZE_PORT_FILE`, `CLOCKWIZE_SESSION_FILE`, `CLOCKWIZE_CLIENT_DIST` - ראו `server/paths.js`). לנתוני דמו לעבודת UI: `node server/scripts/seed-demo.js <url>` מול שרת על DB זמני.

ה-CI (`.github/workflows/ci.yml`) מריץ בכל push: בדיקות שרת, בדיקות client ו-build, e2e ב-Playwright, ובדיקות אפליקציית ה-Desktop על macOS.

## הגדרות אבטחה (חובה לפני production)

- **JWT_SECRET** — חובה ב-`server/.env`, לפחות 32 תווים (`openssl rand -hex 32`). ללא הערך הזה השרת לא עולה. החלפתו מנתקת את כל המשתמשים.
- **ENCRYPTION_SECRET** — חובה ב-`server/.env`, לפחות 32 תווים (`openssl rand -hex 32`). ממנו נגזרים מפתחות ההצפנה של הסיסמאות ומפתחות ה-API של התוספים. בעלייה הראשונה עם ערך חדש השרת מצפין מחדש אוטומטית רשומות שהוצפנו עם המפתח המובנה הישן — מומלץ לגבות את `server/clockwize.db` לפני כן.
- **משתמש אדמין** — בריצה ראשונה נוצר משתמש `admin` עם סיסמה `admin`. **שנו אותה מיד** או מחקו את משתמש האדמין דרך הקוד והרשמו משתמש משלכם.
- **uploads/** — תיקייה זו לא נכללת ב-git. ודאו backup חיצוני בפרודקשן.

## API Routes

### Auth
- `POST /api/auth/register` - הרשמה
- `POST /api/auth/login` - התחברות
- `GET /api/auth/me` - קבלת פרטי משתמש
- `PUT /api/auth/profile` - עדכון פרופיל
- `DELETE /api/auth/account` - מחיקת חשבון

### Clients
- `GET /api/clients` - רשימת לקוחות
- `GET /api/clients/:id` - פרטי לקוח
- `POST /api/clients` - יצירת לקוח
- `PUT /api/clients/:id` - עדכון לקוח
- `DELETE /api/clients/:id` - מחיקת לקוח
- `POST /api/clients/:id/share` - יצירת לינק שיתוף
- `DELETE /api/clients/:id/share` - הסרת לינק שיתוף
- `GET /api/clients/shared/:token` - צפייה בלקוח משותף (ציבורי)

### Projects
- `GET /api/projects` - רשימת פרויקטים
- `GET /api/projects/:id` - פרטי פרויקט
- `POST /api/projects` - יצירת פרויקט
- `PUT /api/projects/:id` - עדכון פרויקט
- `DELETE /api/projects/:id` - מחיקת פרויקט

### Tasks
- `GET /api/tasks` - רשימת משימות
- `GET /api/tasks/:id` - פרטי משימה
- `POST /api/tasks` - יצירת משימה
- `PUT /api/tasks/:id` - עדכון משימה
- `DELETE /api/tasks/:id` - מחיקת משימה

### Timer
- `GET /api/timer/active` - טיימר פעיל
- `POST /api/timer/start` - התחלת טיימר
- `POST /api/timer/pause` - השהיית טיימר
- `POST /api/timer/resume` - המשך טיימר
- `POST /api/timer/stop` - עצירה ושמירה
- `DELETE /api/timer/discard` - ביטול טיימר
- `GET /api/timer/entries` - רשומות זמן

### Stats
- `GET /api/stats/dashboard` - סטטיסטיקות דשבורד
- `GET /api/stats/client/:id` - סטטיסטיקות לקוח
- `GET /api/stats/project/:id` - סטטיסטיקות פרויקט

## עקרונות פיתוח

### 🔄 עדכון זמן אמת (Real-Time Updates)
**עקרון מרכזי במערכת:** כל שינוי בנתונים חייב להשתקף מיידית בממשק המשתמש ללא צורך ברענון ידני של הדפדפן.

#### יישום:
- **אחרי כל פעולת CRUD** (יצירה, עריכה, מחיקה) - קריאה מיידית לפונקציית `load*()` לרענון הנתונים
- **סדר ביצוע:** 
  1. ביצוע הפעולה (API call)
  2. רענון הנתונים (`await loadData()`)
  3. הצגת הודעה למשתמש (אם קיימת)

#### דוגמאות מהקוד:
```javascript
// ✅ נכון - רענון מיידי לפני הודעה
const handleDelete = async (id) => {
  await api.delete(id);
  await loadData();        // Refresh immediately
  alert('נמחק בהצלחה');
};

// ❌ שגוי - הודעה לפני רענון
const handleDelete = async (id) => {
  await api.delete(id);
  alert('נמחק בהצלחה');  // Blocks UI refresh
  loadData();
};
```

#### איפה מיושם:
- ✅ **Clients** - יצירה, עריכה, מחיקה, שינוי מועדף
- ✅ **Projects** - יצירה, עריכה, מחיקה
- ✅ **Tasks** - יצירה, עריכה, מחיקה, שינוי סטטוס
- ✅ **Time Entries** - יצירה, עריכה, מחיקה
- ✅ **Payments** - יצירה, עריכה, מחיקה
- ✅ **Admin Panel** - כל פעולות ניהול משתמשים

## מבנה תיקיות

```
clockwize/
├── client/                 # React Frontend
│   ├── src/
│   │   ├── components/     # קומפוננטות משותפות
│   │   ├── pages/          # דפים ראשיים
│   │   ├── services/       # API calls
│   │   ├── store/          # Zustand store
│   │   ├── styles/         # Global CSS
│   │   └── utils/          # פונקציות עזר
│   └── public/
├── server/                 # Node.js Backend
│   ├── routes/             # API routes
│   ├── middleware/         # Auth middleware
│   ├── tests/              # vitest + supertest
│   ├── app.js              # Express app (createApp)
│   ├── database.js         # SQLite setup (sql.js, כתיבה אטומית)
│   ├── paths.js            # כל נתיבי הנתונים (ניתנים להחלפה ב-env)
│   └── index.js            # הפעלה: נעילת DB + האזנה לפורט
├── desktop/                # אפליקציית macOS (Electron)
│   ├── lib/                # שרת, טיימר, שורת תפריט, ערוץ לווידג'ט
│   ├── widget/             # WidgetKit: ווידג'ט + Control
│   └── tests/              # Playwright מול האפליקציה
├── e2e/                    # Playwright מול הדפדפן
└── package.json            # Root package.json
```

## רישיון

MIT

