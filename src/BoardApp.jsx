// ====================================================================
// BoardApp.jsx — Электронная очередь (В стиле Аэропорт / Фастфуд)
// Особенности: Разделенный экран, авто-пагинация, крупные номера
// ====================================================================
import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = 'https://quok.art';
const BASE_PATH = '/pizza';

const socket = io(SERVER_URL, {
  path: `${BASE_PATH}/socket.io`
});

const ITEMS_PER_PAGE = 15; 
const PAGE_DURATION_MS = 8000; 

export default function BoardApp() {
  const [orders, setOrders] = useState([]);
  const [time, setTime] = useState('');
  const [currentPage, setCurrentPage] = useState(0);

  // Подключение и загрузка заказов
  useEffect(() => {
    socket.on('orders_updated', (serverOrders) => setOrders(serverOrders || []));
    socket.emit('get_initial_data'); // Запрашиваем при включении ТВ
    
    return () => socket.off('orders_updated');
  }, []);

  // Часы
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);


  const preparing = orders.filter(o => ['new', 'cooking', 'in_progress'].includes(o.status)).sort((a, b) => b.orderId - a.orderId);
  const ready = orders.filter(o => o.status === 'ready').sort((a, b) => b.orderId - a.orderId);

  // Считаем, сколько всего страниц потребуется
  const maxPages = Math.max(
    1,
    Math.ceil(preparing.length / ITEMS_PER_PAGE),
    Math.ceil(ready.length / ITEMS_PER_PAGE)
  );

  // Автоматическое перелистывание страниц
  useEffect(() => {
    if (maxPages <= 1) {
      setCurrentPage(0);
      return;
    }
    const interval = setInterval(() => {
      setCurrentPage((prev) => (prev + 1) % maxPages);
    }, PAGE_DURATION_MS);
    return () => clearInterval(interval);
  }, [maxPages]);

  // Вырезаем кусок массива для текущей страницы
  const currentPreparing = preparing.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
  const currentReady = ready.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);

  return (
    <div className="flex flex-col h-screen w-full bg-[#0A0A0C] font-sans text-white overflow-hidden select-none cursor-none">
      
      {/* ✈️ ШАПКА КАК В АЭРОПОРТУ */}
      <header className="bg-[#1C1C1E] px-10 py-5 flex justify-between items-center border-b-2 border-white/10 shadow-xl shrink-0 z-20">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 bg-amber-400 rounded-full flex items-center justify-center text-green-950 font-black text-2xl shadow-lg">ДП</div>
          <h1 className="text-4xl font-black tracking-widest text-white uppercase">Электронная очередь</h1>
        </div>
        <div className="text-5xl font-black text-amber-400 tracking-tighter drop-shadow-md">{time}</div>
      </header>

      {/* 🍕 ОСНОВНОЙ ЭКРАН (РАЗДЕЛЕН НА 2 ЧАСТИ) */}
      <div className="flex-1 flex w-full relative overflow-hidden" key={currentPage /* Анимация при смене страницы */}>
        
        {/* Анимация плавного появления страницы */}
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes pageFadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
          .page-animate { animation: pageFadeIn 0.5s ease-out forwards; }
        `}} />

        {/* ======================================================== */}
        {/* КОЛОНКА 1: ГОТОВИТСЯ */}
        {/* ======================================================== */}
        <div className="w-1/2 h-full flex flex-col border-r border-white/10 bg-[#121214]">
          <div className="bg-black/40 text-center py-6 border-b border-white/5 shrink-0 shadow-md">
            <h2 className="text-4xl font-black text-white/50 tracking-widest uppercase">Готовится</h2>
          </div>
          
          <div className="flex-1 p-8 page-animate">
            <div className="grid grid-cols-3 gap-6 content-start">
              {currentPreparing.map(order => (
                <div key={order.orderId} className="bg-white/5 border border-white/10 rounded-3xl py-8 flex items-center justify-center shadow-inner">
                  <span className="text-7xl font-black text-white/90 tracking-tighter">
                    {order.orderId}
                  </span>
                </div>
              ))}
            </div>
            {preparing.length === 0 && (
              <div className="w-full h-full flex items-center justify-center text-white/20 text-3xl font-bold uppercase tracking-widest">
                Очередь пуста
              </div>
            )}
          </div>
        </div>

        {/* ======================================================== */}
        {/* КОЛОНКА 2: ГОТОВО (ЗЕЛЕНАЯ) */}
        {/* ======================================================== */}
        <div className="w-1/2 h-full flex flex-col bg-[#0A2E17]">
          <div className="bg-[#124B27] text-center py-6 border-b border-[#32D74B]/30 shrink-0 shadow-md">
            <h2 className="text-4xl font-black text-[#32D74B] tracking-widest uppercase drop-shadow-md">Готово к выдаче</h2>
          </div>
          
          <div className="flex-1 p-8 page-animate">
            <div className="grid grid-cols-3 gap-6 content-start">
              {currentReady.map(order => (
                <div key={order.orderId} className="bg-gradient-to-br from-[#32D74B] to-[#28A73A] border-4 border-[#32D74B]/50 rounded-3xl py-8 flex items-center justify-center shadow-[0_15px_35px_rgba(50,215,75,0.4)] animate-pulse">
                  <span className="text-7xl font-black text-green-950 tracking-tighter">
                    {order.orderId}
                  </span>
                </div>
              ))}
            </div>
            {ready.length === 0 && (
              <div className="w-full h-full flex items-center justify-center text-[#32D74B]/20 text-3xl font-bold uppercase tracking-widest">
                Ожидаем готовности
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ✈️ ИНДИКАТОР СТРАНИЦ (ЕСЛИ ЗАКАЗОВ МНОГО) */}
      {maxPages > 1 && (
        <div className="bg-[#1C1C1E] border-t border-white/10 h-16 shrink-0 flex items-center justify-center gap-4 z-20">
          <span className="text-white/50 text-xl font-bold uppercase tracking-widest mr-4">
            Экран {currentPage + 1} из {maxPages}
          </span>
          {Array.from({ length: maxPages }).map((_, idx) => (
            <div 
              key={idx} 
              className={`w-4 h-4 rounded-full transition-all duration-300 ${
                idx === currentPage ? 'bg-amber-400 scale-125 shadow-[0_0_10px_#fbbf24]' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      )}

    </div>
  );
}