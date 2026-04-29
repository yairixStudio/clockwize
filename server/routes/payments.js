import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth.js';

const router = Router();

// Helper to get db from app
const getDb = (req) => req.app.locals.db;

// Helper to get additional associations for a payment
const getPaymentAssociations = (db, paymentId) => {
    try {
        return db.prepare(`
            SELECT pa.*, 
                proj.name as project_name,
                t.name as task_name
            FROM payment_associations pa
            LEFT JOIN projects proj ON pa.project_id = proj.id
            LEFT JOIN tasks t ON pa.task_id = t.id
            WHERE pa.payment_id = ?
        `).all(paymentId);
    } catch (e) {
        return [];
    }
};

// Get all payments with filters
router.get('/', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { project_id, client_id, status, type, start_date, end_date } = req.query;

        let query = `
            SELECT p.*, 
                proj.name as project_name, 
                proj.client_id,
                c.name as client_name,
                t.name as task_name
            FROM payments p
            LEFT JOIN projects proj ON p.project_id = proj.id
            LEFT JOIN clients c ON proj.client_id = c.id
            LEFT JOIN tasks t ON p.task_id = t.id
            WHERE p.workspace_id = ? AND (p.type IS NULL OR p.type = 'income')
        `;
        const params = [req.workspaceId];

        if (project_id) {
            // Also include payments that have this project in their associations
            query += ` AND (p.project_id = ? OR p.id IN (
                SELECT payment_id FROM payment_associations WHERE project_id = ?
            ))`;
            params.push(project_id, project_id);
        }

        if (client_id) {
            query += ' AND proj.client_id = ?';
            params.push(client_id);
        }

        if (status) {
            query += ' AND p.status = ?';
            params.push(status);
        }

        if (type) {
            query += ' AND p.type = ?';
            params.push(type);
        }

        if (start_date) {
            query += ' AND p.date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND p.date <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY p.date DESC, p.created_at DESC';

        const payments = db.prepare(query).all(...params);
        
        // Add associations to each payment
        const paymentsWithAssociations = payments.map(payment => ({
            ...payment,
            additional_associations: getPaymentAssociations(db, payment.id)
        }));
        
        res.json(paymentsWithAssociations);
    } catch (error) {
        console.error('Get payments error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת התשלומים' });
    }
});

// Get payments summary (monthly)
router.get('/summary', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { start_date, end_date } = req.query;

        let dateFilter = '';
        const params = [req.workspaceId];

        if (start_date && end_date) {
            dateFilter = ' AND p.date >= ? AND p.date <= ?';
            params.push(start_date, end_date);
        }

        // Total income (paid)
        const incomeResult = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments p
            WHERE p.workspace_id = ? AND (p.type IS NULL OR p.type = 'income') AND p.status = 'paid'${dateFilter}
        `).get(...params);

        // Pending income
        const pendingParams = [req.workspaceId];
        if (start_date && end_date) {
            pendingParams.push(start_date, end_date);
        }
        const pendingResult = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments p
            WHERE p.workspace_id = ? AND (p.type IS NULL OR p.type = 'income') AND p.status IN ('pending', 'sent', 'draft')${dateFilter}
        `).get(...pendingParams);

        // Overdue payments
        const overdueResult = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM payments p
            WHERE p.workspace_id = ? AND (p.type IS NULL OR p.type = 'income') 
            AND p.status IN ('pending', 'sent') 
            AND p.due_date < date('now')
        `).get(req.workspaceId);

        // By client
        const byClientParams = [req.workspaceId];
        if (start_date && end_date) {
            byClientParams.push(start_date, end_date);
        }
        const byClient = db.prepare(`
            SELECT 
                c.id,
                c.name,
                COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END), 0) as paid,
                COALESCE(SUM(CASE WHEN p.status IN ('pending', 'sent', 'draft') THEN p.amount ELSE 0 END), 0) as pending
            FROM clients c
            LEFT JOIN projects proj ON proj.client_id = c.id
            LEFT JOIN payments p ON p.project_id = proj.id AND (p.type IS NULL OR p.type = 'income')${dateFilter.replace('p.date', 'p.date')}
            WHERE c.workspace_id = ?
            GROUP BY c.id
            HAVING paid > 0 OR pending > 0
            ORDER BY paid DESC
        `).all(...byClientParams.reverse());

        res.json({
            income: incomeResult.total,
            pending: pendingResult.total,
            overdue: overdueResult.total,
            byClient
        });
    } catch (error) {
        console.error('Get payments summary error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת סיכום התשלומים' });
    }
});

// Get pending payments
router.get('/pending', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);

        const payments = db.prepare(`
            SELECT p.*, 
                proj.name as project_name, 
                proj.client_id,
                c.name as client_name,
                t.name as task_name
            FROM payments p
            LEFT JOIN projects proj ON p.project_id = proj.id
            LEFT JOIN clients c ON proj.client_id = c.id
            LEFT JOIN tasks t ON p.task_id = t.id
            WHERE p.workspace_id = ? 
            AND (p.type IS NULL OR p.type = 'income')
            AND p.status IN ('pending', 'sent', 'draft')
            ORDER BY p.due_date ASC NULLS LAST, p.date DESC
        `).all(req.workspaceId);

        res.json(payments);
    } catch (error) {
        console.error('Get pending payments error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת תשלומים ממתינים' });
    }
});

// Get overdue payments
router.get('/overdue', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);

        const payments = db.prepare(`
            SELECT p.*, 
                proj.name as project_name, 
                proj.client_id,
                c.name as client_name,
                t.name as task_name,
                julianday('now') - julianday(p.due_date) as days_overdue
            FROM payments p
            LEFT JOIN projects proj ON p.project_id = proj.id
            LEFT JOIN clients c ON proj.client_id = c.id
            LEFT JOIN tasks t ON p.task_id = t.id
            WHERE p.workspace_id = ? 
            AND (p.type IS NULL OR p.type = 'income')
            AND p.status IN ('pending', 'sent')
            AND p.due_date < date('now')
            ORDER BY p.due_date ASC
        `).all(req.workspaceId);

        res.json(payments);
    } catch (error) {
        console.error('Get overdue payments error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת תשלומים באיחור' });
    }
});

// Create a new payment
router.post('/', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { 
            project_id, 
            task_id,
            amount, 
            date, 
            notes,
            type = 'income',
            status = 'paid',
            due_date,
            payment_method,
            additional_associations = []
        } = req.body;

        if (!amount || !date) {
            return res.status(400).json({ error: 'חסרים פרטי חובה (סכום, תאריך)' });
        }

        // Verify project belongs to workspace (if provided)
        if (project_id) {
            const project = db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ?').get(project_id, req.workspaceId);
            if (!project) {
                return res.status(404).json({ error: 'פרויקט לא נמצא' });
            }
        }

        const id = uuidv4();
        const createdAt = new Date().toISOString();
        const paidDate = status === 'paid' ? date : null;

        db.prepare(`
            INSERT INTO payments (
                id, project_id, task_id, workspace_id, amount, date, notes, 
                type, status, due_date, paid_date, payment_method, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, 
            project_id || null, 
            task_id || null,
            req.workspaceId, 
            amount, 
            date, 
            notes || null,
            type,
            status,
            due_date || null,
            paidDate,
            payment_method || null,
            createdAt
        );

        // Save additional associations
        if (additional_associations && additional_associations.length > 0) {
            for (const assoc of additional_associations) {
                if (assoc.project_id || assoc.task_id) {
                    const assocId = uuidv4();
                    db.prepare(`
                        INSERT INTO payment_associations (id, payment_id, project_id, task_id, workspace_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(assocId, id, assoc.project_id || null, assoc.task_id || null, req.workspaceId, createdAt);
                }
            }
        }

        // Update project paid amount (only for income payments that are paid)
        if (project_id && type === 'income' && status === 'paid') {
            const totalPaid = db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total 
                FROM payments 
                WHERE project_id = ? AND (type IS NULL OR type = 'income') AND status = 'paid'
            `).get(project_id).total || 0;
            db.prepare('UPDATE projects SET paid_amount = ? WHERE id = ?').run(totalPaid, project_id);
        }

        const payment = db.prepare(`
            SELECT p.*, 
                proj.name as project_name,
                c.name as client_name
            FROM payments p
            LEFT JOIN projects proj ON p.project_id = proj.id
            LEFT JOIN clients c ON proj.client_id = c.id
            WHERE p.id = ?
        `).get(id);
        
        payment.additional_associations = getPaymentAssociations(db, id);
        
        res.status(201).json(payment);
    } catch (error) {
        console.error('Create payment error:', error);
        res.status(500).json({ error: 'שגיאה ביצירת התשלום' });
    }
});

// Update a payment
router.put('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { 
            amount, 
            date, 
            notes,
            project_id,
            task_id,
            type,
            status,
            due_date,
            payment_method,
            additional_associations
        } = req.body;
        const { id } = req.params;

        const payment = db.prepare(`
            SELECT * FROM payments WHERE id = ? AND workspace_id = ?
        `).get(id, req.workspaceId);

        if (!payment) {
            return res.status(404).json({ error: 'תשלום לא נמצא' });
        }

        // Determine paid_date based on status
        let paidDate = payment.paid_date;
        const newStatus = status !== undefined ? status : payment.status;
        if (newStatus === 'paid' && payment.status !== 'paid') {
            paidDate = date || payment.date || new Date().toISOString();
        } else if (newStatus !== 'paid') {
            paidDate = null;
        }

        db.prepare(`
            UPDATE payments 
            SET amount = ?, date = ?, notes = ?, project_id = ?, task_id = ?,
                type = ?, status = ?, due_date = ?, paid_date = ?, payment_method = ?
            WHERE id = ?
        `).run(
            amount !== undefined ? amount : payment.amount,
            date !== undefined ? date : payment.date,
            notes !== undefined ? notes : payment.notes,
            project_id !== undefined ? project_id : payment.project_id,
            task_id !== undefined ? task_id : payment.task_id,
            type !== undefined ? type : payment.type,
            newStatus,
            due_date !== undefined ? due_date : payment.due_date,
            paidDate,
            payment_method !== undefined ? payment_method : payment.payment_method,
            id
        );

        // Update additional associations if provided
        if (additional_associations !== undefined) {
            // Delete existing associations
            db.prepare('DELETE FROM payment_associations WHERE payment_id = ?').run(id);
            
            // Insert new associations
            if (additional_associations && additional_associations.length > 0) {
                const createdAt = new Date().toISOString();
                for (const assoc of additional_associations) {
                    if (assoc.project_id || assoc.task_id) {
                        const assocId = uuidv4();
                        db.prepare(`
                            INSERT INTO payment_associations (id, payment_id, project_id, task_id, workspace_id, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `).run(assocId, id, assoc.project_id || null, assoc.task_id || null, req.workspaceId, createdAt);
                    }
                }
            }
        }

        // Update project paid amount for the old and new projects
        const projectsToUpdate = new Set([payment.project_id]);
        if (project_id && project_id !== payment.project_id) {
            projectsToUpdate.add(project_id);
        }

        for (const projId of projectsToUpdate) {
            if (projId) {
                const totalPaid = db.prepare(`
                    SELECT COALESCE(SUM(amount), 0) as total 
                    FROM payments 
                    WHERE project_id = ? AND (type IS NULL OR type = 'income') AND status = 'paid'
                `).get(projId).total || 0;
                db.prepare('UPDATE projects SET paid_amount = ? WHERE id = ?').run(totalPaid, projId);
            }
        }

        const updatedPayment = db.prepare(`
            SELECT p.*, 
                proj.name as project_name,
                c.name as client_name
            FROM payments p
            LEFT JOIN projects proj ON p.project_id = proj.id
            LEFT JOIN clients c ON proj.client_id = c.id
            WHERE p.id = ?
        `).get(id);
        
        updatedPayment.additional_associations = getPaymentAssociations(db, id);
        
        res.json(updatedPayment);
    } catch (error) {
        console.error('Update payment error:', error);
        res.status(500).json({ error: 'שגיאה בעדכון התשלום' });
    }
});

// Update payment status (quick status change)
router.put('/:id/status', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { status } = req.body;
        const { id } = req.params;

        const validStatuses = ['draft', 'sent', 'pending', 'paid', 'cancelled', 'overdue'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'סטטוס לא חוקי' });
        }

        const payment = db.prepare(`
            SELECT * FROM payments WHERE id = ? AND workspace_id = ?
        `).get(id, req.workspaceId);

        if (!payment) {
            return res.status(404).json({ error: 'תשלום לא נמצא' });
        }

        // Set paid_date when marking as paid
        const paidDate = status === 'paid' ? new Date().toISOString() : null;

        db.prepare(`
            UPDATE payments SET status = ?, paid_date = COALESCE(?, paid_date) WHERE id = ?
        `).run(status, paidDate, id);

        // Update project paid amount
        if (payment.project_id) {
            const totalPaid = db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total 
                FROM payments 
                WHERE project_id = ? AND (type IS NULL OR type = 'income') AND status = 'paid'
            `).get(payment.project_id).total || 0;
            db.prepare('UPDATE projects SET paid_amount = ? WHERE id = ?').run(totalPaid, payment.project_id);
        }

        const updatedPayment = db.prepare(`
            SELECT p.*, 
                proj.name as project_name,
                c.name as client_name
            FROM payments p
            LEFT JOIN projects proj ON p.project_id = proj.id
            LEFT JOIN clients c ON proj.client_id = c.id
            WHERE p.id = ?
        `).get(id);
        
        res.json(updatedPayment);
    } catch (error) {
        console.error('Update payment status error:', error);
        res.status(500).json({ error: 'שגיאה בעדכון סטטוס התשלום' });
    }
});

// Delete a payment
router.delete('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { id } = req.params;

        const payment = db.prepare(`
            SELECT * FROM payments WHERE id = ? AND workspace_id = ?
        `).get(id, req.workspaceId);

        if (!payment) {
            return res.status(404).json({ error: 'תשלום לא נמצא' });
        }

        db.prepare('DELETE FROM payments WHERE id = ?').run(id);

        // Update project paid amount
        if (payment.project_id) {
            const totalPaid = db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total 
                FROM payments 
                WHERE project_id = ? AND (type IS NULL OR type = 'income') AND status = 'paid'
            `).get(payment.project_id).total || 0;
            db.prepare('UPDATE projects SET paid_amount = ? WHERE id = ?').run(totalPaid, payment.project_id);
        }

        res.json({ message: 'התשלום נמחק בהצלחה' });
    } catch (error) {
        console.error('Delete payment error:', error);
        res.status(500).json({ error: 'שגיאה במחיקת התשלום' });
    }
});

// Get single payment
router.get('/:id', authMiddleware, workspaceMiddleware, (req, res) => {
    try {
        const db = getDb(req);
        const { id } = req.params;

        const payment = db.prepare(`
            SELECT p.*, 
                proj.name as project_name, 
                proj.client_id,
                c.name as client_name,
                t.name as task_name
            FROM payments p
            LEFT JOIN projects proj ON p.project_id = proj.id
            LEFT JOIN clients c ON proj.client_id = c.id
            LEFT JOIN tasks t ON p.task_id = t.id
            WHERE p.id = ? AND p.workspace_id = ?
        `).get(id, req.workspaceId);

        if (!payment) {
            return res.status(404).json({ error: 'תשלום לא נמצא' });
        }

        res.json(payment);
    } catch (error) {
        console.error('Get payment error:', error);
        res.status(500).json({ error: 'שגיאה בטעינת התשלום' });
    }
});

export default router;
