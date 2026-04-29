import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Mail, Edit2, Trash2, RefreshCw, Archive, ArchiveRestore, Folder } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import useStore from '../store/useStore';
import { useModal } from './Modal';
import RemindersModal from './RemindersModal';
import '../pages/Reminders.css';

const ReminderItem = ({ reminder, onUpdate }) => {
  const { deleteReminder, updateReminder } = useStore();
  const modal = useModal();
  const [showEditModal, setShowEditModal] = useState(false);

  const getReminderStatus = (reminder) => {
    if (reminder.is_read) return 'completed';
    if (!reminder.due_date) return 'no-date';
    
    const now = new Date();
    const dueDate = new Date(reminder.due_date);
    const diffHours = (dueDate - now) / (1000 * 60 * 60);
    
    if (diffHours < 0) return 'overdue';
    if (diffHours < 24) return 'urgent';
    if (diffHours < 72) return 'soon';
    return 'future';
  };

  const getFullPath = (reminder) => {
    const parts = [];
    
    if (reminder.association_type === 'lead' && reminder.lead_name) {
      parts.push(`ליד: ${reminder.lead_name}`);
    } else if (reminder.association_type === 'client' && reminder.client_name) {
      parts.push(reminder.client_name);
    } else if (reminder.association_type === 'project') {
      if (reminder.project_client_name) parts.push(reminder.project_client_name);
      if (reminder.project_name) parts.push(reminder.project_name);
    } else if (reminder.association_type === 'task') {
      if (reminder.task_client_name) parts.push(reminder.task_client_name);
      if (reminder.task_project_name) parts.push(reminder.task_project_name);
      if (reminder.task_name) parts.push(reminder.task_name);
    }
    
    return parts.length > 0 ? parts.join(' / ') : null;
  };

  const renderPathLinks = (reminder) => {
    const links = [];

    if (reminder.association_type === 'lead' && reminder.lead_name) {
      links.push(
        <Link key="lead" to={`/leads/${reminder.association_id}`} className="clickable-name">
          ליד: {reminder.lead_name}
        </Link>
      );
    } else if (reminder.association_type === 'client' && reminder.client_name) {
      const clientId = reminder.client_id || reminder.association_id;
      if (clientId) {
        links.push(
          <Link key="client" to={`/clients/${clientId}`} className="clickable-name">
            {reminder.client_name}
          </Link>
        );
      } else {
        links.push(<span key="client">{reminder.client_name}</span>);
      }
    } else if (reminder.association_type === 'project') {
      if (reminder.project_client_name) {
        const clientId = reminder.project_client_id || reminder.client_id;
        if (clientId) {
          links.push(
            <Link key="client" to={`/clients/${clientId}`} className="clickable-name">
              {reminder.project_client_name}
            </Link>
          );
        } else {
          links.push(<span key="client">{reminder.project_client_name}</span>);
        }
      }
      if (reminder.project_name) {
        links.push(
          <Link key="project" to={`/projects/${reminder.association_id}`} className="clickable-name">
            {reminder.project_name}
          </Link>
        );
      }
    } else if (reminder.association_type === 'task') {
      if (reminder.task_client_name) {
        const clientId = reminder.task_client_id || reminder.client_id;
        if (clientId) {
          links.push(
            <Link key="client" to={`/clients/${clientId}`} className="clickable-name">
              {reminder.task_client_name}
            </Link>
          );
        } else {
          links.push(<span key="client">{reminder.task_client_name}</span>);
        }
      }
      if (reminder.task_project_name) {
        const projectId = reminder.task_project_id || reminder.project_id;
        if (projectId) {
          links.push(
            <Link key="project" to={`/projects/${projectId}`} className="clickable-name">
              {reminder.task_project_name}
            </Link>
          );
        } else {
          links.push(<span key="project">{reminder.task_project_name}</span>);
        }
      }
      if (reminder.task_name) {
        links.push(
          <Link key="task" to={`/tasks/${reminder.association_id}`} className="clickable-name">
            {reminder.task_name}
          </Link>
        );
      }
    }
    
    if (links.length === 0) return null;
    
    return links.reduce((acc, link, idx) => {
      if (idx === 0) return [link];
      return [...acc, <span key={`sep-${idx}`}> / </span>, link];
    }, []);
  };

  const handleToggleRead = async () => {
    try {
      await updateReminder(reminder.id, { is_read: !reminder.is_read });
      if (onUpdate) onUpdate();
    } catch (error) {
      modal.error('שגיאה בעדכון התזכורת');
    }
  };

  const handleToggleArchive = async () => {
    try {
      await updateReminder(reminder.id, { is_archived: !reminder.is_archived });
      if (onUpdate) onUpdate();
    } catch (error) {
      modal.error('שגיאה בעדכון התזכורת');
    }
  };

  const handleEdit = () => {
    setShowEditModal(true);
  };

  const handleDelete = async () => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק תזכורת זו?',
      { title: 'מחיקת תזכורת', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await deleteReminder(reminder.id);
        if (onUpdate) onUpdate();
        modal.success('התזכורת נמחקה בהצלחה');
      } catch (error) {
        modal.error('שגיאה במחיקת התזכורת');
      }
    }
  };

  const handleModalClose = () => {
    setShowEditModal(false);
    if (onUpdate) onUpdate();
  };

  const status = getReminderStatus(reminder);

  return (
    <>
      <div className={`reminder-item ${reminder.is_read ? 'read' : ''} ${reminder.is_archived ? 'archived' : ''} status-${status}`}>
        <div className="reminder-status-indicator">
          <div className={`status-dot ${status}`}></div>
        </div>
        
        <div className="reminder-main">
          <div className="reminder-content-text">
            {reminder.content}
          </div>

          <div className="reminder-meta-row">
            {reminder.due_date && (
              <span className="reminder-date">
                {format(new Date(reminder.due_date), 'dd/MM/yyyy HH:mm', { locale: he })}
              </span>
            )}
            {getFullPath(reminder) && (
              <span className="path-text">
                {renderPathLinks(reminder)}
              </span>
            )}
            {!!reminder.is_recurring && (
              <span className="recurring-indicator" title={`חוזר: ${reminder.recurrence_interval}`}>
                <RefreshCw size={14} />
              </span>
            )}
          </div>

          {/* Project associations tags */}
          {reminder.project_associations && reminder.project_associations.length > 0 && (
            <div className="reminder-projects-row">
              {reminder.project_associations.map(assoc => (
                <Link
                  key={assoc.project_id}
                  to={`/projects/${assoc.project_id}`}
                  className="reminder-project-tag"
                  title={assoc.client_name ? `${assoc.client_name} / ${assoc.project_name}` : assoc.project_name}
                >
                  <Folder size={12} />
                  {assoc.project_name}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="reminder-actions">
          <button 
            className={`btn-icon ${reminder.is_read ? 'active' : ''}`}
            onClick={handleToggleRead}
            title={reminder.is_read ? 'סמן כלא טופל' : 'סמן כטופל'}
          >
            {reminder.is_read ? <Mail size={16} /> : <CheckCircle size={16} />}
          </button>
          <button 
            className={`btn-icon ${reminder.is_archived ? 'active' : ''}`}
            onClick={handleToggleArchive}
            title={reminder.is_archived ? 'הוצא מארכיון' : 'העבר לארכיון'}
          >
            {reminder.is_archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
          <button className="btn-icon" onClick={handleEdit} title="ערוך">
            <Edit2 size={16} />
          </button>
          <button className="btn-icon delete" onClick={handleDelete} title="מחק">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {showEditModal && (
        <RemindersModal 
          isOpen={showEditModal} 
          onClose={handleModalClose} 
          reminder={reminder}
        />
      )}
    </>
  );
};

export default ReminderItem;

