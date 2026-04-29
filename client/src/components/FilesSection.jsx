import { useState, useRef } from 'react';
import { Upload, File, FileText, FileImage, FileVideo, FileAudio, Download, Trash2, X } from 'lucide-react';
import { filesAPI } from '../services/api';
import { useModal } from './Modal';
import './FilesSection.css';

// Get appropriate icon for file type
const getFileIcon = (mimeType) => {
    if (!mimeType) return File;
    if (mimeType.startsWith('image/')) return FileImage;
    if (mimeType.startsWith('video/')) return FileVideo;
    if (mimeType.startsWith('audio/')) return FileAudio;
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return FileText;
    return File;
};

// Format file size
const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

function FilesSection({ entityType, entityId, files, onFilesChange }) {
    const modal = useModal();
    const fileInputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);

        const droppedFiles = Array.from(e.dataTransfer.files);
        await uploadFiles(droppedFiles);
    };

    const handleFileSelect = async (e) => {
        const selectedFiles = Array.from(e.target.files);
        await uploadFiles(selectedFiles);
        e.target.value = ''; // Reset input
    };

    const uploadFiles = async (filesToUpload) => {
        if (filesToUpload.length === 0) return;

        setUploading(true);
        try {
            for (const file of filesToUpload) {
                const formData = new FormData();
                formData.append('file', file);

                // Add entity reference
                if (entityType === 'client') {
                    formData.append('client_id', entityId);
                } else if (entityType === 'project') {
                    formData.append('project_id', entityId);
                } else if (entityType === 'task') {
                    formData.append('task_id', entityId);
                }

                await filesAPI.upload(formData);
            }

            modal.success(`${filesToUpload.length} קבצים הועלו בהצלחה`);
            onFilesChange(); // Refresh files list
        } catch (error) {
            modal.error('שגיאה בהעלאת קבצים');
            console.error('Upload error:', error);
        } finally {
            setUploading(false);
        }
    };

    const handleDownload = async (file) => {
        try {
            const blob = await filesAPI.download(file.id);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.original_name;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            modal.error('שגיאה בהורדת הקובץ');
            console.error('Download error:', error);
        }
    };

    const handleDelete = async (file) => {
        const confirmed = await modal.confirm(
            `האם אתה בטוח שברצונך למחוק את הקובץ "${file.original_name}"?`,
            { title: 'מחיקת קובץ', confirmText: 'מחק', type: 'error' }
        );

        if (confirmed) {
            try {
                await filesAPI.delete(file.id);
                modal.success('הקובץ נמחק בהצלחה');
                onFilesChange();
            } catch (error) {
                modal.error('שגיאה במחיקת הקובץ');
                console.error('Delete error:', error);
            }
        }
    };

    return (
        <div className="files-section">
            <div className="files-list">
                {/* New File Button - List Style */}
                <button
                    className={`list-item new-file-list-item ${isDragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !uploading && fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                />

                {uploading ? (
                    <>
                        <div className="spinner" />
                            <span style={{ fontWeight: 500 }}>מעלה קבצים...</span>
                    </>
                ) : (
                    <>
                            <Upload size={20} strokeWidth={1.5} style={{ marginRight: '0.5rem' }} />
                            <span style={{ fontWeight: 500 }}>העלה קובץ חדש</span>
                    </>
                )}
                </button>

            {/* Files List */}
            {files.length === 0 ? (
                <div className="files-empty">
                    <File size={32} strokeWidth={1.5} />
                    <span>אין קבצים עדיין</span>
                </div>
            ) : (
                    files.map(file => {
                        const FileIcon = getFileIcon(file.mime_type);
                        return (
                            <div key={file.id} className="file-item">
                                <div className="file-icon">
                                    <FileIcon size={24} />
                                </div>
                                <div className="file-info">
                                    <span className="file-name">{file.original_name}</span>
                                    <span className="file-meta">
                                        {formatFileSize(file.size)} • {new Date(file.created_at).toLocaleDateString('he-IL')}
                                    </span>
                                </div>
                                <div className="file-actions">
                                    <button
                                        onClick={() => handleDownload(file)}
                                        className="btn btn-ghost btn-icon btn-sm"
                                        title="הורד"
                                    >
                                        <Download size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(file)}
                                        className="btn btn-ghost btn-icon btn-sm"
                                        title="מחק"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        );
                    })
            )}
            </div>
        </div>
    );
}

export default FilesSection;
