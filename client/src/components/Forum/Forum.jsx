import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Send, X, CornerDownRight, Trash2, Edit2, Maximize2, Minimize2, ChevronDown, ChevronUp } from 'lucide-react';
import { commentsAPI } from '../../services/api';
import { formatDateTime } from '../../utils/format';
import { useModal } from '../Modal';
import './Forum.css';

function CommentItem({ comment, depth = 0, onReply, onEdit, onDelete }) {
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [replyContent, setReplyContent] = useState('');

  const handleSubmitReply = async (e) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    
    await onReply(comment.id, replyContent);
    setIsReplying(false);
    setReplyContent('');
  };

  const handleSubmitEdit = async (e) => {
    e.preventDefault();
    if (!editContent.trim()) return;
    
    await onEdit(comment.id, editContent);
    setIsEditing(false);
  };

  return (
    <div className="comment-wrapper">
      <div className="comment-item">
        <div className="comment-header">
          <span className="comment-author">{comment.user_name || 'אני'}</span>
          <span className="comment-date">{formatDateTime(comment.created_at)}</span>
        </div>
        
        {isEditing ? (
          <form onSubmit={handleSubmitEdit} className="edit-form">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="forum-input"
              autoFocus
            />
            <div className="flex gap-2 justify-end mt-2">
              <button type="button" onClick={() => setIsEditing(false)} className="btn btn-ghost btn-sm">ביטול</button>
              <button type="submit" className="btn btn-primary btn-sm">שמור</button>
            </div>
          </form>
        ) : (
          <div className="comment-body">{comment.content}</div>
        )}

        {!isEditing && (
          <div className="comment-actions">
            <button onClick={() => setIsReplying(!isReplying)} className="comment-action-btn">
              <CornerDownRight size={14} />
              הגב
            </button>
            <button onClick={() => setIsEditing(true)} className="comment-action-btn">
              <Edit2 size={14} />
              ערוך
            </button>
            <button onClick={() => onDelete(comment.id)} className="comment-action-btn text-red-500">
              <Trash2 size={14} />
              מחק
            </button>
          </div>
        )}

        {isReplying && (
          <form onSubmit={handleSubmitReply} className="reply-input-container">
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder="כתוב תגובה..."
              className="forum-input"
              style={{ minHeight: '60px' }}
              autoFocus
            />
            <div className="flex gap-2 justify-end mt-2">
              <button type="button" onClick={() => setIsReplying(false)} className="cancel-reply-btn">ביטול</button>
              <button type="submit" className="btn btn-primary btn-sm">שלח תגובה</button>
            </div>
          </form>
        )}
      </div>

      {comment.replies && comment.replies.length > 0 && (
        <div className="replies-list">
          {comment.replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Forum({ entityType, entityId }) {
  const modal = useModal();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const getContextParams = () => {
    const params = {};
    if (entityType === 'client') params.client_id = entityId;
    if (entityType === 'project') params.project_id = entityId;
    if (entityType === 'task') params.task_id = entityId;
    if (entityType === 'dashboard') params.dashboard = 'true';
    return params;
  };

  const loadUnreadCount = async () => {
    try {
      const params = getContextParams();
      const data = await commentsAPI.getUnreadCount(params);
      setUnreadCount(data.unread || 0);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  };

  const markAsRead = async () => {
    try {
      const params = getContextParams();
      await commentsAPI.markAsRead(params);
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const loadComments = async () => {
    try {
      setLoading(true);
      const params = getContextParams();

      const data = await commentsAPI.get(params);
      
      // Build tree structure
      const commentMap = {};
      const roots = [];

      // First pass: create map and initialize replies array
      data.forEach(comment => {
        comment.replies = [];
        commentMap[comment.id] = comment;
      });

      // Second pass: link parents and children
      data.forEach(comment => {
        if (comment.parent_id && commentMap[comment.parent_id]) {
          commentMap[comment.parent_id].replies.push(comment);
        } else {
          roots.push(comment);
        }
      });

      setComments(roots);
    } catch (error) {
      console.error('Failed to load comments:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (entityId || entityType === 'dashboard') {
      loadComments();
      loadUnreadCount();
    }
  }, [entityId, entityType]);

  // Mark as read when drawer opens
  useEffect(() => {
    if (isOpen && !isClosing) {
      markAsRead();
    }
  }, [isOpen]);

  const handleCreateComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    try {
      const data = {
        content: newComment,
        parent_id: null
      };
      
      if (entityType === 'client') data.client_id = entityId;
      if (entityType === 'project') data.project_id = entityId;
      if (entityType === 'task') data.task_id = entityId;

      await commentsAPI.create(data);
      setNewComment('');
      loadComments();
      // Mark as read since user is actively in the drawer
      markAsRead();
    } catch (error) {
      modal.error('שגיאה ביצירת תגובה');
    }
  };

  const handleReply = async (parentId, content) => {
    try {
      const data = {
        content,
        parent_id: parentId
      };
      
      if (entityType === 'client') data.client_id = entityId;
      if (entityType === 'project') data.project_id = entityId;
      if (entityType === 'task') data.task_id = entityId;

      await commentsAPI.create(data);
      loadComments();
    } catch (error) {
      modal.error('שגיאה ביצירת תגובה');
    }
  };

  const handleEdit = async (commentId, content) => {
    try {
      await commentsAPI.update(commentId, content);
      loadComments();
    } catch (error) {
      modal.error('שגיאה בעריכת תגובה');
    }
  };

  const handleDelete = async (commentId) => {
    if (await modal.confirm('האם אתה בטוח שברצונך למחוק תגובה זו?')) {
      try {
        await commentsAPI.delete(commentId);
        loadComments();
      } catch (error) {
        modal.error('שגיאה במחיקת תגובה');
      }
    }
  };

  const handleClose = () => {
    setIsClosing(true);
  };

  const onAnimationEnd = () => {
    if (isClosing) {
      setIsOpen(false);
      setIsClosing(false);
    }
  };

  if (!isOpen && !isClosing) {
    return createPortal(
      <button 
        className="forum-pinned-btn" 
        onClick={() => setIsOpen(true)}
        title="הערות שלי"
      >
        <MessageSquare size={20} />
        <span className="forum-pinned-label">הערות</span>
        {unreadCount > 0 && (
          <span className="forum-unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>,
      document.body
    );
  }

  return createPortal(
    <div className={`forum-expanded-overlay ${isClosing ? 'closing' : ''}`} onClick={handleClose}>
      <div 
        className={`forum-container forum-drawer ${isClosing ? 'closing' : ''}`} 
        onClick={e => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="forum-header">
          <div className="forum-title">
            <MessageSquare size={18} />
            <span>הערות ודיונים</span>
            <span className="badge bg-secondary text-xs ms-2">{comments.length}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={handleClose} className="btn btn-ghost btn-icon btn-sm">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="forum-content">
          {loading ? (
            <div className="flex justify-center p-4"><div className="spinner"></div></div>
          ) : comments.length === 0 ? (
            <div className="empty-forum">
              <MessageSquare size={32} strokeWidth={1.5} className="mb-2 opacity-50" />
              <p>אין הערות עדיין. התחל שיחה!</p>
            </div>
          ) : (
            comments.map(comment => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onReply={handleReply}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>

        <div className="forum-input-area">
          <form onSubmit={handleCreateComment}>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="כתוב הערה או מחשבה..."
              className="forum-input"
            />
            <button 
              type="submit" 
              className="forum-submit-btn"
              disabled={!newComment.trim()}
            >
              <Send size={16} />
              <span>שלח</span>
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default Forum;

