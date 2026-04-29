import { useState } from 'react';
import { Search, X, Filter } from 'lucide-react';
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_SOURCE_TYPES } from '../utils/leadStatus';
import './LeadFilterBar.css';

function LeadFilterBar({ filters, onFilterChange, workspaceMembers = [] }) {
  const [showFilters, setShowFilters] = useState(false);

  const handleSearchChange = (e) => {
    onFilterChange({ ...filters, search: e.target.value });
  };

  const handleStatusChange = (e) => {
    onFilterChange({ ...filters, status: e.target.value });
  };

  const handlePriorityChange = (e) => {
    onFilterChange({ ...filters, priority: e.target.value });
  };

  const handleAssignedChange = (e) => {
    onFilterChange({ ...filters, assigned_to: e.target.value });
  };

  const handleSourceTypeChange = (e) => {
    onFilterChange({ ...filters, source_type: e.target.value });
  };

  const handleLeadTypeChange = (e) => {
    onFilterChange({ ...filters, lead_type: e.target.value });
  };

  const clearFilters = () => {
    onFilterChange({ search: '', status: '', priority: '', assigned_to: '', source_type: '', lead_type: '' });
  };

  const hasActiveFilters = filters.status || filters.priority || filters.assigned_to || filters.source_type || filters.lead_type;

  return (
    <div className="lead-filter-bar">
      <div className="lead-filter-search">
        <Search size={18} />
        <input
          type="text"
          placeholder="חיפוש לידים..."
          value={filters.search || ''}
          onChange={handleSearchChange}
          className="form-input"
        />
      </div>

      <button
        className={`btn btn-ghost btn-sm lead-filter-toggle ${showFilters ? 'active' : ''}`}
        onClick={() => setShowFilters(!showFilters)}
      >
        <Filter size={16} />
        <span>סינון</span>
        {hasActiveFilters && <span className="filter-active-dot" />}
      </button>

      {hasActiveFilters && (
        <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
          <X size={14} />
          <span>נקה</span>
        </button>
      )}

      {showFilters && (
        <div className="lead-filter-dropdowns">
          <select className="form-input form-input-sm" value={filters.status || ''} onChange={handleStatusChange}>
            <option value="">כל הסטטוסים</option>
            {LEAD_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <select className="form-input form-input-sm" value={filters.priority || ''} onChange={handlePriorityChange}>
            <option value="">כל העדיפויות</option>
            {LEAD_PRIORITIES.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          {workspaceMembers.length > 0 && (
            <select className="form-input form-input-sm" value={filters.assigned_to || ''} onChange={handleAssignedChange}>
              <option value="">כל האחראים</option>
              {workspaceMembers.map(m => (
                <option key={m.id || m.user_id} value={m.id || m.user_id}>{m.name}</option>
              ))}
            </select>
          )}

          <select className="form-input form-input-sm" value={filters.lead_type || ''} onChange={handleLeadTypeChange}>
            <option value="">הכל</option>
            <option value="new_leads">לידים חדשים</option>
            <option value="opportunities">הזדמנויות</option>
          </select>

          <select className="form-input form-input-sm" value={filters.source_type || ''} onChange={handleSourceTypeChange}>
            <option value="">כל המקורות</option>
            {LEAD_SOURCE_TYPES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export default LeadFilterBar;
