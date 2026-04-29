import { useState, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import { notesAPI } from '../services/api';
import { useModal } from './Modal';
import { formatDateTime } from '../utils/format';
import './NotesTab.css';

export default function NotesTab({ entityType, entityId }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [title, setTitle] = useState('');
  const modal = useModal();

  const loadNotes = async () => {
    try {
      setLoading(true);
      const data = await notesAPI.getByEntity(entityType, entityId);
      setNotes(data);
    } catch (error) {
      console.error('Failed to load notes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
  }, [entityType, entityId]);

  const handleSave = async () => {
    try {
      if (editingNote) {
        await notesAPI.update(editingNote.id, { title, content: editorContent });
        modal.success('הפתק עודכן בהצלחה');
      } else {
        await notesAPI.create({
          entity_type: entityType,
          entity_id: entityId,
          title,
          content: editorContent
        });
        modal.success('הפתק נוסף בהצלחה');
      }
      setEditingNote(null);
      setIsCreating(false);
      setEditorContent('');
      setTitle('');
      loadNotes();
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDelete = async (note) => {
    if (await modal.confirm('האם אתה בטוח שברצונך למחוק את הפתק?')) {
      try {
        await notesAPI.delete(note.id);
        modal.success('הפתק נמחק בהצלחה');
        loadNotes();
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  const startEdit = (note) => {
    setEditingNote(note);
    setTitle(note.title || '');
    setEditorContent(note.content || '');
    setIsCreating(false);
  };

  const startCreate = () => {
    setEditingNote(null);
    setTitle('');
    setEditorContent('');
    setIsCreating(true);
  };

  const cancelEdit = () => {
    setEditingNote(null);
    setIsCreating(false);
    setEditorContent('');
    setTitle('');
  };

  if (loading && !notes.length && !isCreating) {
    return <div className="loading-spinner">...</div>;
  }

  const isEditing = isCreating || editingNote;

  return (
    <div className="notes-tab">
      {isEditing ? (
        <div className="note-editor card">
          <div className="editor-header">
            <input
              type="text"
              className="form-input note-title-input"
              placeholder="כותרת הפתק..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <ReactQuill 
            theme="snow" 
            value={editorContent} 
            onChange={setEditorContent} 
            modules={{
              toolbar: [
                [{ 'header': [1, 2, false] }],
                ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                [{'list': 'ordered'}, {'list': 'bullet'}],
                ['link', 'clean']
              ],
            }}
          />
          <div className="editor-actions">
            <button onClick={handleSave} className="btn btn-primary">
              <Save size={16} />
              שמור
            </button>
            <button onClick={cancelEdit} className="btn btn-secondary">
              <X size={16} />
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <div className="notes-list">
          {/* New Note Button - List Style */}
          {!isEditing && (
            <button
              onClick={startCreate}
              className="list-item new-note-list-item"
            >
              <Plus size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
              <span style={{ fontWeight: 500 }}>צור פתק חדש</span>
            </button>
          )}

          {notes.length === 0 ? (
            <div className="empty-state">
              <p>אין פתקים עדיין</p>
            </div>
          ) : (
            notes.map(note => (
              <div key={note.id} className="note-item card">
                <div className="note-header">
                  <h3 className="note-title">{note.title || '(ללא כותרת)'}</h3>
                  <div className="note-actions">
                    <button onClick={() => startEdit(note)} className="btn btn-ghost btn-icon btn-sm">
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => handleDelete(note)} className="btn btn-ghost btn-icon btn-sm">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="note-content-preview ql-editor" dangerouslySetInnerHTML={{ __html: note.content }} />
                <div className="note-meta">
                  {formatDateTime(note.updated_at || note.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

