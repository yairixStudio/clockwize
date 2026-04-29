import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, ChevronUp, Edit2, Check, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../utils/format';
import { calculateProjectEarnings } from './PaymentStatusBadge';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import './SmartPaymentModal.css';

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'העברה בנקאית' },
  { value: 'cash', label: 'מזומן' },
  { value: 'check', label: 'צ\'ק' },
  { value: 'credit_card', label: 'כרטיס אשראי' },
  { value: 'bit', label: 'Bit / PayBox' },
  { value: 'other', label: 'אחר' }
];

/**
 * Smart Payment Modal - Allocates payment to projects using FIFO logic
 * 
 * @param {object} client - Client object
 * @param {array} projects - Projects for this client with balances
 * @param {function} onSave - Callback with allocation data
 * @param {function} onClose - Close modal callback
 */
function SmartPaymentModal({ client, projects, onSave, onClose }) {
  useBodyScrollLock(true);

  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isEditingAllocation, setIsEditingAllocation] = useState(false);
  const [customAllocation, setCustomAllocation] = useState({});
  const [loading, setLoading] = useState(false);

  // Calculate balance for each project
  const projectsWithBalance = useMemo(() => {
    return projects
      .map(project => {
        const totalEarned = calculateProjectEarnings(project, client);
        const paidAmount = project.paid_amount || 0;
        const balance = totalEarned - paidAmount;
        return {
          ...project,
          totalEarned,
          paidAmount,
          balance
        };
      })
      .filter(p => p.balance > 0) // Only projects with outstanding balance
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // FIFO - oldest first
  }, [projects, client]);

  // Total outstanding balance
  const totalOutstanding = useMemo(() => {
    return projectsWithBalance.reduce((sum, p) => sum + p.balance, 0);
  }, [projectsWithBalance]);

  // Calculate FIFO allocation
  const fifoAllocation = useMemo(() => {
    const numAmount = parseFloat(amount) || 0;
    if (numAmount <= 0) return {};

    const allocation = {};
    let remaining = numAmount;

    for (const project of projectsWithBalance) {
      if (remaining <= 0) break;
      
      const allocateAmount = Math.min(remaining, project.balance);
      if (allocateAmount > 0) {
        allocation[project.id] = allocateAmount;
        remaining -= allocateAmount;
      }
    }

    return allocation;
  }, [amount, projectsWithBalance]);

  // Use custom allocation if editing, otherwise FIFO
  const currentAllocation = isEditingAllocation ? customAllocation : fifoAllocation;

  // Initialize custom allocation from FIFO when switching to edit mode
  useEffect(() => {
    if (isEditingAllocation && Object.keys(customAllocation).length === 0) {
      setCustomAllocation({ ...fifoAllocation });
    }
  }, [isEditingAllocation, fifoAllocation]);

  // Calculate totals
  const totalAllocated = Object.values(currentAllocation).reduce((sum, val) => sum + (val || 0), 0);
  const numAmount = parseFloat(amount) || 0;
  const creditBalance = numAmount - totalAllocated;

  const handleCustomAllocationChange = (projectId, value) => {
    const numValue = parseFloat(value) || 0;
    setCustomAllocation(prev => ({
      ...prev,
      [projectId]: numValue
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (numAmount <= 0) return;

    setLoading(true);
    try {
      // Prepare payment data for each project
      const payments = Object.entries(currentAllocation)
        .filter(([_, amount]) => amount > 0)
        .map(([projectId, allocatedAmount]) => ({
          project_id: projectId,
          amount: allocatedAmount,
          date,
          payment_method: paymentMethod,
          notes,
          type: 'income',
          status: 'paid',
          paid_date: date
        }));

      // If there's credit balance, store it (could be handled differently)
      await onSave({
        payments,
        totalAmount: numAmount,
        creditBalance: creditBalance > 0 ? creditBalance : 0
      });
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal smart-payment-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">💰 הכנס תשלום - {client.name}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Amount Input */}
            <div className="form-group">
              <label className="form-label">סכום שהתקבל</label>
              <div className="amount-input-wrapper">
                <span className="currency-symbol">₪</span>
                <input
                  type="number"
                  className="form-input amount-input"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  dir="ltr"
                  autoFocus
                  required
                />
              </div>
              {totalOutstanding > 0 && (
                <small className="form-hint">
                  סה"כ חוב פתוח: {formatCurrency(totalOutstanding)}
                  {numAmount > 0 && numAmount < totalOutstanding && (
                    <button 
                      type="button" 
                      className="fill-balance-btn"
                      onClick={() => setAmount(totalOutstanding.toString())}
                    >
                      מלא הכל
                    </button>
                  )}
                </small>
              )}
            </div>

            {/* Date & Payment Method */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">תאריך</label>
                <input
                  type="date"
                  className="form-input"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  dir="ltr"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">אמצעי תשלום</label>
                <select
                  className="form-input"
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                >
                  {PAYMENT_METHODS.map(method => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Allocation Section */}
            {numAmount > 0 && projectsWithBalance.length > 0 && (
              <div className="allocation-section">
                <div className="allocation-header">
                  <h4>חלוקה לפרויקטים</h4>
                  <button
                    type="button"
                    className={`btn btn-sm ${isEditingAllocation ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setIsEditingAllocation(!isEditingAllocation)}
                  >
                    {isEditingAllocation ? (
                      <>
                        <Check size={14} />
                        <span>סיום עריכה</span>
                      </>
                    ) : (
                      <>
                        <Edit2 size={14} />
                        <span>שנה ידנית</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="allocation-list">
                  {projectsWithBalance.map(project => {
                    const allocated = currentAllocation[project.id] || 0;
                    const isFullyPaid = allocated >= project.balance;
                    
                    return (
                      <div 
                        key={project.id} 
                        className={`allocation-item ${isFullyPaid ? 'fully-paid' : ''} ${allocated > 0 ? 'has-allocation' : ''}`}
                      >
                        <div className="allocation-project-info">
                          <span className="project-name">{project.name}</span>
                          <span className="project-balance">
                            יתרה: {formatCurrency(project.balance)}
                          </span>
                        </div>
                        
                        {isEditingAllocation ? (
                          <div className="allocation-input-wrapper">
                            <span className="currency-symbol-small">₪</span>
                            <input
                              type="number"
                              className="form-input allocation-input"
                              value={customAllocation[project.id] || ''}
                              onChange={e => handleCustomAllocationChange(project.id, e.target.value)}
                              placeholder="0"
                              min="0"
                              max={project.balance}
                              step="0.01"
                              dir="ltr"
                            />
                          </div>
                        ) : (
                          <div className="allocation-amount">
                            {allocated > 0 ? (
                              <>
                                <span className="allocated-value">{formatCurrency(allocated)}</span>
                                {isFullyPaid && <Check size={14} className="paid-check" />}
                              </>
                            ) : (
                              <span className="no-allocation">-</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Summary */}
                <div className="allocation-summary">
                  <div className="summary-row">
                    <span>סה"כ מחולק:</span>
                    <span className="summary-value">{formatCurrency(totalAllocated)}</span>
                  </div>
                  {creditBalance > 0 && (
                    <div className="summary-row credit-row">
                      <span>
                        <AlertCircle size={14} />
                        יתרת זכות ללקוח:
                      </span>
                      <span className="summary-value credit-value">{formatCurrency(creditBalance)}</span>
                    </div>
                  )}
                  {creditBalance < 0 && (
                    <div className="summary-row error-row">
                      <span>
                        <AlertCircle size={14} />
                        חריגה מהסכום:
                      </span>
                      <span className="summary-value error-value">{formatCurrency(Math.abs(creditBalance))}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* No outstanding balance message */}
            {projectsWithBalance.length === 0 && (
              <div className="no-balance-message">
                <Check size={24} />
                <p>אין יתרות פתוחות ללקוח זה</p>
                <small>התשלום יישמר כיתרת זכות</small>
              </div>
            )}

            {/* Notes */}
            <div className="form-group">
              <label className="form-label">הערות</label>
              <textarea
                className="form-input"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="פרטים נוספים על התשלום..."
              />
            </div>
          </div>

          <div className="modal-footer">
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading || numAmount <= 0 || (isEditingAllocation && creditBalance < 0)}
            >
              {loading ? 'שומר...' : 'אשר תשלום'}
            </button>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default SmartPaymentModal;
