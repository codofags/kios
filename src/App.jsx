import React, { useState, useRef } from 'react';
import useKioskLogic from './useKioskLogic';

const C = { 
  primary: '#1E5343', primaryDark: '#123024', primaryLight: '#FAF6E8', bg: '#123024', bg2: '#1A473A',           
  card: '#FAF6E8', text: '#132B25', muted: '#5F736E', gold: '#DFB972', goldLight: '#ECCB85', goldBorder: '#C9A662'     
};

const GLOBAL_CSS = `
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  .custom-scrollbar::-webkit-scrollbar { width: 6px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); border-radius: 10px; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(223, 185, 114, 0.5); border-radius: 10px; }
  @keyframes simpleFadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
  @keyframes slideUp { 0% { opacity: 0; transform: translateY(50px); } 100% { opacity: 1; transform: translateY(0); } }
  @keyframes goldPulse { 0% { box-shadow: 0 0 0 0 rgba(223, 185, 114, 0.4); } 70% { box-shadow: 0 0 0 60px rgba(223, 185, 114, 0); } 100% { box-shadow: 0 0 0 0 rgba(223, 185, 114, 0); } }
  @keyframes dynamicFly { 0% { transform: translate(var(--startX), var(--startY)) scale(0.5); opacity: 0; } 20% { transform: translate(var(--startX), calc(var(--startY) - 80px)) scale(1.1); opacity: 1; } 100% { transform: translate(var(--targetX), var(--targetY)) scale(0.1); opacity: 0; } }
  .dynamic-flying-item { position: fixed; top: 0; left: 0; width: 100px; height: 100px; border-radius: 50%; object-fit: cover; z-index: 99999; pointer-events: none; box-shadow: 0 20px 40px rgba(0,0,0,0.5); border: 4px solid #DFB972; animation: dynamicFly 0.8s cubic-bezier(0.5, 0, 0.2, 1) forwards; }
  .fade-in { animation: simpleFadeIn 0.4s ease forwards; }
  .slide-up { animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .gold-glow { animation: goldPulse 2s infinite; }
  .glass-glow-active { box-shadow: 0 0 0 1px rgba(223, 185, 114, 0.2), 0 10px 30px rgba(0,0,0,0.4), 0 0 40px rgba(223, 185, 114, 0.35); }
  .press-glow { transition: all 0.1s ease-out; }
  .press-glow:active { background: #DFB972 !important; color: #123024 !important; box-shadow: 0 0 25px #DFB972 !important; border-color: #DFB972 !important; transform: scale(0.95) !important; }
  .press-bright { transition: all 0.1s ease-out; }
  .press-bright:active { filter: brightness(1.4) saturate(1.2) !important; box-shadow: 0 0 40px #DFB972 !important; transform: scale(0.96) !important; }
  .press-red { transition: all 0.1s ease-out; }
  .press-red:active { background: #EF4444 !important; color: #FFFFFF !important; box-shadow: 0 0 25px #EF4444 !important; border-color: #EF4444 !important; transform: scale(0.95) !important; }
`;

function OnboardingScreen({ onStart }) {
  return (
    <div className="h-screen w-full relative font-sans select-none flex flex-col items-center justify-center bg-gradient-to-br from-[#123024] via-[#1A473A] to-[#0E241B]">
      <style>{GLOBAL_CSS}</style>
      <div className="z-50 text-center w-full max-w-4xl px-8 fade-in flex flex-col items-center">
        <div className="mb-12 w-full flex justify-center">
          <img src="/images/logo.png" alt="Деда пицца" className="w-80 h-80 sm:w-[420px] sm:h-[420px] object-cover block mx-auto rounded-full shadow-[0_20px_60px_rgba(0,0,0,0.6)]" />
        </div>
        <h1 className="text-4xl sm:text-6xl font-black text-white tracking-[4px] mb-12 drop-shadow-lg text-center leading-tight uppercase">Где будете есть?</h1>
        <div className="flex flex-col sm:flex-row gap-6 w-full max-w-3xl">
          <button onClick={() => onStart('in_hall')} className="flex-1 bg-gradient-to-br from-[#DFB972] to-[#ECCB85] text-[#123024] py-10 sm:py-14 rounded-[40px] shadow-[0_20px_50px_rgba(223,185,114,0.3)] border-2 border-[#FAF6E8]/30 flex flex-col items-center justify-center gap-4 press-bright hover:scale-105 transition-all duration-300">
            <span className="text-6xl sm:text-7xl drop-shadow-md">🍽️</span><span className="text-3xl sm:text-4xl font-black uppercase tracking-wider">В ЗАЛЕ</span>
          </button>
          <button onClick={() => onStart('takeaway')} className="flex-1 bg-gradient-to-br from-[#1E5343] to-[#14453D] text-[#DFB972] py-10 sm:py-14 rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.4)] border-2 border-[#DFB972]/30 flex flex-col items-center justify-center gap-4 press-bright hover:scale-105 transition-all duration-300">
            <span className="text-6xl sm:text-7xl drop-shadow-md">🛍️</span><span className="text-3xl sm:text-4xl font-black uppercase tracking-wider">С СОБОЙ</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function TableNumberModal({ selectedNumber, onSelect, onClose, onConfirm }) {
  const numbers = Array.from({ length: 50 }, (_, i) => i + 1);

  return (
    <div className="absolute inset-0 z-[120] flex flex-col justify-end bg-black/80 backdrop-blur-md transition-opacity fade-in p-2 sm:p-0">
      <div className="w-full h-[90vh] rounded-[40px] sm:rounded-t-[48px] sm:rounded-b-none relative z-10 flex flex-col slide-up shadow-2xl overflow-hidden border-t-2 border-[#DFB972]/30 text-[#132B25]" style={{ background: 'linear-gradient(180deg, #FAF6E8 0%, #F5EFE0 100%)' }}>
        
        {/* ШАПКА */}
        <div className="flex justify-between items-center px-8 sm:px-10 pt-10 pb-6 border-b border-[#DFB972]/10 shrink-0">
          <div>
            <h2 className="text-3xl sm:text-4xl font-black text-[#132B25]">Где вы будете ожидать?</h2>
            <p className="text-base sm:text-lg font-bold text-[#5F736E] mt-2 uppercase tracking-wide">
              Выберите номерок, заказ принесут за столик
            </p>
          </div>
          <button onClick={onClose} className="w-14 h-14 bg-[#1E5343]/10 rounded-full flex items-center justify-center text-3xl font-bold text-[#1E5343] press-glow cursor-pointer">&times;</button>
        </div>

        {/* СЕТКА НОМЕРКОВ (1-50) */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-8 custom-scrollbar">
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-3">
            {numbers.map(num => (
              <button
                key={num}
                onClick={() => onSelect(selectedNumber === num ? null : num)}
                className={`h-16 sm:h-20 rounded-2xl text-xl sm:text-2xl font-black transition-all press-glow flex items-center justify-center border-2 ${
                  selectedNumber === num 
                    ? 'bg-[#1E5343] border-[#DFB972] text-[#FAF6E8] scale-105 shadow-lg' 
                    : 'bg-white border-[#DFB972]/20 text-[#132B25] hover:bg-[#DDF7F0]'
                }`}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        {/* УМНАЯ КНОПКА В ПОДВАЛЕ */}
        <div className="p-8 sm:p-10 bg-[#FAF6E8] border-t border-[#DFB972]/20 shrink-0 flex gap-4">
          <button 
            onClick={() => {
              if (!selectedNumber) onSelect(null);
              onConfirm();
            }}
            className={`w-full h-20 sm:h-24 rounded-[28px] sm:rounded-[32px] font-black text-2xl sm:text-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex items-center justify-center gap-4 press-bright transition-all duration-300 cursor-pointer ${
              selectedNumber 
                ? 'bg-gradient-to-r from-[#DFB972] to-[#ECCB85] text-[#123024]' 
                : 'bg-[#1E5343] text-white'
            }`}
          >
            {selectedNumber ? (
              <span>ПРОДОЛЖИТЬ (СТОЛ №{selectedNumber})</span>
            ) : (
              <>
                <span className="text-3xl sm:text-4xl">🥡</span>
                <span>ЗАБЕРУ ЗАКАЗ САМ У СТОЙКИ</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductCustomizerModal({ item, onClose, onAdd }) {
  const [isSlice, setIsSlice] = useState(false);
  const [selectedAddons, setSelectedAddons] = useState([]);
  const basePrice = isSlice ? (item.slicePrice || 0) : (item.price || 0);
  const addonsTotal = selectedAddons.reduce((sum, a) => sum + (a.price || 0), 0);
  const totalPrice = basePrice + addonsTotal;

  const toggleAddon = (addon) => setSelectedAddons(prev => prev.some(a => a.name === addon.name) ? prev.filter(a => a.name !== addon.name) : [...prev, addon]);

  const handleConfirm = (e) => {
    onAdd(item, isSlice, selectedAddons, e);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[100] flex flex-col justify-end bg-black/75 backdrop-blur-md transition-opacity fade-in p-4 sm:p-0">
      <div className="w-full max-h-[85vh] rounded-[40px] sm:rounded-t-[48px] sm:rounded-b-none relative z-10 flex flex-col slide-up shadow-[0_-20px_60px_rgba(0,0,0,0.5)] overflow-hidden border-t-2 border-[#DFB972]/30 text-[#132B25]" style={{ background: 'linear-gradient(180deg, #FAF6E8 0%, #F5EFE0 100%)' }}>
        <div className="flex justify-between items-center px-8 sm:px-10 pt-8 pb-6 border-b border-[#DFB972]/20 shrink-0">
          <div><h2 className="text-3xl sm:text-4xl font-black text-[#132B25]">{item.name}</h2><p className="text-sm text-[#5F736E] mt-1">{item.desc}</p></div>
          <button onClick={onClose} className="w-14 h-14 bg-[#1E5343]/10 rounded-full flex items-center justify-center text-3xl text-[#1E5343] font-bold border border-[#1E5343]/20 press-glow cursor-pointer">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto px-8 sm:px-10 py-6 space-y-8 hide-scrollbar">
          <div className="w-full h-48 flex items-center justify-center mb-4"><img src={item.image} className="max-h-full object-contain drop-shadow-2xl rounded-2xl" alt="" /></div>
          {item.canBuySlice && (
            <div>
              <p className="text-xs font-bold text-[#5F736E] mb-3 uppercase tracking-wider">Выберите формат</p>
              <div className="flex bg-[#F5EFE0] rounded-2xl p-1.5 w-full border border-[#DFB972]/20 gap-2">
                <button onClick={() => setIsSlice(false)} className={`flex-1 py-4 rounded-xl text-base font-black press-glow border transition-all ${!isSlice ? 'bg-gradient-to-r from-[#DFB972] to-[#ECCB85] text-[#123024] shadow-md border-[#DFB972]/50' : 'bg-white/50 border-white/60 text-[#5F736E]'}`}>🍕 Целая ({item.price} ₽)</button>
                <button onClick={() => setIsSlice(true)} className={`flex-1 py-4 rounded-xl text-base font-black press-glow border transition-all ${isSlice ? 'bg-gradient-to-r from-[#DFB972] to-[#ECCB85] text-[#123024] shadow-md border-[#DFB972]/50' : 'bg-white/50 border-white/60 text-[#5F736E]'}`}>🍰 Кусочек ({item.slicePrice} ₽)</button>
              </div>
            </div>
          )}
          {item.hasAddons && item.addons && item.addons.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[#5F736E] mb-3 uppercase tracking-wider">Добавить к заказу</p>
              <div className="grid grid-cols-2 gap-3">
                {item.addons.map((addon, idx) => {
                  const isSelected = selectedAddons.some(a => a.name === addon.name);
                  return (
                    <button key={idx} onClick={() => toggleAddon(addon)} className={`p-4 rounded-2xl border text-sm font-bold press-glow text-center flex justify-between items-center transition-all ${isSelected ? 'bg-[#1E5343] border-[#DFB972] text-[#FAF6E8] font-black shadow-lg shadow-black/10' : 'bg-[#FAF6E8] border-[#DFB972]/20 text-[#132B25]'}`}>
                      <span>{addon.name}</span><span className={`${isSelected ? 'text-[#DFB972]' : 'text-[#1E5343]'}`}>+{addon.price} ₽</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="p-8 sm:p-10 bg-[#FAF6E8] border-t border-[#DFB972]/20 shrink-0">
          <button onClick={handleConfirm} className="w-full h-20 rounded-[28px] font-black text-2xl text-[#123024] bg-gradient-to-r from-[#DFB972] to-[#ECCB85] shadow-[0_15px_40px_rgba(223,185,114,0.4)] flex items-center justify-between px-10 border border-[#FAF6E8]/30 press-bright transition-transform hover:scale-[1.02] cursor-pointer">
            <span>ДОБАВИТЬ В КОРЗИНУ</span><span className="bg-[#123024]/10 px-6 py-2 rounded-2xl">{totalPrice} ₽</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuScreen({ kiosk, onOpenCustomizer }) {
  const cartBtnRef = useRef(null);

  const getCategoryIcon = (cat) => {
    const clean = cat.trim().toLowerCase();
    if (clean.includes('пицца')) return '🍕';
    if (clean.includes('суп')) return '🥣';
    if (clean.includes('салат')) return '🥗';
    if (clean.includes('втор') || clean.includes('горяч') || clean.includes('блюд') || clean.includes('мясо')) return '🍛';
    if (clean.includes('десерт') || clean.includes('сладк') || clean.includes('торт') || clean.includes('пирог')) return '🍰';
    if (clean.includes('напит') || clean.includes('сок') || clean.includes('коф') || clean.includes('чай')) return '🥤';
    if (clean.includes('закуск') || clean.includes('фри')) return '🍟';
    return '🍽'; 
  };

  const triggerFlyAnimation = (image, event) => {
    if (!event) return;
    const startRect = event.currentTarget.getBoundingClientRect();
    const targetEl = document.getElementById('cart-button-target');
    let targetX = window.innerWidth - 100;
    let targetY = window.innerHeight - 80;
    if (targetEl) {
      const targetRect = targetEl.getBoundingClientRect();
      targetX = targetRect.left + targetRect.width / 2 - 50;
      targetY = targetRect.top + targetRect.height / 2 - 50;
    }
    
    const flyingImg = document.createElement('img');
    flyingImg.src = image;
    flyingImg.className = 'dynamic-flying-item';
    flyingImg.style.setProperty('--startX', `${startRect.left + startRect.width / 2 - 50}px`);
    flyingImg.style.setProperty('--startY', `${startRect.top - 20}px`);
    flyingImg.style.setProperty('--targetX', `${targetX}px`);
    flyingImg.style.setProperty('--targetY', `${targetY}px`);
    document.body.appendChild(flyingImg);
    
    setTimeout(() => flyingImg.remove(), 800);
  };

  const handleOpenCustomizerLocal = (item, event) => {
    if (item.canBuySlice || (item.hasAddons && item.addons && item.addons.length > 0)) {
      onOpenCustomizer(item, event);
    } else {
      kiosk.addToCart(item, false, []);
      triggerFlyAnimation(item.image, event); 
    }
  };

  return (
    <div className="h-screen w-full font-sans select-none relative flex bg-gradient-to-br from-[#123024] via-[#1A473A] to-[#0E241B] overflow-hidden text-white">
      <style>{GLOBAL_CSS}</style>
      
      {/* 💡 АККУРАТНЫЙ УМЕНЬШЕННЫЙ В 3 РАЗА ПОЛУПРОЗРАЧНЫЙ СЧЕТЧИК */}
      {kiosk.idleResetInSeconds && (
        <div className="absolute top-2 right-4 z-50 bg-black/20 backdrop-blur-sm border border-white/10 text-white/40 px-2.5 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1 pointer-events-none shadow-sm transition-opacity">
          <span className="opacity-60 text-xs">⏳</span>
          <span>{kiosk.idleResetInSeconds}с</span>
        </div>
      )}

      <div className="w-[130px] sm:w-[160px] h-full flex flex-col items-center pt-8 pb-[140px] bg-black/20 backdrop-blur-xl border-r border-white/10 shrink-0 z-20 overflow-y-auto hide-scrollbar">
        <div className="mb-6 px-4">
          <img src="/images/logo.png" alt="Лого" className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover shadow-[0_10px_25px_rgba(0,0,0,0.5)] border-2 border-[#DFB972]/80" />
        </div>
        <div className="flex flex-col gap-2 w-full px-2 sm:px-3">
          {kiosk.categories.map((cat) => {
            const isActive = kiosk.activeCategory === cat.key;
            return (
              <button key={cat.key} onClick={() => kiosk.setActiveCategory(cat.key)} className={`flex flex-col items-center justify-center w-full py-4 px-1 rounded-[24px] press-glow transition-all duration-300 border ${isActive ? 'bg-gradient-to-br from-[#DFB972] to-[#ECCB85] text-[#123024] glass-glow-active font-black border-[#FAF6E8]/30 shadow-md scale-105' : 'bg-black/20 border-white/5 text-white/70 hover:bg-white/10 hover:text-white'}`}>
                <div className="text-3xl sm:text-4xl drop-shadow-md mb-2">{getCategoryIcon(cat.key)}</div>
                <span className="text-[10px] sm:text-xs tracking-wider uppercase font-bold text-center leading-tight">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full relative">
        {kiosk.tagsList.length > 0 && (
          <div className="px-6 pt-8 pb-4 flex gap-3 overflow-x-auto hide-scrollbar shrink-0 z-20">
            <button onClick={() => kiosk.setActiveTag(null)} className={`px-6 py-2.5 rounded-full text-xs sm:text-sm font-bold shadow-[0_5px_15px_rgba(0,0,0,0.2)] press-glow shrink-0 border transition-all ${!kiosk.activeTag ? 'bg-[#13B08A] border-[#13B08A] text-white' : 'bg-white/10 backdrop-blur-md border-white/20 text-white/80 hover:bg-white/20'}`}>ВСЕ</button>
            {kiosk.tagsList.map(tag => (
              <button key={tag} onClick={() => kiosk.setActiveTag(tag)} className={`px-6 py-2.5 rounded-full text-xs sm:text-sm font-bold shadow-[0_5px_15px_rgba(0,0,0,0.2)] press-glow shrink-0 border transition-all ${kiosk.activeTag === tag ? 'bg-gradient-to-r from-[#DFB972] to-[#ECCB85] border-[#DFB972]/50 text-[#123024]' : 'bg-white/10 backdrop-blur-md border-white/20 text-white hover:bg-white/20'}`}>{tag}</button>
            ))}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto custom-scrollbar px-6 pb-[180px] relative z-10 ${kiosk.tagsList.length === 0 ? 'pt-8' : 'pt-2'}`}>
          {kiosk.filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/50"><span className="text-6xl mb-4">🔍</span><p className="text-xl font-bold">Ничего не найдено</p></div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mt-2">
              {kiosk.filteredItems.map((item) => {
                const isAvailable = item.isAvailable !== false;
                return (
                  <div key={item.id} className={`bg-[#FAF6E8] border border-[#DFB972]/20 rounded-[28px] sm:rounded-[36px] shadow-[0_15px_30px_rgba(0,0,0,.3)] overflow-hidden flex flex-col p-3 text-[#132B25] transition-all duration-300 ${!isAvailable ? 'opacity-60 grayscale-[50%] pointer-events-none' : 'hover:-translate-y-1 hover:shadow-[0_20px_40px_rgba(0,0,0,.4)]'}`}>
                    <div className="w-full aspect-square relative flex items-center justify-center p-2 bg-black/5 rounded-[20px] overflow-hidden">
                      <img src={item.image} className="w-full h-full object-cover rounded-xl transition-transform duration-500 hover:scale-105" alt={item.name} loading="lazy" />
                      {(item.badge || item.canBuySlice) && (
                        <div className="absolute top-2 left-2 z-20 flex flex-col gap-1 items-start">
                          {item.tags && item.tags.slice(0,2).map(tag => <span key={tag} className="bg-gradient-to-r from-[#E6C068] to-[#D4AF37] text-[#17332D] px-3 py-1 rounded-full text-[10px] font-black uppercase shadow-lg border border-[#E6C068]/50 inline-block">{tag}</span>)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col flex-1 px-1 sm:px-2 pb-1 pt-3 text-[#132B25]">
                      <h3 className="text-sm sm:text-lg font-black leading-tight mb-1 sm:mb-2 line-clamp-2">{item.name}</h3>
                      {item.desc && <p className="text-[11px] sm:text-xs text-[#5F736E] leading-snug mb-3 line-clamp-2">{item.desc}</p>}
                      <div className="mt-auto pt-3 border-t border-[#DFB972]/15 flex flex-col xl:flex-row justify-between items-center gap-2">
                        <span className="text-base sm:text-xl font-black">{item.canBuySlice ? `от ${item.slicePrice}` : item.price} ₽</span>
                        {isAvailable ? (
                          <button onClick={(e) => handleOpenCustomizerLocal(item, e)} className="w-full xl:w-auto bg-[#1E5343] text-[#FAF6E8] px-4 py-2.5 sm:py-3 rounded-full text-[10px] sm:text-xs font-black uppercase press-glow shadow-md cursor-pointer">
                            ВЫБРАТЬ
                          </button>
                        ) : (
                          <div className="w-full xl:w-auto bg-gray-500 text-white px-4 py-2.5 sm:py-3 rounded-full text-[9px] sm:text-[10px] font-black uppercase text-center shadow-inner">ЗАКОНЧИЛОСЬ</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-40 bg-[#123024]/95 backdrop-blur-2xl shadow-[0_-15px_50px_rgba(0,0,0,.5)] border-t border-white/10 rounded-t-[32px] sm:rounded-t-[40px]">
        <div className="flex items-center justify-between gap-4 sm:gap-6 px-6 sm:px-10 py-5 sm:py-6 max-w-6xl mx-auto h-[100px] sm:h-[120px]">
          <div className="w-[140px] sm:w-[220px] shrink-0 h-full flex items-center justify-start">
            {kiosk.cart.length > 0 && (
              <button onClick={kiosk.clearCart} className="w-full h-full bg-red-500/10 text-red-400 border border-red-500/30 rounded-[24px] flex items-center justify-center gap-2 sm:gap-3 press-red shadow-inner cursor-pointer">
                <span className="text-xl sm:text-2xl">🗑️</span><span className="text-[10px] sm:text-sm font-black uppercase tracking-wider">Очистить</span>
              </button>
            )}
          </div>
          <div className="hidden sm:flex flex-col items-center justify-center flex-1">
            <span className="text-xl lg:text-2xl font-black text-white/90">{kiosk.cart.length === 0 ? 'Корзина пуста' : `${kiosk.totalPrice} ₽`}</span>
          </div>
          <button id="cart-button-target" onClick={() => kiosk.setIsCartModalOpen(true)} disabled={kiosk.cart.length === 0} className="flex-1 sm:flex-none sm:w-[260px] lg:w-[320px] h-full bg-gradient-to-r from-[#DFB972] to-[#ECCB85] text-[#123024] border border-[#FAF6E8]/20 rounded-[28px] flex items-center justify-center px-4 shadow-[0_15px_40px_rgba(223,185,114,0.4)] disabled:opacity-30 disabled:grayscale font-black uppercase tracking-wider text-xs sm:text-sm lg:text-base text-center leading-tight press-bright cursor-pointer">
            {kiosk.cart.length === 0 ? 'ПЕРЕЙТИ В КОРЗИНУ' : `КОРЗИНА • ${kiosk.totalPrice} ₽`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CartSheet({ cart, totalPrice, onClose, onUpdateQuantity, onOpenTableModal }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-md transition-opacity fade-in p-2 sm:p-0">
      <div className="w-full h-[92vh] sm:h-[90vh] rounded-[40px] sm:rounded-t-[48px] sm:rounded-b-none relative z-10 flex flex-col slide-up shadow-[0_-20px_60px_rgba(0,0,0,0.5)] border-t border-[#DFB972]/20" style={{ background: 'linear-gradient(180deg, #FAF6E8 0%, #F5EFE0 100%)' }}>
        <div className="flex justify-between items-center px-8 sm:px-10 pt-10 pb-6 shrink-0 border-b border-[#DFB972]/10">
          <h2 className="text-4xl sm:text-[44px] font-black text-[#132B25]">Ваш заказ</h2>
          <button onClick={onClose} className="w-14 h-14 bg-[#1E5343]/10 rounded-full flex items-center justify-center text-3xl font-bold text-[#1E5343] press-glow cursor-pointer">&times;</button>
        </div>
        
        <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-6 space-y-4 hide-scrollbar">
          {cart.map((item) => (
            <div key={item.id} className="flex items-center gap-4 sm:gap-6 bg-white p-4 rounded-[32px] shadow-sm border border-[#DFB972]/15 text-[#132B25]">
              <div className="w-20 h-20 sm:w-28 sm:h-28 shrink-0 flex items-center justify-center bg-[#FAF6E8] border border-[#DFB972]/10 rounded-2xl p-1 overflow-hidden">
                <img src={item.image} className="w-full h-full object-cover rounded-lg" alt="" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg sm:text-2xl font-black leading-tight">{item.name}</h3>
                {item.isSlice && <p className="text-xs sm:text-sm font-bold text-[#DFB972] mt-1 uppercase tracking-wider">Кусочек</p>}
                <p className="text-[#1E5343] font-black text-xl sm:text-2xl mt-1 sm:mt-2">{item.price} ₽</p>
              </div>
              <div className="flex flex-col sm:flex-row items-center bg-[#FAF6E8] rounded-[24px] p-1.5 sm:p-2 gap-2 sm:gap-4 shrink-0 border border-[#DFB972]/20">
                <button onClick={() => onUpdateQuantity(item.id, -1)} className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-3xl sm:text-4xl font-medium text-[#1E5343] press-glow rounded-full mb-1 sm:mb-2 cursor-pointer">−</button>
                <span className="w-8 text-center text-xl sm:text-2xl font-black">{item.quantity}</span>
                <button onClick={() => onUpdateQuantity(item.id, 1)} className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-3xl sm:text-4xl font-medium text-[#1E5343] press-glow rounded-full mb-1 sm:mb-2 cursor-pointer">+</button>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white/60 backdrop-blur-xl p-8 sm:p-10 pb-10 sm:pb-12 shrink-0 border-t border-[#DFB972]/25 rounded-b-[40px] sm:rounded-b-none">
          <button 
            onClick={onOpenTableModal}
            className="w-full h-20 sm:h-24 rounded-[28px] sm:rounded-[32px] font-black text-2xl sm:text-3xl text-[#123024] bg-gradient-to-r from-[#DFB972] to-[#ECCB85] shadow-[0_20px_50px_rgba(223,185,114,0.4)] border border-[#FAF6E8]/30 flex items-center justify-center gap-4 press-bright hover:scale-[1.02] transition-transform cursor-pointer"
          >
            <span>ПЕРЕЙТИ К ОПЛАТЕ</span>
            <span className="bg-[#123024]/10 px-6 py-2 rounded-2xl">{totalPrice} ₽</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentMethodModal({ totalPrice, onSelectMethod, onClose, printPaperReceipt, setPrintPaperReceipt }) {
  return (
    <div className="absolute inset-0 z-[130] flex flex-col justify-end bg-black/80 backdrop-blur-md transition-opacity fade-in p-2 sm:p-0">
      <div className="w-full rounded-[40px] sm:rounded-t-[48px] relative z-10 flex flex-col slide-up shadow-2xl overflow-hidden border-t-2 border-[#DFB972]/30 text-[#132B25] p-8 sm:p-10" style={{ background: 'linear-gradient(180deg, #FAF6E8 0%, #F5EFE0 100%)' }}>
        
        <div className="flex justify-between items-center pb-6 border-b border-[#DFB972]/10 mb-6">
          <h2 className="text-3xl sm:text-4xl font-black text-[#132B25]">Оплата заказа ({totalPrice} ₽)</h2>
          <button onClick={onClose} className="w-12 h-12 bg-[#1E5343]/10 rounded-full flex items-center justify-center text-2xl font-bold text-[#1E5343] press-glow cursor-pointer">&times;</button>
        </div>

        <div className="mb-8">
          <p className="text-xs sm:text-sm font-bold text-[#5F736E] mb-3 uppercase tracking-widest">Способ получения чека</p>
          <div className="flex bg-[#F5EFE0] rounded-2xl p-1.5 w-full border border-[#DFB972]/20 gap-2 shadow-inner">
            <button onClick={() => setPrintPaperReceipt(true)} className={`flex-1 py-4 rounded-xl text-sm sm:text-base font-bold press-glow transition-all cursor-pointer ${printPaperReceipt ? 'bg-gradient-to-r from-[#DFB972] to-[#ECCB85] text-[#123024] shadow-md border border-[#FAF6E8]/30' : 'text-[#5F736E]'}`}>Бумажный чек</button>
            <button onClick={() => setPrintPaperReceipt(false)} className={`flex-1 py-4 rounded-xl text-sm sm:text-base font-bold press-glow transition-all cursor-pointer ${!printPaperReceipt ? 'bg-gradient-to-r from-[#DFB972] to-[#ECCB85] text-[#123024]' : 'text-[#5F736E]'}`}>Электронный (QR)</button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full">
          <button onClick={() => onSelectMethod('card')} className="flex-1 h-20 sm:h-24 rounded-[28px] font-black text-xl sm:text-2xl text-[#123024] bg-gradient-to-r from-[#DFB972] to-[#ECCB85] shadow-[0_20px_50px_rgba(223,185,114,0.4)] border border-[#FAF6E8]/30 flex flex-col items-center justify-center press-bright cursor-pointer">
            <span>💳 ОПЛАТИТЬ КАРТОЙ</span>
          </button>
          <button onClick={() => onSelectMethod('sbp')} className="flex-1 h-20 sm:h-24 rounded-[28px] font-black text-xl sm:text-2xl text-white bg-gradient-to-r from-[#1E5343] to-[#14453D] shadow-[0_20px_50px_rgba(30,83,67,0.4)] border border-[#DFB972]/30 flex flex-col items-center justify-center press-bright cursor-pointer">
            <span>📱 ОПЛАТИТЬ ПО СБП</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SBPScreen({ totalPrice, sbpQrString, onCancel }) {
  const qrUrl = sbpQrString ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(sbpQrString)}` : '';

  return (
    <div className="h-screen w-full font-sans select-none bg-gradient-to-br from-[#123024] via-[#1A473A] to-[#0E241B] flex flex-col items-center justify-center px-6 fade-in">
      <style>{GLOBAL_CSS}</style>
      <div className="text-center w-full max-w-md flex flex-col items-center">
        <h2 className="text-4xl md:text-5xl font-black text-white mb-2 tracking-wide">Оплата по СБП</h2>
        <p className="text-[#E6C068] font-bold tracking-[6px] uppercase mb-10">Отсканируйте код</p>
        
        <div className="bg-white p-4 rounded-[40px] shadow-[0_15px_50px_rgba(223,185,114,0.3)] mb-10 border-4 border-[#DFB972]/50 glass-glow-active">
          {qrUrl ? (
            <img src={qrUrl} alt="QR СБП" className="w-64 h-64 rounded-2xl" />
          ) : (
            <div className="w-64 h-64 flex items-center justify-center text-[#1E5343] animate-pulse font-bold text-xl">
              Запрашиваем код...
            </div>
          )}
        </div>
        
        <p className="text-6xl sm:text-7xl font-black text-white mb-4 drop-shadow-lg">{totalPrice} ₽</p>
        <p className="text-[#DDF7F0] text-sm sm:text-base font-bold mb-10 opacity-80 uppercase tracking-widest text-center">
          Откройте приложение банка<br/>и наведите камеру
        </p>

        <button onClick={onCancel} className="mt-4 text-white/50 text-xl font-black uppercase tracking-wider hover:text-white transition-colors border-b-2 border-transparent hover:border-white/50 pb-1 cursor-pointer">
          ✕ Отменить оплату
        </button>
      </div>
    </div>
  );
}

function NFCScreen({ totalPrice, onCancel }) {
  return (
    <div className="h-screen w-full font-sans select-none bg-gradient-to-br from-[#123024] via-[#1A473A] to-[#0E241B] flex flex-col items-center justify-center px-6 fade-in">
      <style>{GLOBAL_CSS}</style>
      <div className="text-center w-full max-w-md flex flex-col items-center">
        <h2 className="text-4xl md:text-5xl font-black text-white mb-2 tracking-wide">Оплата картой</h2>
        <img src="/images/logo.png" alt="Деда Пицца" className="w-24 h-24 rounded-full object-cover mb-16 shadow-lg border-2 border-[#DFB972]/30" />
        
        <div className="relative w-48 h-48 mx-auto mb-16 bg-gradient-to-br from-[#DFB972] to-[#ECCB85] rounded-[48px] flex items-center justify-center shadow-[0_10px_40px_rgba(223,185,114,0.5)] nfc-glow glass-glow-active">
          <svg className="w-24 h-24 text-[#123024]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="3" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
        </div>
        <p className="text-6xl sm:text-7xl font-black text-white mb-4 drop-shadow-lg">{totalPrice} ₽</p>
        <p className="text-[#DDF7F0] text-lg sm:text-xl font-bold mb-10 opacity-80 uppercase tracking-widest">Приложите карту к терминалу</p>
        
        <button onClick={onCancel} className="mt-8 text-white/50 text-xl font-black uppercase tracking-wider hover:text-white transition-colors border-b-2 border-transparent hover:border-white/50 pb-1 cursor-pointer">
          ✕ Отменить оплату
        </button>
      </div>
    </div>
  );
}

function ProcessingScreen() {
  return (
    <div className="h-screen w-full font-sans select-none bg-gradient-to-br from-[#123024] via-[#1A473A] to-[#0E241B] flex items-center justify-center px-6 fade-in">
      <style>{GLOBAL_CSS}</style>
      <div className="text-center">
        <div className="w-24 h-24 sm:w-32 sm:h-32 mx-auto mb-10 text-[#DFB972]">
          <svg className="animate-spin w-full h-full drop-shadow-[0_0_20px_rgba(223,185,114,0.5)]" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2.5" strokeDasharray="32" className="opacity-20" /><circle cx="12" cy="12" r="10" strokeWidth="2.5" strokeDasharray="32" className="opacity-100" strokeLinecap="round" /></svg>
        </div>
        <h2 className="text-2xl sm:text-4xl font-black text-white tracking-[6px] drop-shadow-md">ГОТОВИМ ЗАКАЗ...</h2>
      </div>
    </div>
  );
}

function SuccessScreen({ orderId, tableNumber, printerWarning, kioskId }) {
  const tableStr = String(tableNumber || '');
  const isTable = tableNumber && !tableStr.includes('стойки') && !tableStr.includes('Сам');

  return (
    <div className="h-screen w-full font-sans select-none bg-gradient-to-br from-[#123024] via-[#1A473A] to-[#0E241B] flex flex-col items-center justify-center px-8 fade-in relative">
      <style>{GLOBAL_CSS}</style>
      
      {printerWarning && (
        <div className="absolute top-10 bg-yellow-500 text-black px-6 py-3 rounded-2xl font-bold shadow-xl flex items-center gap-3 animate-bounce">
          <span className="text-2xl">⚠️</span>
          {printerWarning.message || 'Лента закончилась. Заказ уже на кухне, сотрудник выдаст чек позже.'}
        </div>
      )}

      <div className="text-center w-full max-w-lg shrink-0 flex flex-col items-center mt-10">
        <div className="w-28 h-28 sm:w-36 sm:h-36 mx-auto mb-10 bg-gradient-to-br from-[#DFB972] to-[#ECCB85] rounded-full flex items-center justify-center shadow-[0_10px_40px_rgba(223,185,114,0.5)] glass-glow-active">
          <svg className="w-14 h-14 sm:w-16 sm:h-16 text-[#123024]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <h2 className="text-5xl sm:text-6xl font-black text-white mb-2 drop-shadow-lg">ЗАКАЗ ПРИНЯТ</h2>
        <p className="text-[#DFB972] font-black tracking-[6px] sm:tracking-[10px] uppercase mb-12">ОЖИДАЙТЕ ГОТОВНОСТИ</p>
        
        <div className="bg-[#FAF6E8] border-2 border-[#DFB972]/30 rounded-[48px] px-10 sm:px-16 py-10 sm:py-12 w-full shadow-[0_30px_60px_rgba(0,0,0,0.6)] text-[#132B25] flex flex-col items-center justify-center relative">
          
          <div className="absolute top-4 right-6 text-gray-400 font-bold font-mono text-sm">
            КИОСК {kioskId}
          </div>

          <p className="text-lg sm:text-2xl font-bold uppercase tracking-widest opacity-60 mb-2">ВАШ НОМЕР</p>
          <p className="text-[90px] sm:text-[120px] font-black leading-none drop-shadow-md mb-6">{orderId || '...'}</p>
          
          {tableNumber && (
            <div className={`px-6 py-2 rounded-2xl text-xl font-bold uppercase tracking-wider ${
              isTable ? 'bg-[#1E5343] text-white' : 'bg-emerald-600 text-white'
            }`}>
              {isTable ? `🍽 СТОЛИК / НОМЕРОК №${tableNumber}` : '🥡 ЗАБЕРЕТЕ У СТОЙКИ САМИ'}
            </div>
          )}
        </div>
        
        <p className="text-white/50 text-sm mt-10 font-bold uppercase tracking-widest animate-pulse">
          Экран обновится автоматически
        </p>
      </div>
    </div>
  );
}

// =========================================================
// 🚀 ОСНОВНОЙ КОМПОНЕНТ КИОСКА
// =========================================================
export default function App() {
  const kiosk = useKioskLogic();
  const [activeProductForCustomizer, setActiveProductForCustomizer] = useState(null);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  if (kiosk.globalError) {
    return (
      <div className="h-screen w-full relative overflow-hidden font-sans select-none bg-[#123024]">
        <style>{GLOBAL_CSS}</style>
        <div className="absolute inset-0 z-[999] bg-[#123024]/90 backdrop-blur-md flex items-center justify-center p-6 fade-in">
          <div className="bg-[#FAF6E8] border-2 border-[#DFB972]/30 rounded-[40px] p-10 max-w-lg w-full text-center shadow-2xl text-[#132B25]">
            <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-8 text-5xl">
              {kiosk.globalError.icon || '⚠️'}
            </div>
            <h2 className="text-3xl font-black mb-4">{kiosk.globalError.title || 'Извините, сбой'}</h2>
            <p className="text-[#1E5343] text-lg mb-8 font-bold leading-snug">
              {kiosk.globalError.message || 'Оплата отменена клиентом или терминалом.'}
            </p>
            <p className="text-[#5F736E] text-xs font-mono mb-8 bg-black/5 p-2 rounded-lg break-words">
              {kiosk.globalError.raw || 'Код ошибки неизвестен'}
            </p>
            <button 
              onClick={() => {
                kiosk.dismissGlobalError();
                kiosk.resetKiosk();
              }} 
              className="w-full py-4 bg-gradient-to-r from-[#DFB972] to-[#ECCB85] text-[#123024] font-black rounded-2xl text-xl shadow-lg active:scale-95 transition cursor-pointer"
            >
              Вернуться на главный экран
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleOpenCustomizer = (item, event) => {
    if (item.canBuySlice || (item.hasAddons && item.addons && item.addons.length > 0)) {
      setActiveProductForCustomizer(item);
    } else {
      kiosk.addToCart(item, false, []);
    }
  };

  const handleModalConfirm = (item, isSlice, addons, event) => {
    kiosk.addToCart(item, isSlice, addons);
  };

  const handleCartCheckout = () => {
    kiosk.setIsCartModalOpen(false);
    if (kiosk.orderType === 'in_hall') {
      setIsTableModalOpen(true);
    } else {
      kiosk.setTableNumber(null);
      setIsPaymentModalOpen(true);
    }
  };

  const handleTableConfirm = () => {
    setIsTableModalOpen(false);
    setIsPaymentModalOpen(true);
  };

  const handleSelectPaymentMethod = (method) => {
    setIsPaymentModalOpen(false);
    kiosk.startPayment(method);
  };

  const screen = (step) => {
    switch (step) {
      case 'onboarding': return <OnboardingScreen onStart={kiosk.handleStartOrder} />;
      case 'menu': return (
        <React.Fragment>
          <MenuScreen kiosk={kiosk} onOpenCustomizer={handleOpenCustomizer} />
          
          {activeProductForCustomizer && (
            <ProductCustomizerModal 
              item={activeProductForCustomizer} 
              onClose={() => setActiveProductForCustomizer(null)} 
              onAdd={handleModalConfirm} 
            />
          )}

          {kiosk.isCartModalOpen && (
            <CartSheet 
              cart={kiosk.cart} 
              totalPrice={kiosk.totalPrice} 
              onClose={() => kiosk.setIsCartModalOpen(false)} 
              onUpdateQuantity={kiosk.updateQuantity} 
              onOpenTableModal={handleCartCheckout} 
            />
          )}

          {isTableModalOpen && (
            <TableNumberModal 
              selectedNumber={kiosk.tableNumber}
              onSelect={kiosk.setTableNumber}
              onClose={() => setIsTableModalOpen(false)}
              onConfirm={handleTableConfirm}
            />
          )}

          {isPaymentModalOpen && (
            <PaymentMethodModal 
              totalPrice={kiosk.totalPrice}
              onSelectMethod={handleSelectPaymentMethod}
              onClose={() => setIsPaymentModalOpen(false)}
              printPaperReceipt={kiosk.printPaperReceipt}
              setPrintPaperReceipt={kiosk.setPrintPaperReceipt}
            />
          )}
        </React.Fragment>
      );
      case 'sbp': return <SBPScreen totalPrice={kiosk.totalPrice} sbpQrString={kiosk.sbpQrString} onCancel={kiosk.cancelPayment} />;
      case 'nfc': return <NFCScreen totalPrice={kiosk.totalPrice} onCancel={kiosk.cancelPayment} />;
      case 'processing': return <ProcessingScreen />;
      case 'success': return <SuccessScreen orderId={kiosk.lastOrderId} tableNumber={kiosk.tableNumber} printerWarning={kiosk.printerWarning} kioskId={kiosk.kioskId} />;
      default: return null;
    }
  };

  return (
    <div className="h-screen w-full relative overflow-hidden font-sans select-none bg-[#123024]">
      {screen(kiosk.step)}
    </div>
  );
}