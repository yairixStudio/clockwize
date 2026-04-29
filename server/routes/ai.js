import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';
import { getAddonSetting } from './addons.js';

const router = express.Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// System prompt for the AI
const SYSTEM_PROMPT = `אתה עוזר AI של מערכת Clockwize - מערכת לניהול לקוחות, פרויקטים ומשימות.

המשתמש יתאר מה הוא רוצה ליצור, ואתה תחזיר תוכנית ביצוע בפורמט JSON.

## סוגי ישויות שניתן ליצור:

### 1. לקוח (client)
שדות אפשריים:
- name (חובה) - שם הלקוח
- phone - מספר טלפון
- email - כתובת אימייל
- address - כתובת
- notes - הערות
- hourly_rate - מחיר לשעה (מספר)
- status - סטטוס: "active" או "inactive"

### 2. פרויקט (project)
שדות אפשריים:
- name (חובה) - שם הפרויקט
- client_id או client_ref - מזהה/הפניה ללקוח (חובה)
- description - תיאור
- pricing_type - סוג תמחור: "hourly" או "fixed"
- fixed_price - מחיר קבוע (אם pricing_type="fixed")
- hourly_rate - מחיר לשעה
- estimated_hours - שעות משוערות
- status - סטטוס: "active", "completed", "on_hold"
- priority - עדיפות: "low", "normal", "high"

### 3. משימה (task)
שדות אפשריים:
- name (חובה) - שם המשימה
- project_id או project_ref - מזהה/הפניה לפרויקט (חובה)
- description - תיאור
- hourly_rate - מחיר לשעה
- estimated_hours - שעות משוערות
- status - סטטוס: "pending", "in_progress", "completed"
- priority - עדיפות: "low", "normal", "high"

### 4. תת-משימה (subtask)
שדות אפשריים:
- title (חובה) - כותרת
- task_id או task_ref - מזהה/הפניה למשימה (חובה)

### 5. תזכורת (reminder)
שדות אפשריים:
- content (חובה) - תוכן התזכורת
- due_date - תאריך יעד (ISO format)
- association_type - סוג שיוך: "general", "client", "project", "task"
- association_id או association_ref - מזהה/הפניה לישות המשויכת

## כללים חשובים:
1. כאשר יוצרים ישויות מקושרות (למשל לקוח עם פרויקטים), השתמש ב-temp_id ו-client_ref/project_ref/task_ref להפניות
2. הישויות יורצו בסדר: לקוחות, פרויקטים, משימות, תתי-משימות, תזכורות
3. **זיהוי ישויות קיימות - קריטי!**
   - **לקוח קיים:** אם המשתמש אומר "בלקוח X", "ללקוח X", "של לקוח X", "תוסיף ללקוח X" - זה לקוח קיים! השתמש ב-existing_client_name
   - **פרויקט קיים:** אם המשתמש אומר "בפרויקט X", "לפרויקט X", "של פרויקט X", "תוסיף בפרויקט X", "תוסיף לפרויקט X", "הוסף משימה לפרויקט X" - זה תמיד פרויקט קיים! השתמש ב-existing_project_name
   - **משימה קיימת:** אם המשתמש אומר "במשימה X", "למשימה X", "תוסיף תת-משימה למשימה X" - זה משימה קיימת! השתמש ב-existing_task_name
   - **חשוב מאוד:** אם המשתמש מבקש להוסיף משימה/תת-משימה/תזכורת לפרויקט בשם מסוים, זה תמיד פרויקט קיים! רק אם הוא אומר במפורש "צור פרויקט חדש" או "פרויקט חדש בשם X" - אז זה פרויקט חדש
4. אם המשתמש מזכיר לקוח קיים בשם, הוסף שדה existing_client_name כדי שהמערכת תמצא אותו
5. אם המשתמש מזכיר פרויקט קיים בשם, הוסף שדה existing_project_name (לא project_ref!)
6. אם המשתמש מזכיר משימה קיימת בשם, הוסף שדה existing_task_name (לא task_ref!)
7. **אל תצור פרויקט חדש אם המשתמש מבקש להוסיף משהו לפרויקט קיים!**
8. כשאתה בטוח מה המשתמש רוצה - החזר JSON תקין. אם יש אי-בהירות (למשל לקוח/פרויקט לא ברור, או חסר מידע קריטי) - שאל שאלת הבהרה בטקסט רגיל ללא JSON.
9. כשהמשתמש מבקש ליצור רשימה גדולה של משימות או תתי-משימות (5+), וודא שכל פריט מקבל שם ברור ומייצג. **אל תקצר, אל תדלג, ואל תאחד** - צור את כל הפריטים שהמשתמש ביקש.
10. **חשוב מאוד:** לפני שאתה מחזיר תוכנית עם existing_client_name או existing_project_name או existing_task_name, השתמש בפונקציות search_clients/search_projects/search_tasks כדי לוודא שהישות קיימת ולקבל את השם המדויק שלה. אם החיפוש מחזיר תוצאה עם שם קצת שונה - השתמש בשם המדויק מהמערכת.
11. כשיוצרים משימות עם תתי-משימות באותה תוכנית, השתמש ב-temp_id למשימה ו-task_ref לתתי-המשימות כדי לקשר ביניהם

## פורמט התגובה:
{
  "summary": "תיאור קצר של מה שיווצר",
  "plan": [
    {
      "type": "client",
      "temp_id": "c1",
      "data": { "name": "יוסי כהן", "phone": "050-1234567" }
    },
    {
      "type": "project",
      "temp_id": "p1",
      "data": { "name": "אתר תדמית", "client_ref": "c1", "pricing_type": "fixed", "fixed_price": 5000 }
    }
  ]
}

## דוגמאות:

קלט: "צור לקוח חדש בשם דני לוי עם טלפון 052-9876543"
פלט:
{
  "summary": "יצירת לקוח חדש: דני לוי",
  "plan": [
    {
      "type": "client",
      "temp_id": "c1",
      "data": { "name": "דני לוי", "phone": "052-9876543" }
    }
  ]
}

קלט: "צור פרויקט אתר חדש ללקוח יוסי עם 3 משימות: עיצוב, פיתוח, בדיקות"
פלט:
{
  "summary": "יצירת פרויקט 'אתר' עם 3 משימות עבור לקוח קיים 'יוסי'",
  "plan": [
    {
      "type": "project",
      "temp_id": "p1",
      "data": { "name": "אתר", "existing_client_name": "יוסי" }
    },
    {
      "type": "task",
      "temp_id": "t1",
      "data": { "name": "עיצוב", "project_ref": "p1" }
    },
    {
      "type": "task",
      "temp_id": "t2",
      "data": { "name": "פיתוח", "project_ref": "p1" }
    },
    {
      "type": "task",
      "temp_id": "t3",
      "data": { "name": "בדיקות", "project_ref": "p1" }
    }
  ]
}

קלט: "תזכיר לי להתקשר לדני מחר ב-10:00"
פלט:
{
  "summary": "יצירת תזכורת להתקשר לדני",
  "plan": [
    {
      "type": "reminder",
      "temp_id": "r1",
      "data": { 
        "content": "להתקשר לדני", 
        "due_date": "2024-01-02T10:00:00",
        "association_type": "client",
        "existing_client_name": "דני"
      }
    }
  ]
}

קלט: "תוסיף בפרויקט יוסיוס ימלך משימה לערוך אתר אינטרנט"
פלט:
{
  "summary": "הוספת משימה לפרויקט קיים 'יוסיוס ימלך'",
  "plan": [
    {
      "type": "task",
      "temp_id": "t1",
      "data": { 
        "name": "עריכת אתר אינטרנט",
        "existing_project_name": "יוסיוס ימלך"
      }
    }
  ]
}

קלט: "תוסיף משימה לפרויקט אתר תדמית"
פלט:
{
  "summary": "הוספת משימה לפרויקט קיים 'אתר תדמית'",
  "plan": [
    {
      "type": "task",
      "temp_id": "t1",
      "data": {
        "name": "משימה חדשה",
        "existing_project_name": "אתר תדמית"
      }
    }
  ]
}

קלט: "הוסף לפרויקט אתר תדמית משימה עיצוב דף הבית עם תתי-משימות: wireframe, עיצוב מובייל, עיצוב דסקטופ"
פלט:
{
  "summary": "הוספת משימה 'עיצוב דף הבית' עם 3 תתי-משימות לפרויקט קיים 'אתר תדמית'",
  "plan": [
    {
      "type": "task",
      "temp_id": "t1",
      "data": { "name": "עיצוב דף הבית", "existing_project_name": "אתר תדמית" }
    },
    {
      "type": "subtask",
      "temp_id": "st1",
      "data": { "title": "Wireframe", "task_ref": "t1" }
    },
    {
      "type": "subtask",
      "temp_id": "st2",
      "data": { "title": "עיצוב מובייל", "task_ref": "t1" }
    },
    {
      "type": "subtask",
      "temp_id": "st3",
      "data": { "title": "עיצוב דסקטופ", "task_ref": "t1" }
    }
  ]
}`;

// Helper function to search entities
function searchEntities(db, workspaceId, type, filters = {}) {
  switch (type) {
    case 'clients': {
      let query = `SELECT id, name, email, phone FROM clients WHERE workspace_id = ?`;
      const params = [workspaceId];
      
      if (filters.search) {
        query += ` AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)`;
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      query += ` ORDER BY name LIMIT ${filters.limit || 50}`;
      return db.prepare(query).all(...params);
    }
    
    case 'projects': {
      let query = `
        SELECT p.id, p.name, c.name as client_name, c.id as client_id
        FROM projects p 
        JOIN clients c ON p.client_id = c.id 
        WHERE p.workspace_id = ?
      `;
      const params = [workspaceId];
      
      if (filters.client_id) {
        query += ` AND p.client_id = ?`;
        params.push(filters.client_id);
      }
      
      if (filters.search) {
        query += ` AND (p.name LIKE ? OR c.name LIKE ?)`;
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
      }
      
      query += ` ORDER BY p.name LIMIT ${filters.limit || 50}`;
      return db.prepare(query).all(...params);
    }
    
    case 'tasks': {
      let query = `
        SELECT t.id, t.name, p.name as project_name, p.id as project_id, c.name as client_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        JOIN clients c ON p.client_id = c.id
        WHERE t.workspace_id = ?
      `;
      const params = [workspaceId];
      
      if (filters.project_id) {
        query += ` AND t.project_id = ?`;
        params.push(filters.project_id);
      }
      
      if (filters.search) {
        query += ` AND t.name LIKE ?`;
        params.push(`%${filters.search}%`);
      }
      
      query += ` ORDER BY t.name LIMIT ${filters.limit || 50}`;
      return db.prepare(query).all(...params);
    }
    
    default:
      return [];
  }
}

// Chat endpoint - sends message to AI and gets a plan (with function calling support)
router.post('/chat', authMiddleware, workspaceMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const { message, conversationHistory = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'הודעה נדרשת' });
    }

    // Get OpenAI API key from addon settings
    const apiKey = await getAddonSetting(db, req.workspaceId, req.userId, 'ai_assistant', 'openai_api_key');
    
    if (!apiKey) {
      return res.status(400).json({ 
        error: 'מפתח API לא מוגדר',
        details: 'יש להגדיר מפתח OpenAI API בהגדרות התוסף'
      });
    }

    // Define available tools for the AI (using tools format for newer models)
    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_clients',
          description: 'חיפוש לקוחות במערכת. השתמש בפונקציה זו כאשר צריך למצוא לקוח קיים או לראות רשימת לקוחות.',
          parameters: {
            type: 'object',
            properties: {
              search: {
                type: 'string',
                description: 'מילת חיפוש (שם, אימייל, טלפון) - אופציונלי'
              },
              limit: {
                type: 'number',
                description: 'מספר מקסימלי של תוצאות (ברירת מחדל: 50)'
              }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_projects',
          description: 'חיפוש פרויקטים במערכת. השתמש בפונקציה זו כאשר צריך למצוא פרויקט קיים או לראות רשימת פרויקטים.',
          parameters: {
            type: 'object',
            properties: {
              client_id: {
                type: 'string',
                description: 'מזהה לקוח - אם רוצים רק פרויקטים של לקוח מסוים'
              },
              search: {
                type: 'string',
                description: 'מילת חיפוש (שם פרויקט או שם לקוח) - אופציונלי'
              },
              limit: {
                type: 'number',
                description: 'מספר מקסימלי של תוצאות (ברירת מחדל: 50)'
              }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_tasks',
          description: 'חיפוש משימות במערכת. השתמש בפונקציה זו כאשר צריך למצוא משימה קיימת או לראות רשימת משימות.',
          parameters: {
            type: 'object',
            properties: {
              project_id: {
                type: 'string',
                description: 'מזהה פרויקט - אם רוצים רק משימות של פרויקט מסוים'
              },
              search: {
                type: 'string',
                description: 'מילת חיפוש (שם משימה) - אופציונלי'
              },
              limit: {
                type: 'number',
                description: 'מספר מקסימלי של תוצאות (ברירת מחדל: 50)'
              }
            }
          }
        }
      }
    ];

    // Build messages array with conversation history
    const messages = [
      { 
        role: 'system', 
        content: SYSTEM_PROMPT + '\n\n**חשוב:** אם אתה לא בטוח איזה לקוח/פרויקט/משימה המשתמש מתכוון, השתמש בפונקציות search_clients, search_projects, או search_tasks כדי לחפש. אל תניח - תמיד חפש! אם מצאת ישות בחיפוש, השתמש בשם המדויק שלה כפי שהוא מופיע בתוצאות. אם החיפוש לא מצא התאמה ואתה לא בטוח - שאל את המשתמש.'
      }
    ];

    // Add conversation history (filter out invalid messages)
    if (Array.isArray(conversationHistory)) {
      conversationHistory.forEach(msg => {
        if (msg && msg.role && msg.content && (msg.role === 'user' || msg.role === 'assistant')) {
          messages.push({
            role: msg.role,
            content: msg.content
          });
        }
      });
    }

    // Add current user message
    messages.push({ 
      role: 'user', 
      content: `התאריך והשעה הנוכחיים: ${new Date().toISOString()}\n\nבקשת המשתמש: ${message}` 
    });

    // Call OpenAI API with tool calling
    console.log('Calling OpenAI API with', messages.length, 'messages');
    let response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        tools: tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 4096
      })
    });
    
    console.log('OpenAI response status:', response.status);

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: { message: await response.text() } };
      }
      console.error('OpenAI API error:', errorData);
      
      if (response.status === 401) {
        return res.status(400).json({ 
          error: 'מפתח API לא תקין',
          details: 'יש לבדוק את מפתח ה-API בהגדרות התוסף'
        });
      }
      
      return res.status(500).json({ 
        error: 'שגיאה בתקשורת עם AI',
        details: errorData.error?.message || 'שגיאה לא ידועה'
      });
    }

    let aiResponse = await response.json();
    let aiMessage = aiResponse.choices[0]?.message;
    
    // Handle tool calls - allow up to 3 iterations
    let iterations = 0;
    while (aiMessage.tool_calls && aiMessage.tool_calls.length > 0 && iterations < 3) {
      iterations++;
      
      // Process all tool calls in parallel
      const toolCalls = aiMessage.tool_calls;
      const toolResults = [];
      
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments || '{}');
        
        // Execute the function
        let functionResult;
        try {
          switch (functionName) {
            case 'search_clients':
              functionResult = searchEntities(db, req.workspaceId, 'clients', functionArgs);
              break;
            case 'search_projects':
              functionResult = searchEntities(db, req.workspaceId, 'projects', functionArgs);
              break;
            case 'search_tasks':
              functionResult = searchEntities(db, req.workspaceId, 'tasks', functionArgs);
              break;
            default:
              functionResult = { error: `Unknown function: ${functionName}` };
          }
        } catch (error) {
          console.error('Function execution error:', error);
          functionResult = { error: error.message };
        }
        
        toolResults.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: functionName,
          content: JSON.stringify(functionResult)
        });
      }
      
      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        tool_calls: toolCalls,
        content: null
      });
      
      // Add tool results
      messages.push(...toolResults);
      
      // Call OpenAI again with tool results
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: messages,
          tools: tools,
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 4096
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error('OpenAI API error in tool call:', error);
        return res.status(500).json({ error: 'שגיאה בתקשורת עם AI', details: error.error?.message });
      }
      
      aiResponse = await response.json();
      aiMessage = aiResponse.choices[0]?.message;
    }
    
    const content = aiMessage?.content;

    // If no content and still has tool_calls, something went wrong
    if (!content && aiMessage?.tool_calls && aiMessage.tool_calls.length > 0) {
      console.error('AI returned tool calls but no content after iterations');
      return res.status(500).json({ 
        error: 'ה-AI לא הצליח להשלים את הבקשה',
        details: 'נסה לנסח את הבקשה בצורה אחרת'
      });
    }

    if (!content) {
      return res.status(500).json({ error: 'לא התקבלה תשובה מה-AI' });
    }

    // Parse JSON from response
    let plan;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        plan = JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON found, it might be just a question or clarification
        // Return it as a summary without a plan
        return res.json({
          summary: content,
          plan: []
        });
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      // If parsing failed, return the content as summary
      return res.json({
        summary: content,
        plan: []
      });
    }

    // Resolve existing entity references
    const warnings = [];
    if (plan.plan) {
      for (const item of plan.plan) {
        // Resolve existing client
        if (item.data?.existing_client_name) {
          const clientName = item.data.existing_client_name;
          const matchingClients = searchEntities(db, req.workspaceId, 'clients', { search: clientName, limit: 5 });

          // Try exact match first (case-insensitive)
          let foundClient = matchingClients.find(c =>
            c.name.toLowerCase().trim() === clientName.toLowerCase().trim()
          );
          // Then partial match
          if (!foundClient) {
            foundClient = matchingClients.find(c => {
              const cName = c.name.toLowerCase().trim();
              const searchName = clientName.toLowerCase().trim();
              return cName.includes(searchName) || searchName.includes(cName);
            });
          }

          if (foundClient) {
            item.data.client_id = foundClient.id;
            item.data.resolved_client_name = foundClient.name;
          } else if (matchingClients.length > 0) {
            item.data.match_candidates = matchingClients.map(c => ({ id: c.id, name: c.name }));
            item.data.unresolved_name = clientName;
            warnings.push(`לא נמצא לקוח בשם "${clientName}" - אולי התכוונת ל: ${matchingClients.map(c => c.name).join(', ')}?`);
          } else {
            item.data.unresolved_name = clientName;
            warnings.push(`לא נמצא לקוח בשם "${clientName}" במערכת`);
          }
          delete item.data.existing_client_name;
        }

        // Resolve existing project
        if (item.data?.existing_project_name) {
          const projectName = item.data.existing_project_name;
          const matchingProjects = searchEntities(db, req.workspaceId, 'projects', { search: projectName, limit: 5 });

          // Try exact match first
          let foundProject = matchingProjects.find(p =>
            p.name.toLowerCase().trim() === projectName.toLowerCase().trim()
          );
          // Then partial match
          if (!foundProject) {
            foundProject = matchingProjects.find(p => {
              const pName = p.name.toLowerCase().trim();
              const searchName = projectName.toLowerCase().trim();
              return pName.includes(searchName) || searchName.includes(pName);
            });
          }

          if (foundProject) {
            item.data.project_id = foundProject.id;
            item.data.resolved_project_name = foundProject.name;
            item.data.resolved_client_name = foundProject.client_name;
          } else if (matchingProjects.length > 0) {
            item.data.match_candidates = matchingProjects.map(p => ({ id: p.id, name: p.name, client_name: p.client_name }));
            item.data.unresolved_name = projectName;
            warnings.push(`לא נמצא פרויקט בשם "${projectName}" - אולי התכוונת ל: ${matchingProjects.map(p => p.name).join(', ')}?`);
          } else {
            item.data.unresolved_name = projectName;
            warnings.push(`לא נמצא פרויקט בשם "${projectName}" במערכת`);
          }
          delete item.data.existing_project_name;
        }

        // Resolve existing task (for subtasks)
        if (item.data?.existing_task_name) {
          const taskName = item.data.existing_task_name;
          const matchingTasks = searchEntities(db, req.workspaceId, 'tasks', { search: taskName, limit: 5 });

          // Try exact match first
          let foundTask = matchingTasks.find(t =>
            t.name.toLowerCase().trim() === taskName.toLowerCase().trim()
          );
          // Then partial match
          if (!foundTask) {
            foundTask = matchingTasks.find(t => {
              const tName = t.name.toLowerCase().trim();
              const searchName = taskName.toLowerCase().trim();
              return tName.includes(searchName) || searchName.includes(tName);
            });
          }

          if (foundTask) {
            item.data.task_id = foundTask.id;
            item.data.resolved_task_name = foundTask.name;
            item.data.resolved_project_name = foundTask.project_name;
            item.data.resolved_client_name = foundTask.client_name;
          } else if (matchingTasks.length > 0) {
            item.data.match_candidates = matchingTasks.map(t => ({ id: t.id, name: t.name, project_name: t.project_name }));
            item.data.unresolved_name = taskName;
            warnings.push(`לא נמצאה משימה בשם "${taskName}" - אולי התכוונת ל: ${matchingTasks.map(t => t.name).join(', ')}?`);
          } else {
            item.data.unresolved_name = taskName;
            warnings.push(`לא נמצאה משימה בשם "${taskName}" במערכת`);
          }
          delete item.data.existing_task_name;
        }
      }
    }

    if (warnings.length > 0) {
      plan.warnings = warnings;
    }

    res.json(plan);
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ error: 'שגיאה בעיבוד הבקשה' });
  }
});

// Execute endpoint - creates the entities from the approved plan
router.post('/execute', authMiddleware, workspaceMiddleware, async (req, res) => {
  try {
    const db = getDb(req);
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'לא נבחרו פריטים ליצירה' });
    }

    const created = [];
    const tempIdMap = {}; // Maps temp_id to real id

    // Sort items by type to ensure correct creation order
    const typeOrder = ['client', 'project', 'task', 'subtask', 'reminder'];
    const sortedItems = [...items].sort((a, b) => {
      return typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
    });

    for (const item of sortedItems) {
      try {
        let createdEntity = null;

        switch (item.type) {
          case 'client': {
            const { name, phone, email, address, notes, hourly_rate, status } = item.data;
            const id = uuidv4();
            
            db.prepare(`
              INSERT INTO clients (id, user_id, workspace_id, name, phone, email, address, notes, hourly_rate, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, req.userId, req.workspaceId, name, phone || null, email || null, address || null, notes || null, hourly_rate || null, status || 'active');

            createdEntity = { type: 'client', id, name };
            if (item.temp_id) tempIdMap[item.temp_id] = id;
            break;
          }

          case 'project': {
            const { name, description, pricing_type, fixed_price, hourly_rate, estimated_hours, status, priority } = item.data;
            let client_id = item.data.client_id;
            
            // Resolve client reference
            if (!client_id && item.data.client_ref) {
              client_id = tempIdMap[item.data.client_ref];
            }

            if (!client_id) {
              throw new Error(`לא נמצא לקוח עבור פרויקט "${name}"`);
            }

            const id = uuidv4();
            
            db.prepare(`
              INSERT INTO projects (id, client_id, user_id, workspace_id, name, description, pricing_type, fixed_price, hourly_rate, estimated_hours, status, priority)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, client_id, req.userId, req.workspaceId, name, description || null, pricing_type || 'hourly', fixed_price || null, hourly_rate || null, estimated_hours || null, status || 'active', priority || 'normal');

            createdEntity = { type: 'project', id, name };
            if (item.temp_id) tempIdMap[item.temp_id] = id;
            break;
          }

          case 'task': {
            const { name, description, hourly_rate, estimated_hours, status, priority } = item.data;
            let project_id = item.data.project_id;
            
            // Resolve project reference
            if (!project_id && item.data.project_ref) {
              project_id = tempIdMap[item.data.project_ref];
            }

            if (!project_id) {
              throw new Error(`לא נמצא פרויקט עבור משימה "${name}"`);
            }

            const id = uuidv4();
            
            db.prepare(`
              INSERT INTO tasks (id, project_id, user_id, workspace_id, name, description, hourly_rate, estimated_hours, status, priority)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, project_id, req.userId, req.workspaceId, name, description || null, hourly_rate || null, estimated_hours || null, status || 'pending', priority || 'normal');

            createdEntity = { type: 'task', id, name };
            if (item.temp_id) tempIdMap[item.temp_id] = id;
            break;
          }

          case 'subtask': {
            const { title } = item.data;
            let task_id = item.data.task_id;
            
            // Resolve task reference
            if (!task_id && item.data.task_ref) {
              task_id = tempIdMap[item.data.task_ref];
            }

            if (!task_id) {
              throw new Error(`לא נמצאה משימה עבור תת-משימה "${title}"`);
            }

            const id = uuidv4();
            
            db.prepare(`
              INSERT INTO subtasks (id, task_id, title)
              VALUES (?, ?, ?)
            `).run(id, task_id, title);

            createdEntity = { type: 'subtask', id, name: title };
            if (item.temp_id) tempIdMap[item.temp_id] = id;
            break;
          }

          case 'reminder': {
            const { content, due_date, association_type, association_id } = item.data;
            let resolved_association_id = association_id;
            
            // Resolve association reference
            if (!resolved_association_id && item.data.association_ref) {
              resolved_association_id = tempIdMap[item.data.association_ref];
            }

            const id = uuidv4();
            
            db.prepare(`
              INSERT INTO reminders (id, user_id, workspace_id, content, due_date, association_type, association_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(id, req.userId, req.workspaceId, content, due_date || null, association_type || 'general', resolved_association_id || null);

            createdEntity = { type: 'reminder', id, name: content.substring(0, 30) + (content.length > 30 ? '...' : '') };
            if (item.temp_id) tempIdMap[item.temp_id] = id;
            break;
          }

          default:
            console.warn(`Unknown item type: ${item.type}`);
        }

        if (createdEntity) {
          created.push(createdEntity);
        }
      } catch (itemError) {
        console.error(`Error creating ${item.type}:`, itemError);
        created.push({
          type: item.type,
          error: itemError.message,
          name: item.data?.name || item.data?.title || item.data?.content
        });
      }
    }

    res.json({ 
      success: true,
      created,
      summary: `נוצרו ${created.filter(c => !c.error).length} פריטים`
    });
  } catch (error) {
    console.error('AI execute error:', error);
    res.status(500).json({ error: 'שגיאה בביצוע הפעולות' });
  }
});

export default router;


