import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = 'https://quok.art';
const BASE_PATH = '/pizza';

const socket = io(SERVER_URL, {
  path: `${BASE_PATH}/socket.io`,
  reconnection: true,
  reconnectionDelayMax: 5000
});

const getOrderAmount = (order) => {
  if (!order) return 0;
  const candidates = [order.totalAmount, order.amount, order.total, order.sum];
  for (const c of candidates) {
    const n = Number(c);
    if (!isNaN(n) && n > 0) return n;
  }
  const items = getOrderItems(order);
  return items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
};

const getOrderItems = (order) => {
  if (!order) return [];
  if (Array.isArray(order.items)) return order.items;
  if (typeof order.items === 'string') {
    try {
      const parsed = JSON.parse(order.items);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  return [];
};

const formatOrderTime = (order) => {
  const raw = order.timestamp || order.createdAt || order.date || order.addedAt;
  const d = raw ? new Date(raw) : null;
  return (d && !isNaN(d.getTime())) ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '--:--';
};

export default function AdminApp() {
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [history, setHistory] = useState([]);
  const [agentLogs, setAgentLogs] = useState([]);

  // Разделы и фильтры
  const [navTab, setNavTab] = useState('menu'); // 'menu' | 'categories' | 'history' | 'hardware'
  const [selectedCategory, setSelectedCategory] = useState('Все');

  const [statsPeriod, setStatsPeriod] = useState('month'); // 'today' | 'month' | 'all'
  const [analyticsTab, setAnalyticsTab] = useState('history'); // 'history' | 'items'

  const [newCatName, setNewCatName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [editCategoryName, setEditCategoryName] = useState('');
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [isSettling, setIsSettling] = useState(false);

  const defaultItemState = {
    name: '', desc: '', size: '', price: '', category: '', image: '',
    hasAddons: false, addons: [], canBuySlice: false, slicePrice: '',
    tags: [], isAvailable: true, isHidden: false
  };

  const [newItem, setNewItem] = useState(defaultItemState);
  const [currentAddon, setCurrentAddon] = useState({ name: '', price: '' });
  const [taxcomData, setTaxcomData] = useState(null);
  const [loadingTaxcom, setLoadingTaxcom] = useState(false);

  const logsEndRef = useRef(null);

  useEffect(() => {
    socket.on('menu_updated', (serverMenu) => setMenuItems(serverMenu || []));
    socket.on('categories_updated', (serverCats) => setCategories(serverCats || []));
    socket.on('tags_updated', (serverTags) => setTags(serverTags || []));
    socket.on('history_updated', (serverHistory) => setHistory(serverHistory || []));

    socket.on('agent_logs_history', (logs) => setAgentLogs(logs || []));
    socket.on('new_agent_log', (log) => {
      setAgentLogs(prev => [...prev, log].slice(-200));
    });

    socket.emit('get_initial_data');

    return () => {
      socket.off('menu_updated');
      socket.off('categories_updated');
      socket.off('tags_updated');
      socket.off('history_updated');
      socket.off('agent_logs_history');
      socket.off('new_agent_log');
    };
  }, []);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [agentLogs]);

  useEffect(() => {
    if (!editingId) {
      setNewItem(prev => ({
        ...prev,
        category: selectedCategory === 'Все' ? (categories[0] || '') : selectedCategory
      }));
    }
  }, [selectedCategory, categories, editingId]);

  const processImageFile = (file) => {
    return new Promise((resolve) => {
      try {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 500;
            let scaleSize = MAX_WIDTH / img.width;
            if (scaleSize > 1) scaleSize = 1;
            canvas.width = img.width * scaleSize;
            canvas.height = img.height * scaleSize;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
            URL.revokeObjectURL(objectUrl);
            resolve(compressedBase64);
          } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = objectUrl;
      } catch (e) { resolve(null); }
    });
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await processImageFile(file);
    if (base64) setNewItem(prev => ({ ...prev, image: base64 }));
  };

  const handleBulkUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setIsProcessingBulk(true);
    const newProducts = [];
    const newCategoriesSet = new Set();

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const base64 = await processImageFile(file);
      if (base64) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "");
        let itemCategory = "Без категории";
        if (file.webkitRelativePath) {
          const pathParts = file.webkitRelativePath.split('/');
          if (pathParts.length > 1) itemCategory = pathParts[pathParts.length - 2];
        }
        if (!categories.includes(itemCategory)) newCategoriesSet.add(itemCategory);

        newProducts.push({
          id: Date.now() + Math.random(), name: cleanName, price: 0, category: itemCategory,
          image: base64, desc: '', size: '', hasAddons: false, addons: [],
          canBuySlice: false, slicePrice: '', tags: [], isAvailable: true, isHidden: false
        });
      }
    }

    if (newProducts.length > 0) {
      if (newCategoriesSet.size > 0) {
        const updatedCategories = [...categories, ...Array.from(newCategoriesSet)];
        setCategories(updatedCategories);
        socket.emit('update_categories', updatedCategories);
      }
      const updatedMenu = [...menuItems, ...newProducts];
      setMenuItems(updatedMenu);
      socket.emit('update_menu', updatedMenu);
      alert(`✅ Успешно загружено товаров: ${newProducts.length}!`);
    } else {
      alert('Не найдено картинок в выбранной папке.');
    }
    setIsProcessingBulk(false);
    e.target.value = null;
  };

  const showSavedIndicator = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCreateCategory = () => {
    const trimmed = newCatName.trim();
    if (!trimmed) return alert('Введите название новой категории!');
    if (categories.includes(trimmed)) return alert('Такая категория уже существует!');

    const updated = [...categories, trimmed];
    setCategories(updated);
    socket.emit('update_categories', updated);
    setNewCatName('');
    setSelectedCategory(trimmed);
    showSavedIndicator();
  };

  const handleRenameCategory = (oldCat) => {
    const trimmed = editCategoryName.trim();
    if (!trimmed || trimmed === oldCat) return;
    if (categories.includes(trimmed)) return alert('Такая категория уже существует!');

    const updatedCats = categories.map(c => c === oldCat ? trimmed : c);
    setCategories(updatedCats);
    socket.emit('update_categories', updatedCats);

    const updatedMenu = menuItems.map(item =>
      item.category === oldCat ? { ...item, category: trimmed } : item
    );
    setMenuItems(updatedMenu);
    socket.emit('update_menu', updatedMenu);

    setSelectedCategory(trimmed);
    setEditCategoryName('');
    showSavedIndicator();
  };

  const handleDeleteCategory = (catToDelete) => {
    if (!window.confirm(`Удалить категорию "${catToDelete}"?`)) return;
    const updated = categories.filter(c => c !== catToDelete);
    setCategories(updated);
    socket.emit('update_categories', updated);
    setSelectedCategory('Все');
    showSavedIndicator();
  };

  const handleAddTag = () => {
    const trimmed = newTagName.trim();
    if (!trimmed) return alert('Введите название тега!');
    if (tags.includes(trimmed)) return alert('Такой тег уже есть!');
    const updated = [...tags, trimmed];
    setTags(updated);
    socket.emit('update_tags', updated);
    setNewTagName('');
    showSavedIndicator();
  };

  const handleDeleteTag = (tagName) => {
    if (!window.confirm(`Удалить тег "${tagName}"?`)) return;
    const updated = tags.filter(t => t !== tagName);
    setTags(updated);
    socket.emit('update_tags', updated);
    showSavedIndicator();
  };

  const toggleItemTag = (tagName) => {
    setNewItem(prev => {
      const currentTags = prev.tags || [];
      if (currentTags.includes(tagName)) return { ...prev, tags: currentTags.filter(t => t !== tagName) };
      return { ...prev, tags: [...currentTags, tagName] };
    });
  };

  const handleAddAddon = () => {
    if (!currentAddon.name || !currentAddon.price) return;
    setNewItem({ ...newItem, addons: [...newItem.addons, { name: currentAddon.name, price: Number(currentAddon.price) }] });
    setCurrentAddon({ name: '', price: '' });
  };

  const handleRemoveAddon = (index) => {
    const updatedAddons = [...newItem.addons];
    updatedAddons.splice(index, 1);
    setNewItem({ ...newItem, addons: updatedAddons });
  };

  const handleEditClick = (item) => {
    setEditingId(item.id);
    setNewItem({
      name: item.name || '', desc: item.desc || '', size: item.size || '', price: item.price || '',
      category: item.category || categories[0] || '', image: item.image || '',
      hasAddons: !!item.hasAddons, addons: item.addons || [],
      canBuySlice: !!item.canBuySlice, slicePrice: item.slicePrice || '',
      tags: item.tags || [],
      isAvailable: item.isAvailable !== false,
      isHidden: !!item.isHidden
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setNewItem({ ...defaultItemState, category: selectedCategory === 'Все' ? (categories[0] || '') : selectedCategory });
  };

  // 💡 ИСПРАВЛЕННАЯ ЛОГИКА СОХРАНЕНИЯ: ГАРАНТИРУЕТ ДОБАВЛЕНИЕ НОВЫХ ТОВАРОВ
  const handleAddMenuItem = () => {
    if (!newItem.name || newItem.price === '') return alert('Введите название и цену!');
    if (!newItem.category) return alert('Выберите категорию!');

    const isExisting = menuItems.some(i => i.id === editingId);
    const itemId = (editingId && isExisting) 
      ? editingId 
      : (editingId || `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`);

    const itemPayload = {
      ...newItem,
      id: itemId,
      price: Number(newItem.price),
      slicePrice: newItem.canBuySlice ? Number(newItem.slicePrice) : null,
      image: newItem.image || '/images/logo.png',
      tags: newItem.tags || [],
      isAvailable: newItem.isAvailable !== false,
      isHidden: !!newItem.isHidden
    };

    let updatedMenu;
    if (isExisting) {
      // Редактируем старый
      updatedMenu = menuItems.map(i => i.id === editingId ? itemPayload : i);
    } else {
      // 💡 Добавляем НОВЫЙ товар в массив!
      updatedMenu = [...menuItems, itemPayload];
    }

    setMenuItems(updatedMenu);
    socket.emit('update_menu', updatedMenu);

    setEditingId(null);
    setNewItem({ ...defaultItemState, category: selectedCategory === 'Все' ? (categories[0] || '') : selectedCategory });
    showSavedIndicator();
  };

  const handleDeleteItem = (id) => {
    if (!window.confirm('Точно удалить этот товар из базы?')) return;
    const updatedMenu = menuItems.filter(item => item.id !== id);
    setMenuItems(updatedMenu);
    socket.emit('update_menu', updatedMenu);
    if (editingId === id) handleCancelEdit();
    showSavedIndicator();
  };

  const handleClearHistory = () => {
    if (window.confirm('⚠️ ВЫ УВЕРЕНЫ, ЧТО ХОТИТЕ СБРОСИТЬ ВСЮ ИСТОРИЮ ПРОДАЖ?')) {
      socket.emit('clear_history');
    }
  };

  const handleSberSettlement = (kioskId = '1') => {
    if (!window.confirm(`Выполнить сверку итогов для Терминала #${kioskId}?`)) return;
    setIsSettling(true);
    socket.emit('do_sber_settlement', { kioskId: String(kioskId) }, (res) => {
      setIsSettling(false);
      if (res?.success) alert(`✅ Сверка итогов для Терминала #${kioskId} успешно выполнена!`);
      else alert(`❌ Ошибка сверки Терминала #${kioskId}:\n` + (res?.error || res?.message || 'Сбой связи'));
    });
  };

  const fetchTaxcom = () => {
    setLoadingTaxcom(true);
    let answered = false;
    socket.timeout(10000).emit('fetch_taxcom_stats', (err, response) => {
      answered = true;
      setLoadingTaxcom(false);
      if (err) return alert('Сервер не ответил на запрос данных ОФД.');
      if (response?.success) setTaxcomData(response.data);
    });
    setTimeout(() => { if (!answered) setLoadingTaxcom(false); }, 12000);
  };

  const handleExit = () => {
    localStorage.removeItem('TALVI_APP_ROLE');
    window.location.reload();
  };

  // ========================================================
  // 💡 АНАЛИТИКА
  // ========================================================
  const filteredHistory = useMemo(() => {
    const now = new Date();
    const todayStr = now.toLocaleDateString('ru-RU');
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return history.filter(order => {
      const raw = order.timestamp || order.createdAt || order.date || order.addedAt;
      if (!raw) return false;
      const d = new Date(raw);
      if (isNaN(d.getTime())) return false;

      if (statsPeriod === 'today') return d.toLocaleDateString('ru-RU') === todayStr;
      if (statsPeriod === 'month') return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      return true;
    });
  }, [history, statsPeriod]);

  const periodStats = useMemo(() => {
    let totalRev = 0, kioskRev = 0, deliveryRev = 0;
    const itemStatsMap = {};

    filteredHistory.forEach(order => {
      const sum = getOrderAmount(order);
      totalRev += sum;
      
      const isDelivery = order.orderType === 'delivery' || order.kioskId === 'FoodSoul' || order.kioskId === 'MobileApp';
      if (isDelivery) deliveryRev += sum;
      else kioskRev += sum;

      const items = getOrderItems(order);
      items.forEach(item => {
        if (!itemStatsMap[item.name]) itemStatsMap[item.name] = { count: 0, revenue: 0 };
        itemStatsMap[item.name].count += Number(item.quantity) || 1;
        itemStatsMap[item.name].revenue += (Number(item.price) || 0) * (Number(item.quantity) || 1);
      });
    });

    const popularItems = Object.entries(itemStatsMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);

    return { totalRev, kioskRev, deliveryRev, ordersCount: filteredHistory.length, popularItems };
  }, [filteredHistory]);

  const groupedFilteredHistory = useMemo(() => {
    const groups = {};
    const todayStr = new Date().toLocaleDateString('ru-RU');
    const sortedHistory = [...filteredHistory].reverse();
    
    sortedHistory.forEach(order => {
      const rawDate = order.timestamp || order.createdAt || order.date || order.addedAt;
      let dateStr = 'Неизвестная дата';
      
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          const dStr = d.toLocaleDateString('ru-RU');
          dateStr = dStr === todayStr ? `Сегодня (${dStr})` : dStr;
        }
      }
      
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(order);
    });
    
    return Object.entries(groups).map(([date, orders]) => ({ date, orders }));
  }, [filteredHistory]);

  const visibleItems = selectedCategory === 'Все'
    ? menuItems
    : menuItems.filter(item => item.category === selectedCategory);

  return (
    <div className="min-h-screen bg-[#0A1A12] text-white font-sans p-4 sm:p-10 flex flex-col items-center overflow-y-auto custom-scrollbar pb-32">

      {saved && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-6 py-3 rounded-full font-bold shadow-lg z-50 animate-bounce">
          ✅ Успешно сохранено!
        </div>
      )}

      {/* ШАПКА */}
      <div className="w-full max-w-5xl flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-3 h-10 bg-emerald-500 rounded-full"></div>
          <h1 className="text-2xl sm:text-3xl font-bold">Панель Управления</h1>
        </div>
        <button onClick={handleExit} className="bg-white/5 hover:bg-red-500/20 text-white px-6 py-3 rounded-xl font-bold transition-all border border-white/10 hover:border-red-500 cursor-pointer">
          🚪 Выйти
        </button>
      </div>

      {/* ГЛАВНЫЕ НАВИГАЦИОННЫЕ ВКЛАДКИ */}
      <div className="w-full max-w-5xl mb-6">
        <div className="flex gap-2 bg-black/30 p-1.5 rounded-2xl border border-white/10 flex-wrap w-fit">
          {[
            { id: 'menu', label: '🍕 Меню и Товары' },
            { id: 'categories', label: '📁 Категории и Теги' },
            { id: 'history', label: '📊 История и Выручка' },
            { id: 'hardware', label: '🖨 Оборудование' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setNavTab(t.id)}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition cursor-pointer ${
                navTab === t.id ? 'bg-emerald-500 text-white shadow-md' : 'text-white/80 hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full max-w-5xl flex flex-col gap-8">

        {/* 📊 РАЗДЕЛ: ИСТОРИЯ И ВЫРУЧКА */}
        {navTab === 'history' && (
          <div className="bg-[#112A1D] border border-emerald-500/30 rounded-[28px] p-6 shadow-2xl flex flex-col gap-6">
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl font-black text-emerald-400">📈 Учет продаж и аналитика</h2>
              </div>
              
              <div className="flex bg-black/40 rounded-xl p-1 border border-white/5">
                {[
                  { id: 'today', label: 'Сегодня' },
                  { id: 'month', label: 'В этом месяце' },
                  { id: 'all', label: 'За всё время' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setStatsPeriod(p.id)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${statsPeriod === p.id ? 'bg-emerald-600 text-white shadow' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-[#123024] to-[#1A473A] p-4 rounded-2xl border border-emerald-500/30 flex flex-col shadow-lg">
                <span className="text-[10px] text-emerald-300 font-bold uppercase mb-1">Выручка ({statsPeriod === 'today' ? 'сегодня' : statsPeriod === 'month' ? 'за месяц' : 'всего'})</span>
                <span className="text-2xl font-black text-white">{periodStats.totalRev.toLocaleString('ru-RU')} ₽</span>
              </div>

              <div className="bg-black/30 p-4 rounded-2xl border border-white/5 flex flex-col">
                <span className="text-[10px] text-white/50 font-bold uppercase mb-1">Из них: Киоски в зале</span>
                <span className="text-xl font-black text-emerald-400">{periodStats.kioskRev.toLocaleString('ru-RU')} ₽</span>
              </div>

              <div className="bg-black/30 p-4 rounded-2xl border border-white/5 flex flex-col">
                <span className="text-[10px] text-white/50 font-bold uppercase mb-1">Из них: Доставка</span>
                <span className="text-xl font-black text-purple-400">{periodStats.deliveryRev.toLocaleString('ru-RU')} ₽</span>
              </div>

              <div className="bg-black/30 p-4 rounded-2xl border border-white/5 flex flex-col relative">
                <span className="text-[10px] text-white/50 font-bold uppercase mb-1">Количество заказов</span>
                <span className="text-xl font-black text-white">{periodStats.ordersCount} шт.</span>
                
                {history.length > 0 && statsPeriod === 'all' && (
                  <button onClick={handleClearHistory} className="absolute top-2 right-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 p-1.5 rounded-lg text-xs transition-all cursor-pointer" title="Сбросить всю историю">
                    🗑
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-6 border-b border-white/10 mt-2">
              <button 
                onClick={() => setAnalyticsTab('history')} 
                className={`pb-3 font-bold text-sm transition-all border-b-2 cursor-pointer ${analyticsTab === 'history' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-white/50 hover:text-white'}`}
              >
                📋 Журнал заказов
              </button>
              <button 
                onClick={() => setAnalyticsTab('items')} 
                className={`pb-3 font-bold text-sm transition-all border-b-2 cursor-pointer ${analyticsTab === 'items' ? 'border-emerald-400 text-emerald-400' : 'border-transparent text-white/50 hover:text-white'}`}
              >
                📊 Топ блюд (Количество)
              </button>
            </div>

            {analyticsTab === 'history' && (
              <div className="space-y-6 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar relative">
                {groupedFilteredHistory.length === 0 ? (
                  <p className="text-center text-white/30 py-8 italic">За этот период заказов нет.</p>
                ) : (
                  groupedFilteredHistory.map((group) => (
                    <div key={group.date}>
                      <div className="sticky top-0 bg-[#112A1D]/95 backdrop-blur-sm z-10 py-3 border-b border-emerald-500/20 mb-3">
                        <h3 className="text-emerald-400 font-black tracking-widest uppercase text-sm flex items-center gap-2">
                          <span>📅</span> {group.date}
                        </h3>
                      </div>
                      
                      <div className="space-y-3">
                        {group.orders.map((order, i) => {
                          const orderSum = getOrderAmount(order);
                          const orderItems = getOrderItems(order);
                          const isDelivery = order.orderType === 'delivery' || order.kioskId === 'FoodSoul' || order.kioskId === 'MobileApp';

                          return (
                            <div key={order.orderId || i} className="bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-white/10 transition-colors">
                              <div>
                                <div className="flex items-center gap-3 mb-1 flex-wrap">
                                  <span className="font-bold text-lg text-emerald-400">Заказ №{order.orderId ?? '—'}</span>
                                  
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${isDelivery ? 'bg-purple-500/20 text-purple-300' : (order.orderType === 'takeaway' ? 'bg-orange-500/20 text-orange-300' : 'bg-white/10 text-white/70')}`}>
                                    {isDelivery ? '🚚 Доставка' : (order.orderType === 'takeaway' ? '🛍 С собой' : '🍽 В зале')}
                                  </span>
                                  
                                  {order.kioskId && !isDelivery && (
                                    <span className="bg-white/10 px-2 py-0.5 rounded text-[10px] text-white/60 font-mono">
                                      К-{order.kioskId}
                                    </span>
                                  )}

                                  {!isDelivery && order.tableNumber && (
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      String(order.tableNumber).includes('стойки') || String(order.tableNumber).includes('Сам')
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        : 'bg-yellow-500/20 border border-yellow-500/30 text-yellow-300'
                                    }`}>
                                      {typeof order.tableNumber === 'number' ? `Стол №${order.tableNumber}` : order.tableNumber}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-white/50">
                                  {formatOrderTime(order)} • Оплата: {order.paymentMethod === 'sbp' ? '📱 СБП' : (order.paymentMethod === 'online' ? '🌐 Онлайн' : '💳 Карта')}
                                </p>
                                <p className="text-xs text-white/70 mt-2">
                                  {orderItems.length > 0
                                    ? orderItems.map(item => `${item.name} x${item.quantity}`).join(', ')
                                    : 'Состав заказа не сохранен'}
                                </p>
                              </div>
                              <span className={`font-black text-xl whitespace-nowrap ${orderSum > 0 ? 'text-white' : 'text-red-400/70'}`}>
                                {orderSum > 0 ? `${orderSum.toLocaleString('ru-RU')} ₽` : '0 ₽ ⚠️'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {analyticsTab === 'items' && (
              <div className="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {periodStats.popularItems.length === 0 ? (
                  <p className="text-center text-white/30 py-8 italic">За этот период нет проданных блюд.</p>
                ) : (
                  <table className="w-full text-left">
                    <thead className="text-[10px] text-white/50 uppercase border-b border-white/10 sticky top-0 bg-[#112A1D] z-10">
                      <tr>
                        <th className="pb-3 pt-2 pl-2">Название блюда</th>
                        <th className="pb-3 pt-2 text-right">Продано шт.</th>
                        <th className="pb-3 pt-2 text-right pr-2">На сумму</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {periodStats.popularItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition-colors">
                          <td className="py-3 pl-2 font-bold text-sm text-emerald-100">{item.name}</td>
                          <td className="py-3 text-right font-black text-white text-lg">
                            <span className="bg-white/10 px-2 py-1 rounded-lg">{item.count}</span>
                          </td>
                          <td className="py-3 text-right font-black text-emerald-400 pr-2 text-lg">
                            {item.revenue.toLocaleString('ru-RU')} ₽
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}

        {/* 🍕 РАЗДЕЛ: МЕНЮ И ТОВАРЫ */}
        {navTab === 'menu' && (
          <div className="space-y-6 flex-grow">
            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-4 flex flex-wrap justify-between items-center gap-4">
              
              <div className="flex gap-2 overflow-x-auto py-1 hide-scrollbar">
                <button
                  onClick={() => setSelectedCategory('Все')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                    selectedCategory === 'Все' ? 'bg-emerald-500 text-white' : 'bg-white/5 border border-white/10 text-white'
                  }`}
                >
                  Все ({menuItems.length})
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                      selectedCategory === cat ? 'bg-emerald-500 text-white' : 'bg-white/5 border border-white/10 text-white'
                    }`}
                  >
                    {cat} ({menuItems.filter(i => i.category === cat).length})
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <label className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg cursor-pointer transition active:scale-95">
                  <span>📁 Импорт из папки</span>
                  <input type="file" webkitdirectory="" directory="" multiple onChange={handleBulkUpload} className="hidden" />
                </label>

                {/* 💡 КНОПКА ДОБАВЛЕНИЯ ТОВАРА */}
                <button
                  onClick={() => {
                    setEditingId(`item_${Date.now()}`);
                    setNewItem({
                      ...defaultItemState,
                      category: selectedCategory === 'Все' ? (categories[0] || 'Пиццы') : selectedCategory
                    });
                  }}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white px-5 py-2.5 rounded-xl font-black text-sm flex items-center gap-2 shadow-lg cursor-pointer transition active:scale-95"
                >
                  <span>+ Добавить товар</span>
                </button>
              </div>
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {visibleItems.length === 0 ? (
                <p className="text-center text-white/30 py-8 italic">Здесь пока пусто.</p>
              ) : (
                visibleItems.map((item) => {
                  const isItemActive = item.isAvailable !== false && !item.isHidden;
                  return (
                    <div key={item.id} className={`bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-white/10 transition-colors ${!isItemActive ? 'opacity-50 grayscale border-red-500/30' : ''}`}>
                      <div className="flex items-center gap-4 flex-1">
                        <img src={item.image} alt="" className="w-16 h-16 rounded-lg object-cover hidden sm:block bg-black/20 shrink-0 border border-white/10" />
                        <div>
                          <div className="flex flex-wrap gap-2 mb-1 items-center">
                            <span className="font-bold text-lg">{item.name}</span>
                            {!isItemActive && (
                              <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                                ⛔️ Недоступен (Скрыт)
                              </span>
                            )}
                            {selectedCategory === 'Все' && <span className="bg-white/10 px-2 py-0.5 rounded text-[10px] font-bold text-white/70 uppercase">{item.category}</span>}
                            {item.canBuySlice && <span className="text-purple-300 text-[10px] border border-purple-500/30 px-2 py-0.5 rounded font-bold">🍕 КУСОК</span>}
                          </div>
                          <p className="text-xs text-white/50 line-clamp-1">{item.desc}</p>
                        </div>
                      </div>
                      <div className="flex md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-4 md:gap-2">
                        <span className="font-black text-emerald-400 text-xl">{Number(item.price || 0).toLocaleString('ru-RU')} ₽</span>
                        <div className="flex gap-2">
                          <button onClick={() => handleEditClick(item)} className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer">Изменить</button>
                          <button onClick={() => handleDeleteItem(item.id)} className="bg-red-500/20 text-red-300 hover:bg-red-500/40 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer">Удалить</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 📁 РАЗДЕЛ: КАТЕГОРИИ И ТЕГИ */}
        {navTab === 'categories' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-[#112A1D] border border-emerald-500/20 rounded-[24px] p-6 shadow-xl flex flex-col">
              <h2 className="text-xl font-bold text-emerald-400 mb-4 flex items-center gap-2">📁 Категории Меню</h2>
              
              <div className="flex gap-2 mb-4">
                <input 
                  type="text" 
                  value={newCatName} 
                  onChange={(e) => setNewCatName(e.target.value)} 
                  placeholder="Новая категория..." 
                  className="flex-grow bg-black/30 border border-white/20 rounded-xl px-4 py-2 text-white outline-none focus:border-emerald-400" 
                />
                <button onClick={handleCreateCategory} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-2 rounded-xl cursor-pointer">
                  Добавить
                </button>
              </div>

              <div className="space-y-2 overflow-y-auto pr-1">
                {categories.map(cat => (
                  <div key={cat} className="bg-white/5 border border-white/10 p-3 rounded-xl flex justify-between items-center">
                    <span className="font-bold">{cat}</span>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditCategoryName(cat); }} className="text-emerald-400 hover:text-white font-bold text-xs uppercase cursor-pointer">Изменить</button>
                      <button onClick={() => handleDeleteCategory(cat)} className="text-red-400 hover:text-red-300 font-bold text-xs uppercase cursor-pointer">✕</button>
                    </div>
                  </div>
                ))}
              </div>

              {editCategoryName && (
                <div className="mt-4 pt-4 border-t border-white/10 flex gap-2">
                  <input
                    type="text"
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                    className="flex-grow bg-black/40 border border-white/20 rounded-xl px-4 py-2 text-white font-bold outline-none focus:border-emerald-400"
                  />
                  <button onClick={() => handleRenameCategory(editCategoryName)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs uppercase cursor-pointer">
                    Сохранить
                  </button>
                </div>
              )}
            </div>

            <div className="bg-[#112A1D] border border-emerald-500/20 rounded-[24px] p-6 shadow-xl flex flex-col">
              <h2 className="text-xl font-bold text-emerald-400 mb-4 flex items-center gap-2">🏷 Теги (Фильтры)</h2>
              <div className="flex gap-2 mb-4">
                <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Напр. 🌿 Без мяса" className="flex-grow bg-black/30 border border-white/20 rounded-xl px-4 py-2 text-white outline-none focus:border-emerald-400" />
                <button onClick={handleAddTag} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-2 rounded-xl cursor-pointer">+</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => (
                  <div key={tag} className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-2">
                    <span className="font-bold text-sm">#{tag}</span>
                    <button onClick={() => handleDeleteTag(tag)} className="text-red-400 hover:text-red-300 font-bold cursor-pointer">✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 🖨 РАЗДЕЛ: ОБОРУДОВАНИЕ И ЛОГИ */}
        {navTab === 'hardware' && (
          <div className="bg-gradient-to-br from-[#123024] to-[#112A1D] border border-yellow-500/40 rounded-[28px] p-6 shadow-2xl flex flex-col gap-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div>
                <h2 className="text-xl font-bold text-yellow-500 mb-2">💳 Управление терминалами Сбербанка</h2>
                <p className="text-white/60 text-sm leading-snug">
                  Выполняйте сверку итогов раз в сутки перед закрытием смены по каждому пин-паду:
                </p>
              </div>

              <div className="flex flex-wrap gap-3 w-full md:w-auto">
                {['1', '2', '3'].map((kId) => (
                  <button
                    key={kId}
                    onClick={() => handleSberSettlement(kId)}
                    disabled={isSettling}
                    className="flex-1 md:flex-none bg-yellow-600 hover:bg-yellow-500 text-white font-black px-6 py-4 rounded-2xl transition-all shadow-lg shadow-yellow-900/30 disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-wider text-xs cursor-pointer active:scale-95"
                  >
                    {isSettling ? '⏳...' : `🧾 Сверка #${kId}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-black/60 border border-white/10 rounded-2xl p-4 flex flex-col h-[400px]">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Live-логи кассового Агента
                </span>
                <button onClick={() => setAgentLogs([])} className="text-white/40 hover:text-white text-xs cursor-pointer bg-white/10 px-3 py-1 rounded">Очистить окно</button>
              </div>
              <div className="flex-grow overflow-y-auto font-mono text-[11px] bg-black/80 rounded-xl p-3 border border-white/5 custom-scrollbar">
                {agentLogs.length === 0 ? (
                  <div className="text-white/30 italic text-center py-10">Ожидание событий от кассы...</div>
                ) : (
                  agentLogs.map((log, i) => (
                    <div key={i} className={`mb-1 ${log.level === 'error' ? 'text-red-400 font-bold' : (log.level === 'warn' ? 'text-yellow-400' : 'text-emerald-400')}`}>
                      <span className="text-white/30 mr-2">[{log.time}]</span>
                      <span>{log.text}</span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* 🍔 РЕДАКТОР ТОВАРА (Модалка) */}
        {editingId && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-[#064e3b] border border-emerald-500/50 rounded-3xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
              
              <div className="flex justify-between items-center pb-3 border-b border-white/10">
                <h3 className="text-2xl font-black text-emerald-400">
                  {menuItems.some(i => i.id === editingId) ? '✏️ Редактировать блюдо' : '🍔 Новый товар'}
                </h3>
                <button onClick={handleCancelEdit} className="text-white/60 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
              </div>

              <div className="bg-black/20 p-5 rounded-2xl border border-emerald-500/10">
                <div className="flex flex-col sm:flex-row gap-6 mb-6">
                  <div className="shrink-0 flex flex-col items-center gap-3">
                    <div className="w-32 h-32 bg-black/40 border-2 border-dashed border-white/20 rounded-2xl flex items-center justify-center overflow-hidden relative">
                      {newItem.image ? (
                        <>
                          <img src={newItem.image} alt="Preview" className="w-full h-full object-cover" />
                          <button onClick={() => setNewItem({...newItem, image: ''})} className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 font-bold shadow-md cursor-pointer">&times;</button>
                        </>
                      ) : (
                        <span className="text-3xl opacity-30">📷</span>
                      )}
                    </div>
                    <label className="cursor-pointer bg-white/10 hover:bg-white/20 rounded-lg px-4 py-2 text-xs font-bold w-full text-center transition-all">
                      Загрузить фото
                      <input type="file" accept="image/jpeg, image/png, image/webp" className="hidden" onChange={handleImageUpload} />
                    </label>
                  </div>

                  <div className="flex-1 flex flex-col gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <input type="text" placeholder="Название блюда" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500 md:col-span-2 font-bold" />
                      <input type="number" placeholder="Цена (₽)" value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500 font-bold text-emerald-400" />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <select value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})} className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500 appearance-none text-sm">
                        {categories.map((cat, idx) => <option key={idx} value={cat}>{cat}</option>)}
                      </select>
                      <input type="text" placeholder="Размер/Вес (напр. 350 г)" value={newItem.size} onChange={e => setNewItem({...newItem, size: e.target.value})} className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500 text-sm md:col-span-2" />
                    </div>
                    <input type="text" placeholder="Состав / Описание" value={newItem.desc} onChange={e => setNewItem({...newItem, desc: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500 text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-white/10 pt-6">
                  <div>
                    <p className="text-xs text-white/50 mb-3 font-bold uppercase tracking-wider">Навесить теги:</p>
                    <div className="flex flex-wrap gap-2">
                      {tags.map(tag => (
                        <label key={tag} className={`cursor-pointer px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-2 transition-all select-none ${newItem.tags.includes(tag) ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-black/40 border-white/10 text-white/50 hover:border-white/30'}`}>
                          <input type="checkbox" className="hidden" checked={newItem.tags.includes(tag)} onChange={() => toggleItemTag(tag)} />
                          {tag}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="bg-black/30 p-3.5 rounded-xl border border-white/10">
                      <label className="flex items-center gap-3 cursor-pointer text-sm font-bold select-none">
                        <input type="checkbox" checked={newItem.isAvailable !== false} onChange={e => setNewItem({...newItem, isAvailable: e.target.checked})} className="w-5 h-5 accent-emerald-500 rounded cursor-pointer" />
                        <span className={newItem.isAvailable !== false ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                          {newItem.isAvailable !== false ? "🟢 В продаже (В киоске)" : "⛔️ Нет в наличии"}
                        </span>
                      </label>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer text-sm font-bold hover:text-red-400 transition-colors">
                      <input type="checkbox" checked={newItem.isHidden || false} onChange={e => setNewItem({...newItem, isHidden: e.target.checked})} className="w-5 h-5 accent-red-500" />
                      👁️‍🗨️ Скрыть товар из меню
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer text-sm font-bold hover:text-emerald-400 transition-colors">
                      <input type="checkbox" checked={newItem.hasAddons} onChange={e => setNewItem({...newItem, hasAddons: e.target.checked})} className="w-5 h-5 accent-emerald-500" />
                      Доступны добавки (Топпинги)
                    </label>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-3 cursor-pointer text-sm font-bold hover:text-emerald-400 transition-colors">
                        <input type="checkbox" checked={newItem.canBuySlice} onChange={e => setNewItem({...newItem, canBuySlice: e.target.checked, slicePrice: e.target.checked ? newItem.slicePrice : ''})} className="w-5 h-5 accent-emerald-500" />
                        Продавать кусочками
                      </label>
                      {newItem.canBuySlice && (
                        <input type="number" placeholder="Цена (₽)" value={newItem.slicePrice} onChange={e => setNewItem({...newItem, slicePrice: e.target.value})} className="bg-black/40 border border-emerald-500/50 rounded-lg px-3 py-1.5 text-white outline-none focus:border-emerald-400 w-24 text-sm font-bold" />
                      )}
                    </div>
                  </div>
                </div>

                {newItem.hasAddons && (
                  <div className="bg-black/30 border border-emerald-500/20 rounded-xl p-5 mt-6">
                    <h4 className="text-sm font-bold text-emerald-400 mb-4">🧀 Добавки</h4>
                    <div className="flex gap-2 mb-4">
                      <input type="text" placeholder="Название (напр. Сыр)" value={currentAddon.name} onChange={e => setCurrentAddon({...currentAddon, name: e.target.value})} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500 text-sm flex-1" />
                      <input type="number" placeholder="Цена (₽)" value={currentAddon.price} onChange={e => setCurrentAddon({...currentAddon, price: e.target.value})} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500 w-24 text-sm" />
                      <button onClick={handleAddAddon} className="bg-emerald-600/30 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm cursor-pointer">Добавить</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {newItem.addons.map((addon, idx) => (
                        <div key={idx} className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2 font-bold">
                          <span>{addon.name} (+{addon.price}₽)</span>
                          <button onClick={() => handleRemoveAddon(idx)} className="text-red-400 text-base cursor-pointer">&times;</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button onClick={handleAddMenuItem} className="w-full text-white font-black py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-all active:scale-95 shadow-lg text-lg uppercase tracking-wider cursor-pointer">
                💾 Сохранить блюдо
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}