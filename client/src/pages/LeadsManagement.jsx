import { useState, useEffect } from 'react';
import { Plus, List, Columns3, GanttChart, Target, TrendingUp, Users, Trophy } from 'lucide-react';
import { leadsAPI } from '../services/api';
import { useModal } from '../components/Modal';
import useStore from '../store/useStore';
import LeadFilterBar from '../components/LeadFilterBar';
import LeadListView from '../components/LeadListView';
import LeadKanbanBoard from '../components/LeadKanbanBoard';
import LeadTimelineView from '../components/LeadTimelineView';
import LeadModal from '../components/LeadModal';
import './LeadsManagement.css';

function LeadsManagement() {
  const modal = useModal();
  const { user } = useStore();
  const [viewMode, setViewMode] = useState('kanban');
  const [leads, setLeads] = useState([]);
  const [pipeline, setPipeline] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [filters, setFilters] = useState({
    search: '', status: '', priority: '', assigned_to: '', source_type: '', lead_type: ''
  });

  useEffect(() => {
    loadData();
    loadMembers();
  }, []);

  useEffect(() => {
    if (!loading) {
      loadLeads();
    }
  }, [filters]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadLeads(), loadPipeline(), loadStats()]);
    } finally {
      setLoading(false);
    }
  };

  const loadLeads = async () => {
    try {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.priority) params.priority = filters.priority;
      if (filters.assigned_to) params.assigned_to = filters.assigned_to;
      const data = await leadsAPI.getAll(params);
      setLeads(data);
    } catch (error) {
      console.error('Failed to load leads:', error);
    }
  };

  const loadPipeline = async () => {
    try {
      const data = await leadsAPI.getPipeline();
      setPipeline(data);
    } catch (error) {
      console.error('Failed to load pipeline:', error);
    }
  };

  const loadStats = async () => {
    try {
      const data = await leadsAPI.getStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadMembers = async () => {
    try {
      const workspaceId = localStorage.getItem('currentWorkspaceId');
      if (workspaceId) {
        const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json',
            'X-Workspace-Id': workspaceId
          }
        });
        if (res.ok) {
          const data = await res.json();
          setWorkspaceMembers(data.map(m => ({ id: m.user_id, user_id: m.user_id, name: m.user_name || m.name })));
        }
      }
    } catch (e) {
      console.error('Failed to load workspace members:', e);
    }
  };

  const handleStatusChange = async (leadId, newStatus) => {
    try {
      await leadsAPI.updateStatus(leadId, newStatus);
      loadData();
    } catch (error) {
      console.error('Failed to update status:', error);
      modal.error('שגיאה בעדכון סטטוס');
    }
  };

  const handleEdit = (lead) => {
    setEditingLead(lead);
    setShowModal(true);
  };

  const handleDelete = async (lead) => {
    if (!confirm(`למחוק את הליד "${lead.name}"?`)) return;
    try {
      await leadsAPI.delete(lead.id);
      modal.success('ליד נמחק');
      loadData();
    } catch (error) {
      console.error('Failed to delete lead:', error);
      modal.error('שגיאה במחיקת ליד');
    }
  };

  const handleSaved = () => {
    loadData();
    setEditingLead(null);
  };

  const filteredLeads = leads.filter(lead => {
    if (filters.source_type && lead.source_type !== filters.source_type) return false;
    if (filters.lead_type === 'opportunities' && !lead.is_opportunity) return false;
    if (filters.lead_type === 'new_leads' && lead.is_opportunity) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="page fade-in leads-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">ניהול לידים</h1>
            <p className="page-subtitle">טוען...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page fade-in leads-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">ניהול לידים</h1>
          <p className="page-subtitle">מעקב, ניהול והמרת לידים ללקוחות</p>
        </div>

        <div className="header-actions">
          <button
            className="btn btn-primary"
            onClick={() => { setEditingLead(null); setShowModal(true); }}
          >
            <Plus size={18} />
            <span>ליד חדש</span>
          </button>

          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="תצוגת רשימה"
            >
              <List size={18} />
              <span>רשימה</span>
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'kanban' ? 'active' : ''}`}
              onClick={() => setViewMode('kanban')}
              title="תצוגת קנבן"
            >
              <Columns3 size={18} />
              <span>קנבן</span>
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
              onClick={() => setViewMode('timeline')}
              title="ציר זמן"
            >
              <GanttChart size={18} />
              <span>ציר זמן</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="leads-stats-bar">
          <div className="leads-stat-card">
            <Target size={20} />
            <div>
              <div className="leads-stat-value">{stats.active}</div>
              <div className="leads-stat-label">לידים פעילים</div>
            </div>
          </div>
          <div className="leads-stat-card">
            <TrendingUp size={20} />
            <div>
              <div className="leads-stat-value">{stats.total}</div>
              <div className="leads-stat-label">סה״כ</div>
            </div>
          </div>
          <div className="leads-stat-card">
            <Trophy size={20} />
            <div>
              <div className="leads-stat-value">{stats.wonThisMonth}</div>
              <div className="leads-stat-label">נסגרו החודש</div>
            </div>
          </div>
          {stats.wonThisMonthValue > 0 && (
            <div className="leads-stat-card">
              <Users size={20} />
              <div>
                <div className="leads-stat-value">₪{stats.wonThisMonthValue.toLocaleString('he-IL')}</div>
                <div className="leads-stat-label">ערך החודש</div>
              </div>
            </div>
          )}
          {stats.upcomingCloses > 0 && (
            <div className="leads-stat-card warning">
              <div>
                <div className="leads-stat-value">{stats.upcomingCloses}</div>
                <div className="leads-stat-label">סגירה קרובה</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <LeadFilterBar
        filters={filters}
        onFilterChange={setFilters}
        workspaceMembers={workspaceMembers}
      />

      {/* Views */}
      {viewMode === 'list' && (
        <LeadListView
          leads={filteredLeads}
          onStatusChange={handleStatusChange}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {viewMode === 'kanban' && (
        <LeadKanbanBoard
          pipeline={pipeline}
          onStatusChange={handleStatusChange}
        />
      )}

      {viewMode === 'timeline' && (
        <LeadTimelineView leads={filteredLeads} />
      )}

      {/* Create/Edit Modal */}
      <LeadModal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingLead(null); }}
        lead={editingLead}
        onSaved={handleSaved}
        workspaceMembers={workspaceMembers}
      />
    </div>
  );
}

export default LeadsManagement;
