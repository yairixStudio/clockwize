import { useState, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { Package, X } from 'lucide-react';
import './CatalogModal.css';

function CatalogModal({ item, categories = [], onSave, onClose }) {
  const uid = useId();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    pricing_type: 'fixed',
    unit: '',
    category: '',
    notes: '',
    is_active: true
  });
  const [newCategory, setNewCategory] = useState('');
  const [useNewCategory, setUseNewCategory] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        description: item.description || '',
        price: item.price ?? '',
        pricing_type: item.pricing_type || 'fixed',
        unit: item.unit || '',
        category: item.category || '',
        notes: item.notes || '',
        is_active: item.is_active !== 0
      });
    } else {
      setFormData({
        name: '',
        description: '',
        price: '',
        pricing_type: 'fixed',
        unit: '',
        category: '',
        notes: '',
        is_active: true
      });
    }
    setNewCategory('');
    setUseNewCategory(false);
  }, [item]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...formData,
        // 0 is a real price (a free item); only an empty field means "no price"
        price: formData.price !== '' && formData.price != null ? parseFloat(formData.price) : null,
        category: useNewCategory ? newCategory : formData.category
      };
      await onSave(data);
    } catch (error) {
      console.error('Error saving catalog item:', error);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal catalog-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">
            <Package size={20} />
            {item ? 'עריכת פריט' : 'הוספת פריט חדש'}
          </h3>
          <button onClick={onClose} className="btn btn-ghost btn-icon" type="button">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label" htmlFor={`${uid}-name`}>שם הפריט *</label>
              <input
                id={`${uid}-name`}
                type="text"
                className="form-input"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="למשל: צילום סטילס, עיצוב לוגו, ייעוץ שעתי..."
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor={`${uid}-description`}>תיאור</label>
              <textarea
                id={`${uid}-description`}
                className="form-input"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="תיאור קצר של המוצר או השירות..."
                rows={2}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-price`}>מחיר (₪)</label>
                <input
                  id={`${uid}-price`}
                  type="number"
                  className="form-input"
                  value={formData.price}
                  onChange={e => setFormData({ ...formData, price: e.target.value })}
                  placeholder="0"
                  min="0"
                  step="0.01"
                  dir="ltr"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor={`${uid}-pricing-type`}>סוג תמחור</label>
                <select
                  id={`${uid}-pricing-type`}
                  className="form-input"
                  value={formData.pricing_type}
                  onChange={e => setFormData({ ...formData, pricing_type: e.target.value })}
                >
                  <option value="fixed">מחיר קבוע</option>
                  <option value="hourly">לשעה</option>
                  <option value="daily">ליום</option>
                  <option value="monthly">לחודש</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor={`${uid}-unit`}>יחידת מידה (אופציונלי)</label>
              <input
                id={`${uid}-unit`}
                type="text"
                className="form-input"
                value={formData.unit}
                onChange={e => setFormData({ ...formData, unit: e.target.value })}
                placeholder="למשל: לתמונה, לפרויקט, לעמוד..."
              />
              <span className="form-hint">אם שונה מסוג התמחור, למשל: "לתמונה" במקום "מחיר קבוע"</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor={`${uid}-category`}>קטגוריה</label>
              {!useNewCategory ? (
                <div className="category-select-wrapper">
                  <select
                    id={`${uid}-category`}
                    className="form-input"
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                  >
                    <option value="">ללא קטגוריה</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <button 
                    type="button" 
                    className="btn btn-ghost btn-sm"
                    onClick={() => setUseNewCategory(true)}
                  >
                    + קטגוריה חדשה
                  </button>
                </div>
              ) : (
                <div className="category-select-wrapper">
                  <input
                    id={`${uid}-category`}
                    type="text"
                    className="form-input"
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    placeholder="שם הקטגוריה החדשה..."
                    autoFocus
                  />
                  <button 
                    type="button" 
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setUseNewCategory(false); setNewCategory(''); }}
                  >
                    ביטול
                  </button>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor={`${uid}-notes`}>הערות פנימיות</label>
              <textarea
                id={`${uid}-notes`}
                className="form-input notes-input"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                placeholder="הערות לשימוש פנימי..."
                rows={2}
              />
            </div>

            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                />
                <span>פריט פעיל</span>
              </label>
              <span className="form-hint">פריטים לא פעילים לא יופיעו בבחירת מוצרים לפרויקטים</span>
            </div>
          </div>

          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'שומר...' : (item ? 'עדכן פריט' : 'הוסף פריט')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default CatalogModal;
