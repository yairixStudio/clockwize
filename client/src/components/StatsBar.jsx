import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Calendar, X } from 'lucide-react';
import './StatsBar.css';

// Date inputs work with local calendar days - toISOString() is UTC and shifts the day east of Greenwich
const toDateInputValue = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// A dashboard range covers whole local calendar days: from local 00:00:00.000 of the first day to
// local 23:59:59.999 of the last. new Date('YYYY-MM-DD') would be UTC midnight (03:00 in Israel).
// The Dashboard sends these with toISOString(), i.e. as exact instants that the server uses as-is.
export const buildLocalDayRange = (startValue, endValue) => {
  const [startYear, startMonth, startDay] = String(startValue).split('-').map(Number);
  const [endYear, endMonth, endDay] = String(endValue).split('-').map(Number);
  return {
    start: new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0),
    end: new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999)
  };
};

// The month of `date` as whole local days: the 1st 00:00:00.000 to the last day 23:59:59.999
export const buildLocalMonthRange = (date) => ({
  start: new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0),
  end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
});

// Query params for /stats/dashboard: the custom range, or else the selected month, as exact
// instants of local start/end of day. month/year tell the server it is the month view.
export const buildDashboardStatsParams = ({ dateRange, selectedMonth } = {}) => {
  if (dateRange) {
    return { startDate: dateRange.start.toISOString(), endDate: dateRange.end.toISOString() };
  }
  if (selectedMonth) {
    const { start, end } = buildLocalMonthRange(selectedMonth);
    return {
      month: selectedMonth.getMonth(),
      year: selectedMonth.getFullYear(),
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }
  return {};
};

function StatsBar({ stats, selectedMonth, onMonthChange, dateRange, onDateRangeChange }) {
  const navigate = useNavigate();
  const [showDateModal, setShowDateModal] = useState(false);
  const [tempStartDate, setTempStartDate] = useState('');
  const [tempEndDate, setTempEndDate] = useState('');

  const handleClick = (path) => {
    if (path) {
      navigate(path);
    }
  };

  const handlePrevMonth = () => {
    if (onMonthChange && !dateRange) {
      const newDate = new Date(selectedMonth);
      newDate.setDate(1);
      newDate.setMonth(newDate.getMonth() - 1);
      onMonthChange(newDate);
    }
  };

  const handleNextMonth = () => {
    if (onMonthChange && !dateRange) {
      const newDate = new Date(selectedMonth);
      newDate.setDate(1);
      newDate.setMonth(newDate.getMonth() + 1);
      // Don't allow going to future months
      if (newDate <= new Date()) {
        onMonthChange(newDate);
      }
    }
  };

  const handleOpenDateModal = () => {
    // Pre-fill with current values
    if (dateRange) {
      setTempStartDate(toDateInputValue(dateRange.start));
      setTempEndDate(toDateInputValue(dateRange.end));
    } else if (selectedMonth) {
      // Default to start and end of current month
      const start = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
      const end = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);
      setTempStartDate(toDateInputValue(start));
      setTempEndDate(toDateInputValue(end));
    }
    setShowDateModal(true);
  };

  const handleApplyDateRange = () => {
    if (tempStartDate && tempEndDate) {
      const { start, end } = buildLocalDayRange(tempStartDate, tempEndDate);
      
      if (start <= end) {
        onDateRangeChange?.({ start, end });
        setShowDateModal(false);
      }
    }
  };

  const handleResetToMonth = () => {
    onDateRangeChange?.(null);
    onMonthChange?.(new Date());
    setShowDateModal(false);
  };

  const isCurrentMonth = selectedMonth && !dateRange &&
    selectedMonth.getMonth() === new Date().getMonth() && 
    selectedMonth.getFullYear() === new Date().getFullYear();

  const formatMonthYear = (date) => {
    if (!date) return '';
    const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  const formatDateRange = (range) => {
    if (!range) return '';
    const formatDate = (d) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
    return `${formatDate(range.start)} - ${formatDate(range.end)}`;
  };

  const getDisplayText = () => {
    if (dateRange) {
      return formatDateRange(dateRange);
    }
    return formatMonthYear(selectedMonth);
  };

  return (
    <div className="stats-bar-wrapper">
      {/* Date Picker */}
      {selectedMonth && onMonthChange && (
        <div className="stats-date-picker">
          <button 
            className="date-picker-arrow"
            onClick={handlePrevMonth}
            disabled={dateRange}
            title="חודש קודם"
          >
            <ChevronRight size={20} />
          </button>
          
          <button 
            className={`date-picker-current ${isCurrentMonth ? 'is-current' : ''} ${dateRange ? 'has-range' : ''}`}
            onClick={handleOpenDateModal}
            title="בחר טווח תאריכים"
          >
            <Calendar size={16} />
            <span>{getDisplayText()}</span>
          </button>
          
          <button 
            className="date-picker-arrow"
            onClick={handleNextMonth}
            disabled={isCurrentMonth || dateRange}
            title="חודש הבא"
          >
            <ChevronLeft size={20} />
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="stats-bar">
        {stats.map((stat, index) => (
          <div 
            key={index} 
            className={`stat-item ${stat.path ? 'clickable' : ''}`}
            onClick={() => handleClick(stat.path)}
            role={stat.path ? 'button' : undefined}
            tabIndex={stat.path ? 0 : undefined}
          >
            <div className="stat-icon">{stat.icon}</div>
            <div className="stat-content">
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Date Range Modal */}
      {showDateModal && createPortal(
        <div className="modal-overlay" onClick={() => setShowDateModal(false)}>
          <div className="modal date-range-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">בחירת טווח תאריכים</h3>
              <button onClick={() => setShowDateModal(false)} className="btn btn-ghost btn-icon">
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="date-range-form">
                <div className="form-group">
                  <label className="form-label">תאריך התחלה</label>
                  <input 
                    type="date" 
                    className="form-input ltr"
                    value={tempStartDate}
                    onChange={e => setTempStartDate(e.target.value)}
                    max={toDateInputValue(new Date())}
                  />
                </div>
                
                <div className="form-group">
                  <label className="form-label">תאריך סיום</label>
                  <input 
                    type="date" 
                    className="form-input ltr"
                    value={tempEndDate}
                    onChange={e => setTempEndDate(e.target.value)}
                    max={toDateInputValue(new Date())}
                    min={tempStartDate}
                  />
                </div>

                <div className="date-range-presets">
                  <span className="presets-label">קיצורים:</span>
                  <button 
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const today = new Date();
                      const start = new Date(today.getFullYear(), today.getMonth(), 1);
                      setTempStartDate(toDateInputValue(start));
                      setTempEndDate(toDateInputValue(today));
                    }}
                  >
                    החודש
                  </button>
                  <button 
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const today = new Date();
                      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                      const end = new Date(today.getFullYear(), today.getMonth(), 0);
                      setTempStartDate(toDateInputValue(start));
                      setTempEndDate(toDateInputValue(end));
                    }}
                  >
                    חודש קודם
                  </button>
                  <button 
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const today = new Date();
                      const start = new Date(today);
                      start.setDate(today.getDate() - 7);
                      setTempStartDate(toDateInputValue(start));
                      setTempEndDate(toDateInputValue(today));
                    }}
                  >
                    שבוע אחרון
                  </button>
                  <button 
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const today = new Date();
                      const start = new Date(today.getFullYear(), 0, 1);
                      setTempStartDate(toDateInputValue(start));
                      setTempEndDate(toDateInputValue(today));
                    }}
                  >
                    השנה
                  </button>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={handleApplyDateRange} 
                className="btn btn-primary"
                disabled={!tempStartDate || !tempEndDate}
              >
                החל טווח
              </button>
              <button 
                onClick={handleResetToMonth} 
                className="btn btn-secondary"
              >
                חזור לחודשי
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default StatsBar;
