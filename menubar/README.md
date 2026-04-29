# Clockwize Menu Bar App

אפליקציית Menu Bar עבור Clockwize - מציגה את סטטוס הטיימר בשורת התפריטים של macOS.

## 🎯 תכונות

- ⏱️ הצגת זמן הטיימר הפעיל בשורת התפריטים
- 🟢 אינדיקטור סטטוס (פועל/מושהה/לא פעיל)
- ▶️/⏸️ התחלה/השהיה של הטיימר
- ⏹️ עצירה ושמירת הטיימר
- 📱 פתיחה מהירה של האפליקציה הראשית

## 📦 התקנה

### דרישות מקדימות

נדרש אחד מהבאים:

**אפשרות א': Xcode (מומלץ)**
1. התקן Xcode מה-[App Store](https://apps.apple.com/app/xcode/id497799835)
2. פתח Terminal והרץ: `sudo xcode-select -s /Applications/Xcode.app`

**אפשרות ב': עדכון Command Line Tools**
```bash
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install
```

### בנייה

לאחר התקנת Xcode או עדכון CLT:

```bash
cd menubar
./build.sh
```

האפליקציה תיבנה ותועתק ל: `ClockwizeMenuBar.app`

### פתיחה ישירה ב-Xcode

אם יש לך Xcode:
1. פתח את הקובץ `ClockwizeMenuBar.xcodeproj`
2. לחץ Cmd+B לבנייה
3. לחץ Cmd+R להרצה

## 🚀 הפעלה

```bash
open ../ClockwizeMenuBar.app
```

או לחץ פעמיים על `ClockwizeMenuBar.app` ב-Finder.

## ⚙️ שימוש

1. **התחברות ראשונית**: בפעם הראשונה תתבקש להתחבר עם האימייל והסיסמא של Clockwize
2. **תפריט**: לחץ על האייקון בשורת התפריטים לפתיחת התפריט
3. **שליטה בטיימר**: השתמש בכפתורים בתפריט להשהיה/המשך/עצירה

## 📁 מבנה הקבצים

```
menubar/
├── ClockwizeMenuBar/
│   ├── AppDelegate.swift      # נקודת כניסה
│   ├── StatusBarController.swift  # ניהול התפריט
│   ├── TimerAPI.swift         # API client
│   ├── Models.swift           # מודלים
│   ├── AuthManager.swift      # ניהול התחברות
│   ├── LoginViewController.swift  # חלון התחברות
│   └── Info.plist             # הגדרות
├── ClockwizeMenuBar.xcodeproj/
├── build.sh
└── README.md
```

## 🔧 פתרון בעיות

### "SDK is not supported by the compiler"
עדכן את Command Line Tools:
```bash
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install
```

### "xcodebuild requires Xcode"
התקן Xcode מה-App Store והרץ:
```bash
sudo xcode-select -s /Applications/Xcode.app
```

### האפליקציה לא מתחברת ל-API
ודא שהשרת של Clockwize רץ על `localhost:3001`
