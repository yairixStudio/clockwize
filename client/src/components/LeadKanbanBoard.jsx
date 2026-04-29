import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flame, Sun, Snowflake, Trophy, XCircle, Building2 } from 'lucide-react';
import { PIPELINE_STAGES, getLeadPriority } from '../utils/leadStatus';
import './LeadKanbanBoard.css';

const PRIORITY_ICONS = { hot: Flame, warm: Sun, cold: Snowflake };

function LeadKanbanBoard({ pipeline, onStatusChange }) {
  const navigate = useNavigate();
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);

  const handleDragStart = (e, leadId) => {
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(leadId);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverColumn(null);
  };

  const handleDragOver = (e, status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e, status) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    if (leadId) {
      onStatusChange?.(leadId, status);
    }
    setDragOverColumn(null);
    setDraggingId(null);
  };

  const formatCurrency = (val) => {
    if (!val) return '';
    return `₪${Number(val).toLocaleString('he-IL')}`;
  };

  const wonCount = pipeline?.won?.length || 0;
  const lostCount = pipeline?.lost?.length || 0;
  const wonValue = pipeline?.won?.reduce((sum, l) => sum + (l.expected_value || 0), 0) || 0;

  return (
    <div className="lead-kanban">
      <div className="lead-kanban-columns">
        {PIPELINE_STAGES.map(stage => {
          const leads = pipeline?.[stage.value] || [];
          const columnValue = leads.reduce((sum, l) => sum + (l.expected_value || 0), 0);

          return (
            <div
              key={stage.value}
              className={`lead-kanban-column ${dragOverColumn === stage.value ? 'drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, stage.value)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.value)}
            >
              <div className="lead-kanban-column-header" style={{ borderTopColor: stage.color }}>
                <div className="lead-kanban-column-title">
                  <span className="lead-kanban-column-dot" style={{ background: stage.color }} />
                  {stage.label}
                  <span className="lead-kanban-column-count">{leads.length}</span>
                </div>
                {columnValue > 0 && (
                  <div className="lead-kanban-column-value">{formatCurrency(columnValue)}</div>
                )}
              </div>

              <div className="lead-kanban-cards">
                {leads.map(lead => {
                  const PIcon = PRIORITY_ICONS[lead.priority] || Sun;
                  const pInfo = getLeadPriority(lead.priority);

                  return (
                    <div
                      key={lead.id}
                      className={`lead-kanban-card ${draggingId === lead.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => navigate(`/leads/${lead.id}`)}
                    >
                      <div className="lead-kanban-card-header">
                        <span className="lead-kanban-card-name">{lead.name}</span>
                        <PIcon size={14} style={{ color: pInfo.color }} />
                      </div>
                      {lead.is_opportunity && lead.opportunity_client_name ? (
                        <div className="lead-kanban-card-company">
                          <Building2 size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '4px' }} />
                          {lead.opportunity_client_name}
                        </div>
                      ) : lead.company ? (
                        <div className="lead-kanban-card-company">{lead.company}</div>
                      ) : null}
                      {lead.is_opportunity && (
                        <span className="lead-kanban-card-opportunity-badge">הזדמנות</span>
                      )}
                      <div className="lead-kanban-card-footer">
                        {lead.expected_value > 0 && (
                          <span className="lead-kanban-card-value">{formatCurrency(lead.expected_value)}</span>
                        )}
                        {lead.assigned_to_name && (
                          <span className="lead-kanban-card-assigned">{lead.assigned_to_name}</span>
                        )}
                      </div>
                      {lead.expected_close_date && (
                        <div className="lead-kanban-card-date">
                          {new Date(lead.expected_close_date).toLocaleDateString('he-IL')}
                        </div>
                      )}
                    </div>
                  );
                })}

                {leads.length === 0 && (
                  <div className="lead-kanban-empty">גרור לידים לכאן</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="lead-kanban-terminal">
        <div
          className={`lead-kanban-terminal-box won ${dragOverColumn === 'won' ? 'drag-over' : ''}`}
          onDragOver={(e) => handleDragOver(e, 'won')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'won')}
        >
          <Trophy size={20} />
          <span>נסגרו ({wonCount})</span>
          {wonValue > 0 && <span className="terminal-value">{formatCurrency(wonValue)}</span>}
        </div>
        <div
          className={`lead-kanban-terminal-box lost ${dragOverColumn === 'lost' ? 'drag-over' : ''}`}
          onDragOver={(e) => handleDragOver(e, 'lost')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'lost')}
        >
          <XCircle size={20} />
          <span>אבדו ({lostCount})</span>
        </div>
      </div>
    </div>
  );
}

export default LeadKanbanBoard;
