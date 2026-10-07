# Clockwize widget (WidgetKit, macOS)

ווידג׳ט מקורי ל-macOS לטיימר של Clockwize, בעברית ומימין לשמאל:

- **ווידג׳ט קטן**: סטטוס (פועל/מושהה), פרויקט ומשימה, הזמן שחלף (מתקדם לבד, בלי רענון בכל שנייה) וסך הזמן של היום.
- **ווידג׳ט בינוני**: כל זה, ובנוסף סך הזמן של השבוע, כפתורי השהיה/המשך ועצירה, ועד 2 פרויקטים אחרונים עם כפתור הפעלה.
- **פקדים לשורת התפריטים ולמרכז הבקרה** (macOS 26 ומעלה): מתג "טיימר Clockwize" שמשהה וממשיך את הטיימר הראשי (ואם אין טיימר, מפעיל את הפריט הראשון ב-`recent`), וכפתור "עצור ושמור".
- **`clockwize-widget-reload`**: כלי שורת פקודה שמבקש מ-WidgetKit לרענן את הווידג׳טים והפקדים ואז יוצא.

הווידג׳ט לא משתמש ב-App Group. את המצב הוא מקבל מ-feed מקומי ב-HTTP שאפליקציית Electron מגישה ב-`127.0.0.1` (ראו "החוזה" בהמשך). הכפתורים מריצים App Intents בתוך ה-extension ושולחים פעולות לאותו feed. ה-extension אף פעם לא מקבל את הטוקן של המשתמש.

## בנייה

```sh
CLOCKWIZE_WIDGET_SECRET=<secret> CLOCKWIZE_WIDGET_PORT=47321 desktop/widget/build.sh <outDir>
```

- הפלט: `<outDir>/ClockwizeWidget.appex` ו-`<outDir>/clockwize-widget-reload`. שניהם חתומים עם hardened runtime ו-secure timestamp, וכל אחד מהם בינארי אוניברסלי (arm64 + x86_64).
- הפורט והסוד נכנסים ל-Info.plist של ה-extension: `ClockwizeFeedURL` = `http://127.0.0.1:<port>` ו-`ClockwizeFeedSecret` = `<secret>`. ברירת המחדל לפורט היא 47321. הסוד יכול להכיל רק אותיות, ספרות ו-`. _ ~ + / = -`.
- אם `CLOCKWIZE_WIDGET_SECRET` ריק, נוצר סוד אקראי (32 בתים ב-hex) ומודפסת שורה `WIDGET_SECRET=<hex>` ממש לפני השורה האחרונה. את אותו הסוד צריך לתת לאפליקציה.
- השורה האחרונה בפלט היא `TEAM_ID=<id>`.
- אם Xcode, ‏xcodegen או זהות חתימה חסרים (למשל ב-CI), הסקריפט מדפיס `skipped: ...` ויוצא עם 0.
- זהות החתימה: ה-"Developer ID Application" הראשונה ב-Keychain. אם אין כזו, נלקחת "Apple Development". ה-team id נגזר מהזהות.
- הבנייה כולה רצה תחת `$TMPDIR/clockwize-widget-build`, ושום דבר לא נכתב לתוך הריפו.
- אם `codesign` נתקע מעל 300 שניות, כנראה ש-macOS מחכה לאישור Keychain ("Allow"). צריך לאשר ולהריץ שוב.

משתני סביבה אופציונליים:

| משתנה | ברירת מחדל |
| --- | --- |
| `CLOCKWIZE_WIDGET_PORT` | `47321` |
| `CLOCKWIZE_WIDGET_SECRET` | סוד אקראי שנוצר בבנייה ומודפס |
| `CLOCKWIZE_SIGN_IDENTITY` | זיהוי אוטומטי (שם או SHA-1) |
| `CLOCKWIZE_TEAM_ID` | נגזר מהזהות |
| `CLOCKWIZE_HOST_BUNDLE_ID` | `com.yairix.clockwize` |
| `CLOCKWIZE_WIDGET_BUNDLE_ID` | `<host>.widget` |
| `CLOCKWIZE_VERSION` / `CLOCKWIZE_BUILD_NUMBER` | הגרסה מ-`desktop/package.json` |
| `CLOCKWIZE_ARCHS` | `arm64 x86_64` |
| `CLOCKWIZE_SIGN_TIMESTAMP=none` | חתימה בלי timestamp (לבנייה בלי רשת) |

## שילוב באפליקציה

1. מעתיקים את `ClockwizeWidget.appex` אל `Clockwize.app/Contents/PlugIns/` ואת `clockwize-widget-reload` אל `Clockwize.app/Contents/MacOS/`.
2. האפליקציה מגישה את ה-feed על `127.0.0.1:<port>` עם אותו סוד שנבנה לתוך ה-extension. לא צריך App Group ולא provisioning profile.
3. סדר החתימה הוא מבפנים החוצה. אסור לחתום מחדש את ה-appex עם ה-entitlements של Electron, כי בלי sandbox ‏pkd דוחה אותו ("plug-ins must be sandboxed"). אפשר להחריג אותו ואת ה-helper מהחתימה של electron-builder, או להוסיף את שניהם אחרי החתימה ואז לחתום מחדש רק את `Clockwize.app` החיצוני, בלי `--deep`.
4. בכל שינוי של מצב הטיימר מריצים את `Contents/MacOS/clockwize-widget-reload`. ה-helper מציג ל-WidgetKit את ה-bundle id של האפליקציה (`CLOCKWIZE_HOST_BUNDLE_ID`), כי WidgetKit מרענן רק ווידג׳טים של האפליקציה שקראה לו.
5. אסור להשאיר עותק לא חתום של ה-appex במקום ש-LaunchServices מכיר. עותק כזה גורם ל-pkd לדחות את ה-extension ולהסתיר גם את העותק החתום.

## החוזה: feed מקומי ב-HTTP

כל בקשה נשלחת עם הכותרת `Authorization: Bearer <ClockwizeFeedSecret>`.

**מצב:** `GET http://127.0.0.1:<port>/widget-state` מחזיר 200 עם ה-JSON הבא:

```json
{
  "version": 1,
  "updatedAt": "2026-10-08T01:00:00.000Z",
  "api": null,
  "timer": { "id": "<id>", "projectName": "אתר תדמית", "taskName": "עיצוב דף בית", "clientName": "סטודיו אורנים",
             "isRunning": true, "elapsedSeconds": 1234, "runningSince": "2026-10-08T00:39:26.000Z" },
  "otherTimers": 0,
  "today": { "loggedSeconds": 12600 },
  "week": { "loggedSeconds": 77400 },
  "recent": [ { "projectId": "<id>", "taskId": "<id or null>", "projectName": "…", "taskName": "… or null", "clientName": "… or null" } ]
}
```

**פעולות:** `POST http://127.0.0.1:<port>/widget-action` עם `Content-Type: application/json`, וגוף אחד מאלה:

```json
{"action":"pause","timerId":"…"}
{"action":"resume","timerId":"…"}
{"action":"stop","timerId":"…"}
{"action":"start","projectId":"…","taskId":"…"}
{"action":"toggle"}
```

- ב-`start`, הערך של `taskId` יכול להיות `null`.
- `toggle` משמש את מתג מרכז הבקרה: האפליקציה משהה או ממשיכה את הטיימר הראשי, ואם אין טיימר היא מפעילה את הפריט הראשון ב-`recent`.
- תשובה 200 מחזירה את המצב החדש, באותה סכמה. הווידג׳ט שומר אותו ומרענן מיד את הווידג׳טים והפקדים.
- תשובה שאינה 200 היא `{ "error": "…" }`. הווידג׳ט רושם אותה ללוג (subsystem `com.yairix.clockwize.widget`) וממשיך כרגיל.

**כללים:**
- `api` תמיד `null`. ה-extension מתעלם ממנו.
- שדה אופציונלי: `"signedIn": false` מציג "התחברו ל-Clockwize". אם השדה חסר, הווידג׳ט מניח שהמשתמש מחובר.
- כשאין טיימר פעיל, `timer` הוא `null`.
- `runningSince` מופיע רק כשהטיימר רץ, וערכו `updatedAt − elapsedSeconds`.
- `today` ו-`week` לא כוללים את הטיימר הפעיל, בין שהוא רץ ובין שהוא מושהה. הווידג׳ט מוסיף אותו בעצמו: בזמן ריצה הסכום מתקדם, ובהשהיה הוא קפוא. הזמן של `otherTimers` לא נכנס לסכומים.
- `isRunning` מתקבל גם כ-`true`/`false` וגם כ-`0`/`1`. תאריכים בפורמט ISO-8601, עם מילישניות או בלעדיהן.
- כשאין חיבור (connection refused, timeout של 3 שניות) או שהתשובה אינה 200, הווידג׳ט מניח שהאפליקציה לא רצה:
  - הוא מציג את המצב האחרון שנשמר ב-`UserDefaults` שלו, עם ההערה "Clockwize לא פועל", ומסתיר את כפתורי הפעולה.
  - טיימר שרץ ממשיך להתקדם לפי `runningSince`.
  - אם לא נשמר מצב אף פעם, הוא מציג "פתחו את Clockwize".
- הווידג׳ט מבקש מצב חדש כל 5 דקות. כדי שיתעדכן מיד, האפליקציה מריצה את `clockwize-widget-reload` בכל שינוי וגם כשה-feed עולה.

## קבצים

- `project.yml`: קובץ XcodeGen עם שני targets, ה-extension וה-helper. `build.sh` מייצר ממנו את הפרויקט תחת `$TMPDIR`.
- `Info.plist`: ה-Info.plist של ה-extension. `ClockwizeFeedURL` ו-`ClockwizeFeedSecret` נקבעים בזמן הבנייה.
- `ClockwizeWidget.entitlements.template`: ה-entitlements של ה-extension, `app-sandbox` ו-`network.client`, בלי App Group.
- `Reload-Info.plist`: Info.plist שמוטמע בתוך הבינארי של ה-helper.
- `Sources/Widget`: הווידג׳טים, הפקדים, ה-App Intents ולקוח ה-feed (`WidgetFeed.swift`).
- `Sources/Reload`: ה-helper.
