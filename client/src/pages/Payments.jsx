import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { 
  DollarSign, Calendar, Folder, Search, CreditCard, Plus, 
  TrendingUp, TrendingDown, RefreshCw, AlertCircle, Check,
  Filter, ChevronDown, Users, Clock, Edit2, Trash2
} from 'lucide-react';
import { paymentsAPI, expensesAPI, recurringAPI, clientsAPI, projectsAPI } from '../services/api';
import { formatCurrency, formatDate } from '../utils/format';
import { useModal } from '../components/Modal';
import PaymentModal from '../components/PaymentModal';
import './Payments.css';

const TABS = [
  { id: 'pending', label: 'ממתינים', icon: Clock },
  { id: 'all', label: 'כל התשלומים', icon: CreditCard },
  { id: 'recurring', label: 'מתחדשים', icon: RefreshCw },
  { id: 'expenses', label: 'הוצאות', icon: TrendingDown }
];

const PAYMENT_STATUSES = {
  draft: { label: 'טיוטה', color: 'gray' },
  sent: { label: 'נשלח', color: 'blue' },
  pending: { label: 'ממתין', color: 'yellow' },
  paid: { label: 'שולם', color: 'green' },
  cancelled: { label: 'בוטל', color: 'red' },
  overdue: { label: 'באיחור', color: 'darkred' }
};

function Payments() {
  const modal = useModal();
  const [activeTab, setActiveTab] = useState('all');
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  
  // Filters
  const [clientFilter, setClientFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [paymentsData, expensesData, recurringData, clientsData, projectsData] = await Promise.all([
        paymentsAPI.getAll(),
        expensesAPI.getAll().catch(() => []),
        recurringAPI.getAll().catch(() => []),
        clientsAPI.getAll(),
        projectsAPI.getAll()
      ]);
      setPayments(paymentsData);
      setExpenses(expensesData);
      setRecurring(recurringData);
      setClients(clientsData);
      setProjects(projectsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter payments based on active tab and filters
  const filteredData = useMemo(() => {
    let data = [];
    
    if (activeTab === 'expenses') {
      data = expenses;
    } else if (activeTab === 'recurring') {
      data = recurring;
    } else if (activeTab === 'pending') {
      data = payments.filter(p => p.status === 'pending' || p.status === 'sent' || p.status === 'draft');
    } else {
      data = payments;
    }

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      data = data.filter(item => 
        item.project_name?.toLowerCase().includes(term) ||
        item.client_name?.toLowerCase().includes(term) ||
        item.notes?.toLowerCase().includes(term)
      );
    }

    // Apply client filter
    if (clientFilter) {
      data = data.filter(item => {
        const project = projects.find(p => p.id === item.project_id);
        return project?.client_id === clientFilter;
      });
    }

    // Apply project filter
    if (projectFilter) {
      data = data.filter(item => item.project_id === projectFilter);
    }

    // Apply status filter
    if (statusFilter && activeTab !== 'recurring') {
      data = data.filter(item => item.status === statusFilter);
    }

    // Apply date range filter
    if (dateRange.start) {
      data = data.filter(item => new Date(item.date) >= new Date(dateRange.start));
    }
    if (dateRange.end) {
      data = data.filter(item => new Date(item.date) <= new Date(dateRange.end));
    }

    return data;
  }, [activeTab, payments, expenses, recurring, searchTerm, clientFilter, projectFilter, statusFilter, dateRange, projects]);

  // Calculate totals
  const totals = useMemo(() => {
    const income = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);
    const pending = payments.filter(p => p.status === 'pending' || p.status === 'sent').reduce((sum, p) => sum + p.amount, 0);
    const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
    const recurringTotal = recurring.filter(r => r.is_active).reduce((sum, r) => sum + r.amount, 0);
    
    return { income, pending, expenses: expenseTotal, recurring: recurringTotal, net: income - expenseTotal };
  }, [payments, expenses, recurring]);

  const handleSavePayment = async (paymentData) => {
    try {
      if (editingPayment) {
        await paymentsAPI.update(editingPayment.id, paymentData);
        modal.success('התשלום עודכן בהצלחה');
      } else {
        await paymentsAPI.create(paymentData);
        modal.success('התשלום נוסף בהצלחה');
      }
      loadData();
      setShowPaymentModal(false);
      setEditingPayment(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeletePayment = async (payment) => {
    if (!confirm('האם למחוק את התשלום?')) return;
    
    try {
      if (activeTab === 'expenses') {
        await expensesAPI.delete(payment.id);
      } else {
        await paymentsAPI.delete(payment.id);
      }
      modal.success('התשלום נמחק');
      loadData();
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleToggleRecurring = async (item) => {
    try {
      await recurringAPI.toggle(item.id);
      loadData();
      modal.success(item.is_active ? 'התשלום הושהה' : 'התשלום הופעל');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleUpdateStatus = async (payment, newStatus) => {
    try {
      await paymentsAPI.update(payment.id, { ...payment, status: newStatus });
      loadData();
      modal.success('הסטטוס עודכן');
    } catch (error) {
      modal.error(error.message);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="page fade-in payments-page">
      {/* Dashboard Summary */}
      <div className="payments-dashboard">
        <div className="dashboard-card income">
          <div className="dashboard-card-icon">
            <TrendingUp size={24} />
          </div>
          <div className="dashboard-card-content">
            <span className="dashboard-card-label">הכנסות</span>
            <span className="dashboard-card-value">{formatCurrency(totals.income)}</span>
          </div>
        </div>
        
        <div className="dashboard-card pending">
          <div className="dashboard-card-icon">
            <Clock size={24} />
          </div>
          <div className="dashboard-card-content">
            <span className="dashboard-card-label">ממתינים</span>
            <span className="dashboard-card-value">{formatCurrency(totals.pending)}</span>
          </div>
        </div>
        
        <div className="dashboard-card expenses">
          <div className="dashboard-card-icon">
            <TrendingDown size={24} />
          </div>
          <div className="dashboard-card-content">
            <span className="dashboard-card-label">הוצאות</span>
            <span className="dashboard-card-value">{formatCurrency(totals.expenses)}</span>
          </div>
        </div>
        
        <div className="dashboard-card net">
          <div className="dashboard-card-icon">
            <DollarSign size={24} />
          </div>
          <div className="dashboard-card-content">
            <span className="dashboard-card-label">רווח נקי</span>
            <span className="dashboard-card-value">{formatCurrency(totals.net)}</span>
          </div>
        </div>
      </div>

      {/* Header with Tabs */}
      <div className="page-header payments-header">
        <div className="payments-tabs">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const count = tab.id === 'pending' 
              ? payments.filter(p => ['pending', 'sent', 'draft'].includes(p.status)).length
              : tab.id === 'recurring' 
                ? recurring.length 
                : tab.id === 'expenses' 
                  ? expenses.length 
                  : payments.length;
            
            return (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
                {count > 0 && <span className="tab-count">{count}</span>}
              </button>
            );
          })}
        </div>
        
        <button 
          className="btn btn-primary"
          onClick={() => { setEditingPayment(null); setShowPaymentModal(true); }}
        >
          <Plus size={16} />
          <span>הוסף {activeTab === 'expenses' ? 'הוצאה' : 'תשלום'}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="payments-filters">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            className="form-input search-input"
            placeholder="חיפוש..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <select
          className="form-input filter-select"
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
        >
          <option value="">כל הלקוחות</option>
          {clients.map(client => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>

        <select
          className="form-input filter-select"
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
        >
          <option value="">כל הפרויקטים</option>
          {projects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>

        {activeTab !== 'recurring' && (
          <select
            className="form-input filter-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">כל הסטטוסים</option>
            {Object.entries(PAYMENT_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        )}

        <input
          type="date"
          className="form-input date-input"
          value={dateRange.start}
          onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
          placeholder="מתאריך"
        />
        <input
          type="date"
          className="form-input date-input"
          value={dateRange.end}
          onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
          placeholder="עד תאריך"
        />
      </div>

      {/* Content */}
      <div className="payments-content card">
        {filteredData.length === 0 ? (
          <div className="empty-state">
            <CreditCard size={48} strokeWidth={1.5} />
            <p>לא נמצאו {activeTab === 'expenses' ? 'הוצאות' : activeTab === 'recurring' ? 'תשלומים מתחדשים' : 'תשלומים'}</p>
          </div>
        ) : activeTab === 'recurring' ? (
          // Recurring payments view
          <div className="recurring-list">
            {filteredData.map(item => (
              <div key={item.id} className={`recurring-item ${item.is_active ? 'active' : 'inactive'}`}>
                <div className="recurring-info">
                  <div className="recurring-header">
                    <span className="recurring-amount">{formatCurrency(item.amount)}</span>
                    <span className="recurring-interval">/ חודש</span>
                  </div>
                  <div className="recurring-meta">
                    {item.client_name && (
                      <span className="meta-item">
                        <Users size={12} />
                        {item.client_name}
                      </span>
                    )}
                    {item.project_name && (
                      <span className="meta-item">
                        <Folder size={12} />
                        {item.project_name}
                      </span>
                    )}
                    <span className="meta-item">
                      <Calendar size={12} />
                      יום {item.day_of_month} בחודש
                    </span>
                  </div>
                  {item.notes && <p className="recurring-notes">{item.notes}</p>}
                </div>
                <div className="recurring-actions">
                  <button
                    className={`btn btn-sm ${item.is_active ? 'btn-warning' : 'btn-success'}`}
                    onClick={() => handleToggleRecurring(item)}
                  >
                    {item.is_active ? 'השהה' : 'הפעל'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Regular payments/expenses table
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>פרויקט</th>
                  <th>לקוח</th>
                  <th>תאריך</th>
                  <th>סכום</th>
                  <th>סטטוס</th>
                  <th>הערות</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(payment => {
                  const project = projects.find(p => p.id === payment.project_id);
                  const client = project ? clients.find(c => c.id === project.client_id) : null;
                  const statusInfo = PAYMENT_STATUSES[payment.status] || PAYMENT_STATUSES.paid;
                  
                  return (
                    <tr key={payment.id}>
                      <td>
                        {payment.project_id ? (
                          <Link to={`/projects/${payment.project_id}`} className="payment-project">
                            <Folder size={14} />
                            {payment.project_name || project?.name || '-'}
                          </Link>
                        ) : '-'}
                      </td>
                      <td>
                        {client ? (
                          <Link to={`/clients/${client.id}`} className="payment-client">
                            <Users size={14} />
                            {payment.client_name || client.name}
                          </Link>
                        ) : '-'}
                      </td>
                      <td>
                        <div className="payment-date">
                          <Calendar size={14} />
                          {formatDate(payment.date)}
                        </div>
                      </td>
                      <td className={`font-medium ${activeTab === 'expenses' ? 'text-error' : 'text-success'}`}>
                        {activeTab === 'expenses' ? '-' : ''}{formatCurrency(payment.amount)}
                      </td>
                      <td>
                        <select
                          className={`status-select status-${statusInfo.color}`}
                          value={payment.status || 'paid'}
                          onChange={e => handleUpdateStatus(payment, e.target.value)}
                        >
                          {Object.entries(PAYMENT_STATUSES).map(([value, { label }]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="payment-notes">
                        {payment.notes || '-'}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="btn-icon-tiny"
                            onClick={() => { setEditingPayment(payment); setShowPaymentModal(true); }}
                            title="ערוך"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            className="btn-icon-tiny text-error"
                            onClick={() => handleDeletePayment(payment)}
                            title="מחק"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPaymentModal && (
        <PaymentModal
          payment={editingPayment}
          projects={projects}
          onSave={handleSavePayment}
          onClose={() => { setShowPaymentModal(false); setEditingPayment(null); }}
        />
      )}
    </div>
  );
}

export default Payments;
