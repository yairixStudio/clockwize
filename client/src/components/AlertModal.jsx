import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import useBodyScrollLock from '../hooks/useBodyScrollLock';

function AlertModal({ alert, projectId, onSave, onClose }) {
  useBodyScrollLock(true);
  const formRef = useRef(null);
  const [formData, setFormData] = useState({
    alert_type: '',
    threshold_value: '',
    threshold_days: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (alert) {
      setFormData({
        alert_type: alert.alert_type || '',
        threshold_value: alert.threshold_value || '',
        threshold_days: alert.threshold_days || '',
        message: alert.message || ''
      });
    }
  }, [alert]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const form = formRef.current;
    const data = {
      alert_type: form.alert_type.value,
      threshold_value: form.threshold_value ? parseFloat(form.threshold_value.value) || null : null,
      threshold_days: form.threshold_days ? parseInt(form.threshold_days.value) || null : null,
      message: form.message.value || null
    };

    if (!alert) {
      data.project_id = projectId;
    }

    try {
      await onSave(data);
    } finally {
      setLoading(false);
    }
  };

  const showThresholdValue = ['hours', 'budget', 'payment'].includes(formData.alert_type);
  const showThresholdDays = formData.alert_type === 'deadline';

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{alert ? 'עריכת התראה' : 'התראה חדשה'}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon">
            <X size={20} />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">סוג התראה *</label>
              <select
                name="alert_type"
                className="form-input"
                value={formData.alert_type}
                onChange={handleChange}
                required
              >
                <option value="">בחר סוג התראה...</option>
                <option value="hours">שעות עבודה (כשהשעות עוברות סף)</option>
                <option value="budget">תקציב (כשהסכום לחיוב עובר סף)</option>
                <option value="payment">תשלומים (כשסך התשלומים עובר סף)</option>
                <option value="deadline">דדליין (ימים לפני תאריך יעד)</option>
              </select>
            </div>

            {showThresholdValue && (
              <div className="form-group">
                <label className="form-label">
                  {formData.alert_type === 'hours' ? 'סף שעות' : 'סף סכום (₪)'}
                </label>
                <input
                  type="number"
                  name="threshold_value"
                  className="form-input"
                  value={formData.threshold_value}
                  onChange={handleChange}
                  placeholder={formData.alert_type === 'hours' ? 'מספר שעות' : 'סכום ב-₪'}
                  min="0"
                  step={formData.alert_type === 'hours' ? '0.5' : '1'}
                  dir="ltr"
                  required
                />
              </div>
            )}

            {showThresholdDays && (
              <div className="form-group">
                <label className="form-label">מספר ימים לפני הדדליין</label>
                <input
                  type="number"
                  name="threshold_days"
                  className="form-input"
                  value={formData.threshold_days}
                  onChange={handleChange}
                  placeholder="מספר ימים"
                  min="1"
                  dir="ltr"
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">הערה / פעולה נדרשת</label>
              <textarea
                name="message"
                className="form-input"
                value={formData.message}
                onChange={handleChange}
                rows={3}
                placeholder="למשל: להתקשר ללקוח, לשלוח חשבונית, לעדכן על חריגה..."
              />
              <small className="form-hint">תיאור חופשי של מה לעשות כשההתראה נדלקת</small>
            </div>
          </div>

          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'שומר...' : 'שמור'}
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

export default AlertModal;
