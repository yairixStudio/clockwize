import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLeadStatus, getLeadPriority } from '../utils/leadStatus';
import './LeadTimelineView.css';

function LeadTimelineView({ leads }) {
  const navigate = useNavigate();

  const { months, rows, startDate, totalDays } = useMemo(() => {
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 1);
    const threeMonthsAhead = new Date(now);
    threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3);

    const start = new Date(threeMonthsAgo.getFullYear(), threeMonthsAgo.getMonth(), 1);
    const end = new Date(threeMonthsAhead.getFullYear(), threeMonthsAhead.getMonth() + 1, 0);
    const total = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    // Generate months
    const monthsList = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const monthStart = Math.max(0, Math.ceil((cursor - start) / (1000 * 60 * 60 * 24)));
      monthsList.push({
        label: cursor.toLocaleDateString('he-IL', { month: 'short', year: '2-digit' }),
        startPercent: (monthStart / total) * 100,
        widthPercent: (daysInMonth / total) * 100
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Generate lead rows
    const activeLeads = leads.filter(l => l.status !== 'won' && l.status !== 'lost' || l.expected_close_date);
    const leadRows = activeLeads.map(lead => {
      const created = new Date(lead.created_at);
      const closeDate = lead.expected_close_date ? new Date(lead.expected_close_date) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const barStart = Math.max(0, (created - start) / (1000 * 60 * 60 * 24));
      const barEnd = Math.min(total, (closeDate - start) / (1000 * 60 * 60 * 24));
      const barWidth = Math.max(2, barEnd - barStart);

      return {
        lead,
        leftPercent: (barStart / total) * 100,
        widthPercent: (barWidth / total) * 100,
        status: getLeadStatus(lead.status),
        priority: getLeadPriority(lead.priority)
      };
    });

    return { months: monthsList, rows: leadRows, startDate: start, totalDays: total };
  }, [leads]);

  // Today marker
  const todayOffset = useMemo(() => {
    const now = new Date();
    const days = (now - startDate) / (1000 * 60 * 60 * 24);
    return (days / totalDays) * 100;
  }, [startDate, totalDays]);

  if (leads.length === 0) {
    return (
      <div className="lead-timeline-empty">
        <p>אין לידים להצגה בציר הזמן</p>
      </div>
    );
  }

  return (
    <div className="lead-timeline">
      <div className="lead-timeline-header">
        {months.map((m, i) => (
          <div
            key={i}
            className="lead-timeline-month"
            style={{ left: `${m.startPercent}%`, width: `${m.widthPercent}%` }}
          >
            {m.label}
          </div>
        ))}
      </div>

      <div className="lead-timeline-body">
        <div className="lead-timeline-today" style={{ left: `${todayOffset}%` }}>
          <span className="lead-timeline-today-label">היום</span>
        </div>

        {rows.map(({ lead, leftPercent, widthPercent, status }) => (
          <div key={lead.id} className="lead-timeline-row">
            <div className="lead-timeline-label">
              <span className="lead-timeline-lead-name">{lead.name}</span>
              {lead.company && <span className="lead-timeline-lead-company">{lead.company}</span>}
            </div>
            <div className="lead-timeline-bar-area">
              <div
                className="lead-timeline-bar"
                style={{
                  left: `${leftPercent}%`,
                  width: `${widthPercent}%`,
                  background: status.color
                }}
                onClick={() => navigate(`/leads/${lead.id}`)}
                title={`${lead.name} - ${status.label}`}
              >
                <span className="lead-timeline-bar-text">{lead.name}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LeadTimelineView;
