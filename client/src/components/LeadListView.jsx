import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, MoreHorizontal, ArrowRightLeft, Trash2, Edit, UserCheck, Building2 } from 'lucide-react';
import LeadStatusBadge from './LeadStatusBadge';
import LeadPriorityBadge from './LeadPriorityBadge';
import { getSourceType } from '../utils/leadStatus';
import './LeadListView.css';

function LeadListView({ leads, onStatusChange, onEdit, onDelete }) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [activeMenu, setActiveMenu] = useState(null);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sorted = [...leads].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    if (aVal == null) aVal = '';
    if (bVal == null) bVal = '';
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const formatCurrency = (val) => {
    if (!val) return '-';
    return `₪${Number(val).toLocaleString('he-IL')}`;
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('he-IL');
  };

  if (leads.length === 0) {
    return (
      <div className="lead-list-empty">
        <p>אין לידים להצגה</p>
      </div>
    );
  }

  return (
    <div className="lead-list-table-wrapper">
      <table className="lead-list-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('name')} className="sortable">
              שם / חברה <SortIcon field="name" />
            </th>
            <th onClick={() => handleSort('priority')} className="sortable">
              עדיפות <SortIcon field="priority" />
            </th>
            <th onClick={() => handleSort('status')} className="sortable">
              סטטוס <SortIcon field="status" />
            </th>
            <th onClick={() => handleSort('source_type')} className="sortable">
              מקור <SortIcon field="source_type" />
            </th>
            <th onClick={() => handleSort('expected_value')} className="sortable">
              ערך צפוי <SortIcon field="expected_value" />
            </th>
            <th onClick={() => handleSort('expected_close_date')} className="sortable">
              סגירה צפויה <SortIcon field="expected_close_date" />
            </th>
            <th>אחראי</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(lead => (
            <tr
              key={lead.id}
              className="lead-list-row"
              onClick={() => navigate(`/leads/${lead.id}`)}
            >
              <td className="lead-list-name-cell">
                <div className="lead-list-name">
                  {lead.is_opportunity && <Building2 size={14} className="lead-opportunity-icon" />}
                  {lead.name}
                </div>
                {lead.is_opportunity && lead.opportunity_client_name ? (
                  <div className="lead-list-company">
                    <Link
                      to={`/clients/${lead.client_id}`}
                      className="clickable-name"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {lead.opportunity_client_name}
                    </Link>
                  </div>
                ) : lead.company ? (
                  <div className="lead-list-company">{lead.company}</div>
                ) : null}
              </td>
              <td>
                <LeadPriorityBadge priority={lead.priority} size="sm" />
              </td>
              <td>
                <LeadStatusBadge status={lead.status} size="sm" />
              </td>
              <td className="lead-list-source">
                {getSourceType(lead.source_type).label}
                {lead.source_detail && <span className="lead-source-detail"> ({lead.source_detail})</span>}
              </td>
              <td className="lead-list-value">
                {formatCurrency(lead.expected_value)}
              </td>
              <td className="lead-list-date">
                {formatDate(lead.expected_close_date)}
              </td>
              <td className="lead-list-assigned">
                {lead.assigned_to_name || '-'}
              </td>
              <td className="lead-list-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => setActiveMenu(activeMenu === lead.id ? null : lead.id)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {activeMenu === lead.id && (
                  <div className="lead-list-menu" onMouseLeave={() => setActiveMenu(null)}>
                    <button onClick={() => { onEdit?.(lead); setActiveMenu(null); }}>
                      <Edit size={14} /> ערוך
                    </button>
                    {lead.status !== 'won' && lead.status !== 'lost' && (
                      <button onClick={() => { onStatusChange?.(lead.id, 'won'); setActiveMenu(null); }}>
                        <ArrowRightLeft size={14} /> סמן כנסגר
                      </button>
                    )}
                    <button className="danger" onClick={() => { onDelete?.(lead); setActiveMenu(null); }}>
                      <Trash2 size={14} /> מחק
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default LeadListView;
