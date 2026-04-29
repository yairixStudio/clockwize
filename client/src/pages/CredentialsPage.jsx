import { useState, useEffect } from 'react';
import { Key } from 'lucide-react';
import { credentialsAPI } from '../services/api';
import { CredentialModal, CredentialsSection } from '../components/Credentials';
import { useModal } from '../components/Modal';
import '../components/Credentials.css';

function CredentialsPage() {
  const modal = useModal();
  const [credentials, setCredentials] = useState([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [editingCredential, setEditingCredential] = useState(null);

  useEffect(() => {
    fetchCredentials();
  }, []);

  const fetchCredentials = async () => {
    setLoadingCredentials(true);
    try {
      const data = await credentialsAPI.getAccount();
      setCredentials(data);
    } catch (error) {
      console.error('Error fetching credentials:', error);
    } finally {
      setLoadingCredentials(false);
    }
  };

  const handleSaveCredential = async (credentialData) => {
    try {
      if (editingCredential) {
        await credentialsAPI.update(editingCredential.id, credentialData);
      } else {
        await credentialsAPI.create(credentialData);
      }
      await fetchCredentials();
      setShowCredentialModal(false);
      setEditingCredential(null);
      modal.success(editingCredential ? 'הסיסמה עודכנה בהצלחה' : 'הסיסמה נוספה בהצלחה');
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDeleteCredential = async (credentialId) => {
    const confirmed = await modal.confirm(
      'האם אתה בטוח שברצונך למחוק את הסיסמה?',
      { title: 'מחיקת סיסמה', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await credentialsAPI.delete(credentialId);
        await fetchCredentials();
        modal.success('הסיסמה נמחקה בהצלחה');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div className="page-title-section">
          <Key className="page-icon" size={28} />
          <div>
            <h1 className="page-title">סיסמאות ופרטי גישה</h1>
            <p className="page-subtitle">ניהול סיסמאות ופרטי גישה לחשבונות ושירותים</p>
          </div>
        </div>
      </div>

      <div className="page-content">
        <CredentialsSection
          credentials={credentials}
          loading={loadingCredentials}
          onAdd={() => { setEditingCredential(null); setShowCredentialModal(true); }}
          onEdit={(cred) => { setEditingCredential(cred); setShowCredentialModal(true); }}
          onDelete={handleDeleteCredential}
        />
      </div>

      {showCredentialModal && (
        <CredentialModal
          isOpen={showCredentialModal}
          onClose={() => { setShowCredentialModal(false); setEditingCredential(null); }}
          onSave={handleSaveCredential}
          credential={editingCredential}
          clientId={null}
          projectId={null}
        />
      )}
    </div>
  );
}

export default CredentialsPage;

