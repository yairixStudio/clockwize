import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const router = express.Router();

// Settings that should be encrypted (sensitive data)
const SENSITIVE_SETTINGS = ['openai_api_key', 'api_key', 'api_secret', 'password', 'token'];

// Helper to get db
const getDb = (req) => req.app.locals.db;

// הגדרת התוספים הזמינים במערכת
// כל תוסף חדש צריך להתווסף כאן
export const AVAILABLE_ADDONS = [
  {
    id: 'credentials',
    name: 'סיסמאות',
    description: 'ניהול סיסמאות ופרטי גישה ללקוחות ופרויקטים',
    icon: 'Key',
    defaultEnabled: true
  },
  {
    id: 'files',
    name: 'קבצים',
    description: 'העלאת וניהול קבצים ללקוחות ופרויקטים',
    icon: 'FileText',
    defaultEnabled: true
  },
  {
    id: 'notes',
    name: 'פתקים',
    description: 'פתקים ותיעוד ללקוחות ופרויקטים',
    icon: 'StickyNote',
    defaultEnabled: true
  },
  {
    id: 'leads_management',
    name: 'ניהול לידים',
    description: 'ניהול לידים, מעקב מסע לקוח, המרת לידים ללקוחות וצפיית pipeline',
    icon: 'Target',
    defaultEnabled: false,
    hasSettings: true
  },
  {
    id: 'reminders',
    name: 'תזכורות',
    description: 'ניהול תזכורות ומעקב אחר משימות ופגישות',
    icon: 'Bell',
    defaultEnabled: true
  },
  {
    id: 'schedule',
    name: 'לו״ז',
    description: 'לוח שנה המציג את העבודה שבוצעה לפי לקוחות',
    icon: 'Calendar',
    defaultEnabled: true
  },
  {
    id: 'catalog',
    name: 'קטלוג',
    description: 'ניהול קטלוג מוצרים ושירותים לתמחור פרויקטים',
    icon: 'Package',
    defaultEnabled: false
  },
  {
    id: 'ai_assistant',
    name: 'עוזר AI',
    description: 'יצירת לקוחות, פרויקטים ומשימות באמצעות שיחה עם AI',
    icon: 'Sparkles',
    defaultEnabled: false,
    hasSettings: true
  }
];

// קבלת רשימת התוספים הזמינים ומצבם עבור המשתמש
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // קבלת ההגדרות הנוכחיות של ה-workspace
    const workspaceAddons = db.prepare(`
      SELECT addon_id, is_enabled 
      FROM user_addons 
      WHERE workspace_id = ?
    `).all(req.workspaceId);
    
    // יצירת מפה של התוספים המופעלים
    const addonsMap = {};
    workspaceAddons.forEach(addon => {
      addonsMap[addon.addon_id] = addon.is_enabled === 1;
    });
    
    // החזרת כל התוספים עם מצבם
    const addonsWithStatus = AVAILABLE_ADDONS.map(addon => ({
      ...addon,
      isEnabled: addonsMap.hasOwnProperty(addon.id) 
        ? addonsMap[addon.id] 
        : addon.defaultEnabled
    }));
    
    res.json(addonsWithStatus);
  } catch (error) {
    console.error('Error fetching addons:', error);
    res.status(500).json({ error: 'שגיאה בטעינת התוספים' });
  }
});

// קבלת רשימת התוספים המופעלים בלבד
router.get('/enabled', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    
    // קבלת ההגדרות הנוכחיות של ה-workspace
    const workspaceAddons = db.prepare(`
      SELECT addon_id, is_enabled 
      FROM user_addons 
      WHERE workspace_id = ?
    `).all(req.workspaceId);
    
    // יצירת מפה של התוספים המופעלים
    const addonsMap = {};
    workspaceAddons.forEach(addon => {
      addonsMap[addon.addon_id] = addon.is_enabled === 1;
    });
    
    // החזרת רק הID של התוספים המופעלים
    const enabledAddons = AVAILABLE_ADDONS
      .filter(addon => {
        return addonsMap.hasOwnProperty(addon.id) 
          ? addonsMap[addon.id] 
          : addon.defaultEnabled;
      })
      .map(addon => addon.id);
    
    res.json(enabledAddons);
  } catch (error) {
    console.error('Error fetching enabled addons:', error);
    res.status(500).json({ error: 'שגיאה בטעינת התוספים' });
  }
});

// עדכון מצב תוסף (הפעלה/כיבוי)
router.put('/:addonId', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { addonId } = req.params;
    const { isEnabled } = req.body;
    
    // בדיקה שהתוסף קיים
    const addonExists = AVAILABLE_ADDONS.find(a => a.id === addonId);
    if (!addonExists) {
      return res.status(404).json({ error: 'תוסף לא נמצא' });
    }
    
    // בדיקה אם יש כבר רשומה ל-workspace
    const existingAddon = db.prepare(`
      SELECT id FROM user_addons 
      WHERE workspace_id = ? AND addon_id = ?
    `).get(req.workspaceId, addonId);
    
    if (existingAddon) {
      // עדכון
      db.prepare(`
        UPDATE user_addons 
        SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND addon_id = ?
      `).run(isEnabled ? 1 : 0, req.workspaceId, addonId);
    } else {
      // יצירה
      db.prepare(`
        INSERT INTO user_addons (id, user_id, workspace_id, addon_id, is_enabled)
        VALUES (?, ?, ?, ?, ?)
      `).run(uuidv4(), req.userId, req.workspaceId, addonId, isEnabled ? 1 : 0);
    }
    
    res.json({ success: true, addonId, isEnabled });
  } catch (error) {
    console.error('Error updating addon:', error);
    res.status(500).json({ error: 'שגיאה בעדכון התוסף' });
  }
});

// עדכון מרובה של תוספים
router.put('/', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { addons } = req.body; // מערך של { id, isEnabled }
    
    for (const addon of addons) {
      // בדיקה שהתוסף קיים
      const addonExists = AVAILABLE_ADDONS.find(a => a.id === addon.id);
      if (!addonExists) continue;
      
      // בדיקה אם יש כבר רשומה ל-workspace
      const existingAddon = db.prepare(`
        SELECT id FROM user_addons 
        WHERE workspace_id = ? AND addon_id = ?
      `).get(req.workspaceId, addon.id);
      
      if (existingAddon) {
        db.prepare(`
          UPDATE user_addons 
          SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP
          WHERE workspace_id = ? AND addon_id = ?
        `).run(addon.isEnabled ? 1 : 0, req.workspaceId, addon.id);
      } else {
        db.prepare(`
          INSERT INTO user_addons (id, user_id, workspace_id, addon_id, is_enabled)
          VALUES (?, ?, ?, ?, ?)
        `).run(uuidv4(), req.userId, req.workspaceId, addon.id, addon.isEnabled ? 1 : 0);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating addons:', error);
    res.status(500).json({ error: 'שגיאה בעדכון התוספים' });
  }
});

// ===== ADDON SETTINGS ENDPOINTS =====

// Helper function to mask sensitive values for display
function maskSensitiveValue(value) {
  if (!value || value.length < 8) return '****';
  return value.substring(0, 4) + '****' + value.substring(value.length - 4);
}

// קבלת הגדרות תוסף
router.get('/:addonId/settings', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { addonId } = req.params;
    
    // בדיקה שהתוסף קיים ויש לו הגדרות
    const addonExists = AVAILABLE_ADDONS.find(a => a.id === addonId);
    if (!addonExists) {
      return res.status(404).json({ error: 'תוסף לא נמצא' });
    }
    
    if (!addonExists.hasSettings) {
      return res.status(400).json({ error: 'לתוסף זה אין הגדרות' });
    }
    
    // קבלת כל ההגדרות של התוסף
    const settings = db.prepare(`
      SELECT setting_key, setting_value 
      FROM addon_settings 
      WHERE workspace_id = ? AND addon_id = ?
    `).all(req.workspaceId, addonId);
    
    // המרה לאובייקט עם פענוח ומיסוך של ערכים רגישים
    const result = {};
    for (const setting of settings) {
      const isSensitive = SENSITIVE_SETTINGS.some(s => setting.setting_key.includes(s));
      
      if (isSensitive && setting.setting_value) {
        // פענוח הערך המוצפן
        const decrypted = decrypt(setting.setting_value, req.userId);
        // מיסוך לתצוגה
        result[setting.setting_key] = maskSensitiveValue(decrypted);
        // שליחת דגל שיש ערך מוגדר
        result[`${setting.setting_key}_configured`] = !!decrypted;
      } else {
        result[setting.setting_key] = setting.setting_value;
      }
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching addon settings:', error);
    res.status(500).json({ error: 'שגיאה בטעינת הגדרות התוסף' });
  }
});

// עדכון הגדרות תוסף
router.put('/:addonId/settings', authMiddleware, workspaceMiddleware, (req, res) => {
  try {
    const db = getDb(req);
    const { addonId } = req.params;
    const settings = req.body; // אובייקט של { key: value, ... }
    
    // בדיקה שהתוסף קיים ויש לו הגדרות
    const addonExists = AVAILABLE_ADDONS.find(a => a.id === addonId);
    if (!addonExists) {
      return res.status(404).json({ error: 'תוסף לא נמצא' });
    }
    
    if (!addonExists.hasSettings) {
      return res.status(400).json({ error: 'לתוסף זה אין הגדרות' });
    }
    
    // עדכון/יצירה של כל הגדרה
    for (const [key, value] of Object.entries(settings)) {
      // דילוג על שדות מיוחדים
      if (key.endsWith('_configured')) continue;
      
      // הצפנה של ערכים רגישים
      const isSensitive = SENSITIVE_SETTINGS.some(s => key.includes(s));
      const storedValue = isSensitive && value ? encrypt(value, req.userId) : value;
      
      // בדיקה אם יש כבר רשומה
      const existing = db.prepare(`
        SELECT id FROM addon_settings 
        WHERE workspace_id = ? AND addon_id = ? AND setting_key = ?
      `).get(req.workspaceId, addonId, key);
      
      if (existing) {
        db.prepare(`
          UPDATE addon_settings 
          SET setting_value = ?, updated_at = CURRENT_TIMESTAMP
          WHERE workspace_id = ? AND addon_id = ? AND setting_key = ?
        `).run(storedValue, req.workspaceId, addonId, key);
      } else {
        db.prepare(`
          INSERT INTO addon_settings (id, workspace_id, addon_id, setting_key, setting_value)
          VALUES (?, ?, ?, ?, ?)
        `).run(uuidv4(), req.workspaceId, addonId, key, storedValue);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating addon settings:', error);
    res.status(500).json({ error: 'שגיאה בעדכון הגדרות התוסף' });
  }
});

// פונקציית עזר לקבלת הגדרה מפוענחת (לשימוש פנימי ע"י routes אחרים)
export async function getAddonSetting(db, workspaceId, userId, addonId, settingKey) {
  try {
    const setting = db.prepare(`
      SELECT setting_value 
      FROM addon_settings 
      WHERE workspace_id = ? AND addon_id = ? AND setting_key = ?
    `).get(workspaceId, addonId, settingKey);
    
    if (!setting || !setting.setting_value) return null;
    
    // פענוח אם זה ערך רגיש
    const isSensitive = SENSITIVE_SETTINGS.some(s => settingKey.includes(s));
    if (isSensitive) {
      return decrypt(setting.setting_value, userId);
    }
    
    return setting.setting_value;
  } catch (error) {
    console.error('Error getting addon setting:', error);
    return null;
  }
}

export default router;
