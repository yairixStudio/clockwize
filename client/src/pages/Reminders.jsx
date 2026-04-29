import React, { useState, useEffect } from 'react';
import { Plus, Bell } from 'lucide-react';
import useStore from '../store/useStore';
import './Reminders.css';
import RemindersModal from '../components/RemindersModal';
import ReminderItem from '../components/ReminderItem';

const Reminders = () => {
  const { reminders, loadReminders, deleteReminder, updateReminder, user } = useStore();
  const [filter, setFilter] = useState('all'); // all, unread, upcoming, overdue, handled, archived
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);

  useEffect(() => {
    if (user) {
      loadReminders({ include_read: 'true' });
    }
  }, [user, loadReminders]);

  const handleReminderUpdate = () => {
    // Reload reminders after update/delete
    if (user) {
      loadReminders({ include_read: 'true' });
    }
  };

  const getFilteredReminders = () => {
    const now = new Date();
    const filtered = reminders.filter(r => {
      // Archive filter - show ONLY archived items
      if (filter === 'archived') return r.is_archived;
      
      // All other filters exclude archived items
      if (r.is_archived) return false;
      
      if (filter === 'unread') return !r.is_read;
      if (filter === 'upcoming') return r.due_date && new Date(r.due_date) > now && !r.is_read;
      if (filter === 'overdue') return r.due_date && new Date(r.due_date) < now && !r.is_read;
      if (filter === 'handled') return r.is_read; // Handled but not archived
      
      // 'all' - show everything except archived
      return true;
    });
    
    // Separate into active and handled
    const active = filtered.filter(r => !r.is_read).sort((a, b) => {
      if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
    
    const handled = filtered.filter(r => r.is_read).sort((a, b) => {
      if (a.due_date && b.due_date) return new Date(b.due_date) - new Date(a.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
    
    return { active, handled };
  };


  const { active: activeReminders, handled: handledReminders } = getFilteredReminders();
  const totalFiltered = activeReminders.length + handledReminders.length;

  // Counts for tabs (archived items are excluded from all counts except 'archived')
  const now = new Date();
  const nonArchived = reminders.filter(r => !r.is_archived);
  const counts = {
      all: nonArchived.length,
      unread: nonArchived.filter(r => !r.is_read).length,
      upcoming: nonArchived.filter(r => r.due_date && new Date(r.due_date) > now && !r.is_read).length,
      overdue: nonArchived.filter(r => !r.is_read && r.due_date && new Date(r.due_date) < now).length,
      handled: nonArchived.filter(r => r.is_read).length,
      archived: reminders.filter(r => r.is_archived).length
  };

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">תזכורות</h1>
          <p className="page-subtitle">ניהול התזכורות וההתראות שלך</p>
        </div>
      </div>

      <div className="reminders-tabs">
        <button 
          className={`tab-btn ${filter === 'all' ? 'active' : ''}`} 
          onClick={() => setFilter('all')}
        >
          הכל <span className="count-badge">{counts.all}</span>
        </button>
        <button 
          className={`tab-btn ${filter === 'unread' ? 'active' : ''}`} 
          onClick={() => setFilter('unread')}
        >
          פעילים <span className="count-badge">{counts.unread}</span>
        </button>
        <button 
          className={`tab-btn ${filter === 'upcoming' ? 'active' : ''}`} 
          onClick={() => setFilter('upcoming')}
        >
          עתידיים <span className="count-badge">{counts.upcoming}</span>
        </button>
        <button 
          className={`tab-btn overdue ${filter === 'overdue' ? 'active' : ''}`} 
          onClick={() => setFilter('overdue')}
        >
          באיחור <span className="count-badge overdue">{counts.overdue}</span>
        </button>
        <button 
          className={`tab-btn handled ${filter === 'handled' ? 'active' : ''}`} 
          onClick={() => setFilter('handled')}
        >
          טופלו <span className="count-badge">{counts.handled}</span>
        </button>
        <button 
          className={`tab-btn ${filter === 'archived' ? 'active' : ''}`} 
          onClick={() => setFilter('archived')}
        >
          ארכיון <span className="count-badge">{counts.archived}</span>
        </button>
      </div>

      <div className="reminders-container">
        <div className="reminders-list">
          {/* New Reminder Button - List Style */}
          <button
            onClick={() => { setEditingReminder(null); setIsModalOpen(true); }}
            className="list-item new-reminder-list-item"
          >
            <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
            <span style={{ fontWeight: 500 }}>צור תזכורת חדשה</span>
          </button>

        {totalFiltered === 0 ? (
          <div className="empty-state card">
            <div className="empty-state-icon">
                <Bell size={48} strokeWidth={1.5} />
            </div>
            <h3 className="empty-state-title">אין תזכורות להצגה</h3>
            <p>אין תזכורות התואמות את הסינון הנוכחי</p>
            {filter !== 'all' && (
                <button className="btn btn-secondary mt-4" onClick={() => setFilter('all')}>
                    הצג את כל התזכורות
                </button>
            )}
          </div>
        ) : (
          <>
            {/* Active Reminders - show if not in archived/handled filter */}
            {filter !== 'archived' && filter !== 'handled' && activeReminders.map(reminder => (
              <ReminderItem 
                key={reminder.id} 
                reminder={reminder} 
                onUpdate={handleReminderUpdate}
              />
            ))}

            {/* Separator and Handled Reminders - show in 'all' filter */}
            {filter === 'all' && handledReminders.length > 0 && (
              <>
                <div className="zone-separator">
                  <span>טופלו ({handledReminders.length})</span>
                </div>
                
                {handledReminders.map(reminder => (
                  <ReminderItem 
                    key={reminder.id} 
                    reminder={reminder} 
                    onUpdate={handleReminderUpdate}
                  />
                ))}
              </>
            )}

            {/* Show handled reminders directly (without separator) in 'handled' tab */}
            {filter === 'handled' && handledReminders.map(reminder => (
              <ReminderItem 
                key={reminder.id} 
                reminder={reminder} 
                onUpdate={handleReminderUpdate}
              />
            ))}

            {/* Show archived reminders directly in 'archived' tab - show both active and handled */}
            {filter === 'archived' && [...activeReminders, ...handledReminders].map(reminder => (
              <ReminderItem 
                key={reminder.id} 
                reminder={reminder} 
                onUpdate={handleReminderUpdate}
              />
            ))}
          </>
        )}
        </div>
      </div>

      {isModalOpen && (
        <RemindersModal 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          reminder={editingReminder}
        />
      )}
    </div>
  );
};

export default Reminders;
