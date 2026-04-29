import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Send, X, Loader2, Check, AlertCircle, User, Bot, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { aiAPI } from '../../services/api';
import { useModal } from '../Modal';
import useStore from '../../store/useStore';
import PlanCard from './PlanCard';
import './AIAssistant.css';

// דוגמאות שימוש
const EXAMPLES = [
  "צור לקוח חדש בשם דני לוי, טלפון 052-1234567",
  "צור פרויקט אתר ללקוח יוסי עם 3 משימות: עיצוב, פיתוח, בדיקות",
  "תזכיר לי להתקשר לדני מחר בשעה 10:00",
  "צור לקוח עם פרויקט ו-5 משימות לאתר חדש"
];

function AIAssistant() {
  const modal = useModal();
  const { enabledAddons } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [currentPlan, setCurrentPlan] = useState(null);
  const [selectedItems, setSelectedItems] = useState({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [showExamples, setShowExamples] = useState(true);
  const inputRef = useRef(null);
  const chatEndRef = useRef(null);

  // בדיקה אם התוסף מופעל
  const isEnabled = enabledAddons?.includes('ai_assistant');

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, currentPlan]);

  // When a new plan comes in, select all items by default
  useEffect(() => {
    if (currentPlan?.plan) {
      const newSelected = {};
      currentPlan.plan.forEach((item, idx) => {
        newSelected[idx] = true;
      });
      setSelectedItems(newSelected);
    }
  }, [currentPlan]);

  const handleClose = () => {
    setIsClosing(true);
  };

  const onAnimationEnd = () => {
    if (isClosing) {
      setIsOpen(false);
      setIsClosing(false);
    }
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage('');
    setShowExamples(false);
    setCurrentPlan(null);
    
    // Add user message to conversation
    setConversation(prev => [...prev, { type: 'user', content: userMessage }]);
    
    setIsLoading(true);

    try {
      // Build conversation history for API (only user and assistant messages, no system messages)
      const conversationHistory = conversation
        .filter(msg => msg.type === 'user' || msg.type === 'assistant')
        .map(msg => ({
          role: msg.type === 'user' ? 'user' : 'assistant',
          content: msg.content
        }));

      const response = await aiAPI.chat(userMessage, conversationHistory);
      
      if (response.plan && response.plan.length > 0) {
        setCurrentPlan(response);
        let summaryText = response.summary || 'הנה התוכנית שהכנתי:';
        if (response.warnings && response.warnings.length > 0) {
          summaryText += '\n\n⚠️ ' + response.warnings.join('\n⚠️ ');
        }
        setConversation(prev => [...prev, {
          type: 'assistant',
          content: summaryText,
          hasPlan: true
        }]);
      } else {
        setConversation(prev => [...prev, { 
          type: 'assistant', 
          content: response.summary || 'לא הצלחתי להבין את הבקשה. נסה לנסח אחרת.',
          isError: !response.summary
        }]);
      }
    } catch (error) {
      console.error('AI chat error:', error);
      setConversation(prev => [...prev, { 
        type: 'assistant', 
        content: error.message || 'שגיאה בתקשורת עם ה-AI',
        isError: true,
        details: error.details
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExampleClick = (example) => {
    setMessage(example);
    inputRef.current?.focus();
  };

  const handleToggleItem = (index) => {
    setSelectedItems(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const handleUpdateItem = (index, newData) => {
    setCurrentPlan(prev => ({
      ...prev,
      plan: prev.plan.map((item, idx) => 
        idx === index ? { ...item, data: { ...item.data, ...newData } } : item
      )
    }));
  };

  const handleExecute = async () => {
    if (!currentPlan?.plan) return;

    const itemsToCreate = currentPlan.plan
      .filter((_, idx) => selectedItems[idx])
      .map(item => ({ ...item }));

    if (itemsToCreate.length === 0) {
      modal.error('לא נבחרו פריטים ליצירה');
      return;
    }

    setIsExecuting(true);

    try {
      const result = await aiAPI.execute(itemsToCreate);
      
      const successCount = result.created?.filter(c => !c.error).length || 0;
      const errorCount = result.created?.filter(c => c.error).length || 0;

      setConversation(prev => [...prev, {
        type: 'result',
        success: errorCount === 0,
        content: result.summary || `נוצרו ${successCount} פריטים`,
        created: result.created
      }]);

      setCurrentPlan(null);
      setSelectedItems({});

      if (errorCount === 0) {
        modal.success(result.summary || `נוצרו ${successCount} פריטים בהצלחה!`);
      } else {
        modal.error(`נוצרו ${successCount} פריטים, ${errorCount} נכשלו`);
      }
    } catch (error) {
      console.error('Execute error:', error);
      modal.error(error.message || 'שגיאה ביצירת הפריטים');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = () => {
    setConversation([]);
    setCurrentPlan(null);
    setSelectedItems({});
    setShowExamples(true);
    setMessage('');
  };

  const selectedCount = Object.values(selectedItems).filter(Boolean).length;

  if (!isEnabled) return null;

  // Pinned button (when closed)
  if (!isOpen && !isClosing) {
    return createPortal(
      <button 
        className="ai-assistant-pinned-btn" 
        onClick={() => setIsOpen(true)}
        title="עוזר AI - צור באמצעות שיחה"
      >
        <Sparkles size={20} />
        <span className="ai-assistant-pinned-label">צור +</span>
      </button>,
      document.body
    );
  }

  // Drawer (when open)
  return createPortal(
    <div className={`ai-assistant-overlay ${isClosing ? 'closing' : ''}`} onClick={handleClose}>
      <div 
        className={`ai-assistant-drawer ${isClosing ? 'closing' : ''}`} 
        onClick={e => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        {/* Header */}
        <div className="ai-assistant-header">
          <div className="ai-assistant-title">
            <Sparkles size={20} />
            <span>עוזר יצירה AI</span>
          </div>
          <div className="ai-assistant-header-actions">
            {conversation.length > 0 && (
              <button onClick={handleReset} className="btn btn-ghost btn-icon btn-sm" title="התחל שיחה חדשה">
                <RefreshCw size={16} />
              </button>
            )}
            <button onClick={handleClose} className="btn btn-ghost btn-icon btn-sm">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="ai-assistant-content">
          {/* Welcome/Examples section */}
          {showExamples && conversation.length === 0 && (
            <div className="ai-assistant-welcome">
              <div className="ai-assistant-welcome-icon">
                <Sparkles size={32} />
              </div>
              <h3>מה תרצה ליצור?</h3>
              <p>ספר לי במילים שלך מה אתה צריך, ואני אכין תוכנית יצירה שתוכל לאשר או לערוך.</p>
              
              <div className="ai-assistant-capabilities">
                <span>לקוחות</span>
                <span>פרויקטים</span>
                <span>משימות</span>
                <span>תזכורות</span>
              </div>

              <div className="ai-assistant-examples">
                <div className="ai-assistant-examples-title">
                  <span>דוגמאות:</span>
                  <button onClick={() => setShowExamples(false)} className="btn btn-ghost btn-sm">
                    <ChevronUp size={14} />
                  </button>
                </div>
                {EXAMPLES.map((example, idx) => (
                  <button 
                    key={idx} 
                    className="ai-assistant-example"
                    onClick={() => handleExampleClick(example)}
                  >
                    "{example}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation */}
          {conversation.map((msg, idx) => (
            <div key={idx} className={`ai-message ${msg.type} ${msg.isError ? 'error' : ''}`}>
              <div className="ai-message-avatar">
                {msg.type === 'user' ? <User size={16} /> : 
                 msg.type === 'result' ? (msg.success ? <Check size={16} /> : <AlertCircle size={16} />) :
                 <Bot size={16} />}
              </div>
              <div className="ai-message-content">
                {msg.content.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                {msg.details && <p className="ai-message-details">{msg.details}</p>}
                {msg.created && (
                  <div className="ai-created-list">
                    {msg.created.map((item, i) => (
                      <div key={i} className={`ai-created-item ${item.error ? 'error' : 'success'}`}>
                        {item.error ? <AlertCircle size={14} /> : <Check size={14} />}
                        <span>{item.name}</span>
                        {item.error && <span className="ai-created-error">{item.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="ai-message assistant loading">
              <div className="ai-message-avatar">
                <Bot size={16} />
              </div>
              <div className="ai-message-content">
                <div className="ai-loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}

          {/* Plan cards */}
          {currentPlan?.plan && (
            <div className="ai-plan-section">
              <div className="ai-plan-header">
                <span>תוכנית יצירה ({selectedCount}/{currentPlan.plan.length} נבחרו)</span>
              </div>
              <div className="ai-plan-cards">
                {currentPlan.plan.map((item, idx) => (
                  <PlanCard
                    key={idx}
                    item={item}
                    index={idx}
                    isSelected={selectedItems[idx]}
                    onToggle={() => handleToggleItem(idx)}
                    onUpdate={(newData) => handleUpdateItem(idx, newData)}
                  />
                ))}
              </div>
              <div className="ai-plan-actions">
                <button 
                  className="btn btn-ghost"
                  onClick={() => setCurrentPlan(null)}
                >
                  ביטול
                </button>
                <button 
                  className="btn btn-primary"
                  onClick={handleExecute}
                  disabled={selectedCount === 0 || isExecuting}
                >
                  {isExecuting ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      יוצר...
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      צור {selectedCount} פריטים
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div className="ai-assistant-input-area">
          <form onSubmit={handleSendMessage}>
            <div className="ai-input-wrapper">
              <textarea
                ref={inputRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="תאר מה לייצר... (Enter לשליחה)"
                className="ai-input"
                disabled={isLoading || isExecuting}
                rows={1}
              />
              <button 
                type="submit" 
                className="ai-send-btn"
                disabled={!message.trim() || isLoading || isExecuting}
              >
                {isLoading ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default AIAssistant;


