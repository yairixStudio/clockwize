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
# התקנת כל התלויות (root + client + server)
npm run install:all

# הפעלת פיתוח (שרת + קליינט)
npm run dev
```

בריצה הראשונה השרת יוצר אוטומטית את `server/clockwize.db` עם כל הסכמה ומשתמש אדמין ברירת-מחדל.

## כתובות

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001

## הגדרות אבטחה (חובה לפני production)

- **JWT_SECRET** — הגדרו משתנה סביבה משלכם. אחרת השרת ישתמש בערך ברירת-מחדל הכתוב בקוד.
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
│   ├── database.js         # SQLite setup
│   └── index.js            # Express server
└── package.json            # Root package.json
```

## רישיון

MIT

