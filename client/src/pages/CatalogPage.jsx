import { useState, useEffect } from 'react';
import { Package, Plus, Edit2, Trash2, Tag, DollarSign, Search, Filter, ToggleLeft, ToggleRight } from 'lucide-react';
import { catalogAPI } from '../services/api';
import { useModal } from '../components/Modal';
import CatalogModal from '../components/CatalogModal';
import { formatCurrency } from '../utils/format';
import './CatalogPage.css';

function CatalogPage() {
  const modal = useModal();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchData();
  }, [selectedCategory, showInactive]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedCategory) params.category = selectedCategory;
      if (!showInactive) params.active_only = true;
      
      const [itemsData, categoriesData] = await Promise.all([
        catalogAPI.getAll(params),
        catalogAPI.getCategories().catch(() => [])
      ]);
      
      setItems(itemsData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('Error fetching catalog:', error);
      modal.error('שגיאה בטעינת הקטלוג');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (data) => {
    try {
      if (editingItem) {
        await catalogAPI.update(editingItem.id, data);
        modal.success('הפריט עודכן בהצלחה');
      } else {
        await catalogAPI.create(data);
        modal.success('הפריט נוסף בהצלחה');
      }
      await fetchData();
      setShowModal(false);
      setEditingItem(null);
    } catch (error) {
      modal.error(error.message);
    }
  };

  const handleDelete = async (item) => {
    const confirmed = await modal.confirm(
      `האם אתה בטוח שברצונך למחוק את "${item.name}"?`,
      { title: 'מחיקת פריט', confirmText: 'מחק', type: 'error' }
    );

    if (confirmed) {
      try {
        await catalogAPI.delete(item.id);
        await fetchData();
        modal.success('הפריט נמחק בהצלחה');
      } catch (error) {
        modal.error(error.message);
      }
    }
  };

  const handleToggleActive = async (item) => {
    try {
      await catalogAPI.update(item.id, { ...item, is_active: !item.is_active });
      await fetchData();
      modal.success(item.is_active ? 'הפריט הושבת' : 'הפריט הופעל');
    } catch (error) {
      modal.error(error.message);
    }
  };

  // Filter items by search query
  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Group items by category
  const groupedItems = filteredItems.reduce((acc, item) => {
    const category = item.category || 'ללא קטגוריה';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  const getPricingTypeLabel = (type) => {
    switch (type) {
      case 'hourly': return 'לשעה';
      case 'daily': return 'ליום';
      case 'monthly': return 'לחודש';
      case 'fixed': 
      default: return 'מחיר קבוע';
    }
  };

  return (
    <div className="page fade-in catalog-page">
      <div className="page-header">
        <div className="page-title-section">
          <Package className="page-icon" size={28} />
          <div>
            <h1 className="page-title">קטלוג מוצרים ושירותים</h1>
            <p className="page-subtitle">ניהול המוצרים והשירותים שלך לתמחור פרויקטים</p>
          </div>
        </div>
        <button 
          className="btn btn-primary"
          onClick={() => { setEditingItem(null); setShowModal(true); }}
        >
          <Plus size={18} />
          <span>הוסף פריט</span>
        </button>
      </div>

      {/* Filters */}
      <div className="catalog-filters card">
        <div className="filter-group">
          <div className="search-input-wrapper">
            <Search size={18} />
            <input
              type="text"
              placeholder="חיפוש פריט..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        <div className="filter-group">
          <Filter size={18} />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="filter-select"
          >
            <option value="">כל הקטגוריות</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <button 
          className={`filter-toggle ${showInactive ? 'active' : ''}`}
          onClick={() => setShowInactive(!showInactive)}
        >
          {showInactive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          <span>הצג מושבתים</span>
        </button>
      </div>

      {/* Content */}
      <div className="page-content">
        {loading ? (
          <div className="loading">
            <div className="spinner"></div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state card">
            <div className="empty-state-icon">
              <Package size={48} strokeWidth={1.5} />
            </div>
            <h3 className="empty-state-title">
              {searchQuery || selectedCategory ? 'לא נמצאו פריטים' : 'הקטלוג ריק'}
            </h3>
            <p>
              {searchQuery || selectedCategory 
                ? 'נסה לשנות את הסינון או החיפוש'
                : 'הוסף מוצרים ושירותים לקטלוג שלך'}
            </p>
            {!searchQuery && !selectedCategory && (
              <button 
                className="btn btn-primary"
                onClick={() => { setEditingItem(null); setShowModal(true); }}
              >
                <Plus size={18} />
                <span>הוסף פריט ראשון</span>
              </button>
            )}
          </div>
        ) : (
          <div className="catalog-groups">
            {Object.entries(groupedItems).map(([category, categoryItems]) => (
              <div key={category} className="catalog-group">
                <h3 className="catalog-group-title">
                  <Tag size={18} />
                  {category}
                  <span className="catalog-group-count">{categoryItems.length}</span>
                </h3>
                <div className="catalog-items">
                  {categoryItems.map(item => (
                    <div 
                      key={item.id} 
                      className={`catalog-item card ${!item.is_active ? 'inactive' : ''}`}
                    >
                      <div className="catalog-item-header">
                        <h4 className="catalog-item-name">{item.name}</h4>
                        {!item.is_active && (
                          <span className="catalog-item-badge inactive">מושבת</span>
                        )}
                      </div>
                      
                      {item.description && (
                        <p className="catalog-item-description">{item.description}</p>
                      )}
                      
                      <div className="catalog-item-price">
                        <DollarSign size={16} />
                        <span className="price-value ltr">
                          {item.price ? formatCurrency(item.price) : 'לא הוגדר'}
                        </span>
                        {item.price && (
                          <span className="price-type">
                            / {item.unit || getPricingTypeLabel(item.pricing_type)}
                          </span>
                        )}
                      </div>

                      {item.notes && (
                        <p className="catalog-item-notes">{item.notes}</p>
                      )}

                      <div className="catalog-item-actions">
                        <button 
                          className="btn-icon-tiny"
                          onClick={() => handleToggleActive(item)}
                          title={item.is_active ? 'השבת' : 'הפעל'}
                        >
                          {item.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                        <button 
                          className="btn-icon-tiny"
                          onClick={() => { setEditingItem(item); setShowModal(true); }}
                          title="ערוך"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          className="btn-icon-tiny danger"
                          onClick={() => handleDelete(item)}
                          title="מחק"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <CatalogModal
          item={editingItem}
          categories={categories}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingItem(null); }}
        />
      )}
    </div>
  );
}

export default CatalogPage;
