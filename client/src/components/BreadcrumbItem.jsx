import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Check } from 'lucide-react';
import './BreadcrumbItem.css';

/**
 * Breadcrumb item with dropdown for switching between items
 *
 * @param {Object} props
 * @param {string} props.label - Display text
 * @param {string} props.to - Link destination (optional, if not provided it's the current item)
 * @param {Array} props.items - Array of items for dropdown: { id, name, to }
 * @param {string} props.currentId - Current item's ID (to highlight in dropdown)
 * @param {boolean} props.isCurrent - Whether this is the current page item
 * @param {Function} props.onLoadItems - Async function to load items for dropdown (lazy loading)
 * @param {Function} props.onRename - Async function to rename the current item (enables double-click edit)
 */
const BreadcrumbItem = ({
  label,
  to,
  items = [],
  currentId,
  isCurrent = false,
  onLoadItems,
  loading: externalLoading = false,
  onRename
}) => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [loadedItems, setLoadedItems] = useState(items);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  // Inline rename state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef(null);

  // Update items when prop changes
  useEffect(() => {
    if (items.length > 0) {
      setLoadedItems(items);
    }
  }, [items]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleDropdownToggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isOpen && onLoadItems && loadedItems.length === 0) {
      setLoading(true);
      try {
        const items = await onLoadItems();
        setLoadedItems(items);
      } catch (error) {
        console.error('Failed to load items:', error);
      } finally {
        setLoading(false);
      }
    }

    setIsOpen(!isOpen);
  };

  const handleItemClick = (item) => {
    setIsOpen(false);
    if (item.to) {
      navigate(item.to);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  // Select all text when edit input appears
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (isCurrent && onRename) {
      setEditValue(label);
      setIsEditing(true);
    }
  };

  const handleEditSave = () => {
    const trimmed = editValue.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== label) {
      onRename(trimmed);
    }
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
    }
  };

  return (
    <div className={`breadcrumb-item ${isCurrent ? 'is-current' : ''}`} ref={dropdownRef}>
      {isCurrent && isEditing ? (
        <input
          ref={editInputRef}
          className="breadcrumb-edit-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={handleEditSave}
          autoFocus
        />
      ) : isCurrent ? (
        <span
          className={`breadcrumb-label current-page-name${onRename ? ' editable' : ''}`}
          onDoubleClick={handleDoubleClick}
        >
          {label}
        </span>
      ) : (
        <Link to={to} className="breadcrumb-label">{label}</Link>
      )}

      <button
        className={`breadcrumb-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={handleDropdownToggle}
        onKeyDown={handleKeyDown}
        aria-label="החלף פריט"
        aria-expanded={isOpen}
      >
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className="breadcrumb-dropdown">
          {loading || externalLoading ? (
            <div className="breadcrumb-dropdown-loading">
              <span className="spinner-small"></span>
              טוען...
            </div>
          ) : loadedItems.length === 0 ? (
            <div className="breadcrumb-dropdown-empty">
              אין פריטים
            </div>
          ) : (
            <div className="breadcrumb-dropdown-list">
              {loadedItems.map((item) => (
                <button
                  key={item.id}
                  className={`breadcrumb-dropdown-item ${item.id === currentId ? 'is-current' : ''}`}
                  onClick={() => handleItemClick(item)}
                >
                  <span className="item-name">{item.name}</span>
                  {item.id === currentId && (
                    <Check size={14} className="current-check" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BreadcrumbItem;
