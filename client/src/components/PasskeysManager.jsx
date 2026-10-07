import { useState, useEffect } from 'react';
import { KeyRound, Plus, Pencil, Trash2, Cloud, Smartphone } from 'lucide-react';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { passkeysAPI } from '../services/api';
import { useModal } from './Modal';
import { formatDateTime } from '../utils/format';
import './PasskeysManager.css';

function PasskeysManager() {
  const [passkeys, setPasskeys] = useState([]);
  const [hasPassword, setHasPassword] = useState(true);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const modal = useModal();
  const supported = browserSupportsWebAuthn();

  const loadPasskeys = async () => {
    try {
      const data = await passkeysAPI.getAll();
      setPasskeys(data.passkeys);
      setHasPassword(data.hasPassword);
    } catch (err) {
      console.error('Failed to load passkeys:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPasskeys();
  }, []);

  const handleAdd = async () => {
    setAdding(true);
    try {
      const { flowId, options } = await passkeysAPI.registerOptions();
      const regResponse = await startRegistration({ optionsJSON: options });

      const name = await modal.prompt('שם ל-Passkey (למשל: "MacBook שלי"):', {
        title: 'Passkey חדש',
        placeholder: 'שם מזהה'
      });

      await passkeysAPI.registerVerify({ flowId, response: regResponse, name: name || undefined });
      await loadPasskeys();
      await modal.success('ה-Passkey נוסף בהצלחה!');
    } catch (err) {
      if (err?.name === 'InvalidStateError') {
        await modal.error('כבר קיים Passkey למכשיר הזה בחשבון שלך');
      } else if (err?.name !== 'NotAllowedError') {
        await modal.error(err.message || 'הוספת ה-Passkey נכשלה');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRename = async (passkey) => {
    const name = await modal.prompt('שם חדש ל-Passkey:', {
      title: 'שינוי שם',
      placeholder: passkey.name || 'שם מזהה'
    });
    if (!name || name.trim() === '' || name === passkey.name) return;

    setBusyId(passkey.id);
    try {
      await passkeysAPI.rename(passkey.id, name.trim());
      await loadPasskeys();
    } catch (err) {
      await modal.error(err.message || 'שינוי השם נכשל');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (passkey) => {
    const isLast = passkeys.length === 1;
    const warning = !hasPassword && isLast
      ? 'זהו ה-Passkey האחרון בחשבון ללא סיסמה — מחיקתו תנעל אותך מחוץ לחשבון!'
      : `למחוק את "${passkey.name}"? לא ניתן לבטל פעולה זו.`;

    const confirmed = await modal.confirm(warning, { title: 'מחיקת Passkey', danger: true });
    if (!confirmed) return;

    setBusyId(passkey.id);
    try {
      await passkeysAPI.remove(passkey.id);
      await loadPasskeys();
    } catch (err) {
      await modal.error(err.message || 'המחיקה נכשלה');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="passkeys-loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="passkeys-manager">
      <div className="passkeys-header">
        <div>
          <h3 className="settings-section-title">Passkeys</h3>
          <p className="passkeys-subtitle">
            התחברות מהירה ומאובטחת עם Touch ID, Face ID או מפתח אבטחה — בלי סיסמה
          </p>
        </div>
        {supported && (
          <button className="btn btn-primary" onClick={handleAdd} disabled={adding}>
            <Plus size={18} />
            <span>{adding ? 'ממתין לאימות...' : 'הוסף Passkey'}</span>
          </button>
        )}
      </div>

      {!supported && (
        <div className="passkeys-unsupported">
          הדפדפן הזה לא תומך ב-Passkeys
        </div>
      )}

      {supported && passkeys.length === 0 && (
        <div className="passkeys-empty">
          <KeyRound size={40} strokeWidth={1.5} />
          <p>אין עדיין Passkeys בחשבון</p>
          <p className="passkeys-empty-hint">
            הוסף Passkey כדי להתחבר בלחיצה אחת עם טביעת אצבע או זיהוי פנים
          </p>
        </div>
      )}

      {passkeys.length > 0 && (
        <ul className="passkeys-list">
          {passkeys.map(passkey => (
            <li key={passkey.id} className="passkey-item">
              <div className="passkey-icon">
                <KeyRound size={20} />
              </div>
              <div className="passkey-info">
                <div className="passkey-name-row">
                  <span className="passkey-name">{passkey.name}</span>
                  {passkey.backed_up ? (
                    <span className="passkey-badge passkey-badge-synced" title="מסונכרן בענן (iCloud / Google)">
                      <Cloud size={12} />
                      מסונכרן
                    </span>
                  ) : (
                    <span className="passkey-badge" title="שמור על מכשיר אחד בלבד">
                      <Smartphone size={12} />
                      מכשיר יחיד
                    </span>
                  )}
                </div>
                <div className="passkey-meta">
                  נוצר: {formatDateTime(passkey.created_at)}
                  {passkey.last_used_at && <> · שימוש אחרון: {formatDateTime(passkey.last_used_at)}</>}
                </div>
              </div>
              <div className="passkey-actions">
                <button
                  className="btn btn-ghost btn-icon"
                  title="שינוי שם"
                  onClick={() => handleRename(passkey)}
                  disabled={busyId === passkey.id}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="btn btn-ghost btn-icon passkey-delete"
                  title="מחיקה"
                  onClick={() => handleDelete(passkey)}
                  disabled={busyId === passkey.id}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!hasPassword && (
        <div className="passkeys-notice">
          לחשבון זה אין סיסמה — ההתחברות מתבצעת עם Passkey בלבד. מומלץ להחזיק לפחות שני
          Passkeys (למשל מחשב + טלפון) כדי לא להינעל מחוץ לחשבון.
        </div>
      )}
    </div>
  );
}

export default PasskeysManager;
