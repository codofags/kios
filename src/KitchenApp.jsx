import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = 'https://quok.art';
const BASE_PATH = '/pizza';

const socket = io(SERVER_URL, {
  path: `${BASE_PATH}/socket.io`
}); 

const STATUS_COLORS = {
  new: { bg: 'bg-[#FF3B30]/10', border: 'border-[#FF3B30]/30', text: 'text-[#FF3B30]', btn: 'bg-[#FF3B30]', label: 'Новый' },
  in_progress: { bg: 'bg-[#0A84FF]/10', border: 'border-[#0A84FF]/30', text: 'text-[#0A84FF]', btn: 'bg-[#0A84FF]', label: 'Готовится' },
  ready: { bg: 'bg-[#32D74B]/10', border: 'border-[#32D74B]/30', text: 'text-[#32D74B]', btn: 'bg-[#32D74B]', label: 'Готов' },
};

const getElapsedTime = (timestamp) => {
  const diff = Math.floor((new Date() - new Date(timestamp)) / 1000);
  const m = Math.floor(diff / 60).toString().padStart(2, '0');
  const s = (diff % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

function OrderTicket({ order, onUpdateStatus }) {
  const [elapsed, setElapsed] = useState(getElapsedTime(order.timestamp));
  const colors = STATUS_COLORS[order.status] || STATUS_COLORS.new;

  useEffect(() => {
    const timer = setInterval(() => setElapsed(getElapsedTime(order.timestamp)), 1000);
    return () => clearInterval(timer);
  }, [order.timestamp]);

  const handleNextStep = () => {
    if (order.status === 'new') onUpdateStatus(order.orderId, 'in_progress');
    else if (order.status === 'in_progress') onUpdateStatus(order.orderId, 'ready');
    else if (order.status === 'ready') onUpdateStatus(order.orderId, 'completed');
  };

  const isTable = order.tableNumber && !String(order.tableNumber).includes('стойки') && !String(order.tableNumber).includes('Сам');
  const isDelivery = order.orderType === 'delivery' || order.kioskId === 'FoodSoul' || order.kioskId === 'MobileApp';
  const orderSum = Number(order.totalAmount || order.amount || 0);

  // Определение статуса оплаты
  const isPaid = order.paymentMethod === 'sbp' || order.paymentMethod === 'card' || order.paymentMethod === 'online' || !isDelivery;

  return (
    <div className={`flex flex-col rounded-2xl border ${colors.border} bg-[#1C1C1E] overflow-hidden shadow-lg transition-all duration-300`}>
      <div className={`px-4 py-3 flex flex-col gap-2.5 ${colors.bg}`}>
        
        {/* Верхняя строка карточки */}
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-3xl font-black text-white">#{order.orderId}</span>
              
              {/* 💡 КРУПНАЯ СУММА ЗАКАЗА */}
              <span className="text-2xl font-black text-amber-400">
                {orderSum > 0 ? `${orderSum.toLocaleString('ru-RU')} ₽` : ''}
              </span>
            </div>

            {/* Бейджи: Статус оплаты и Столик / Доставка */}
            <div className="flex items-center gap-2 flex-wrap mt-1">
              
              {/* 💡 ЯРКИЙ СТАТУС ОПЛАТЫ */}
              {isPaid ? (
                <span className="px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <span>✅ ОПЛАЧЕН</span>
                  <span className="text-white/60 font-normal">
                    ({order.paymentMethod === 'sbp' ? 'СБП' : (order.paymentMethod === 'card' ? 'Карта' : 'Онлайн')})
                  </span>
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider bg-orange-500/20 text-orange-400 border border-orange-500/30">
                  💵 ПРИ ПОЛУЧЕНИИ
                </span>
              )}

              {/* Бейдж Столика / Самовывоза / Доставки */}
              <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider shadow-sm ${
                isTable 
                  ? 'bg-amber-400 text-black' 
                  : (isDelivery ? 'bg-purple-600 text-white' : 'bg-white/10 text-white')
              }`}>
                📍 {order.tableNumber || (order.orderType === 'takeaway' ? 'С собой' : 'У стойки / Сам')}
              </span>

              {order.kioskId && !isDelivery && (
                <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] text-white/50 font-mono">
                  К-{order.kioskId}
                </span>
              )}
            </div>
          </div>

          {/* Таймер */}
          <div className={`text-xl font-mono font-bold whitespace-nowrap ${elapsed.startsWith('00') ? 'text-white' : 'text-orange-400'}`}>
            {elapsed}
          </div>
        </div>
      </div>

      {/* Список позиций в чеке */}
      <div className="p-4 flex-1 overflow-y-auto space-y-2.5">
        {order.items && order.items.map((item, idx) => (
          <div key={idx} className="flex items-start justify-between border-b border-white/5 pb-2 last:border-0 last:pb-0">
            <div className="flex items-start gap-2.5 flex-1 pr-2">
              <div className="min-w-[28px] h-[28px] rounded-lg bg-white/10 flex items-center justify-center text-white font-black text-sm">
                {item.quantity}
              </div>
              <h3 className="text-white font-semibold text-base leading-snug">{item.name}</h3>
            </div>
            {item.price && (
              <span className="text-xs text-white/40 font-mono whitespace-nowrap pt-1">
                {item.price * item.quantity} ₽
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Кнопка смены статуса */}
      <div className="p-3 border-t border-white/10">
        <button 
          onClick={handleNextStep} 
          className={`w-full py-3.5 rounded-xl text-white font-bold text-base shadow-lg active:scale-95 transition-transform ${colors.btn}`}
        >
          {order.status === 'new' && '👨‍🍳 Начать готовку'}
          {order.status === 'in_progress' && '✅ Заказ готов'}
          {order.status === 'ready' && '📦 Выдать клиенту'}
        </button>
      </div>
    </div>
  );
}

export default function KitchenApp() {
  const [orders, setOrders] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  const maxOrderIdSeen = useRef(0);

  const playNotificationSound = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      const playTone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.3, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      playTone(880, ctx.currentTime, 0.2);
      playTone(1108.73, ctx.currentTime + 0.15, 0.4);
    } catch (e) {}
  };

  useEffect(() => {
    socket.on('orders_updated', (serverOrders) => {
      const currentOrders = serverOrders || [];
      setOrders(currentOrders);

      const currentMaxId = currentOrders.reduce((max, order) => Math.max(max, Number(order.orderId) || 0), 0);
      if (currentMaxId > maxOrderIdSeen.current && maxOrderIdSeen.current !== 0) {
        playNotificationSound();
      }
      if (currentMaxId > maxOrderIdSeen.current) {
        maxOrderIdSeen.current = currentMaxId;
      }
    });

    socket.emit('get_initial_data');
    return () => socket.off('orders_updated');
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })), 1000);
    return () => clearInterval(timer);
  }, []);

  const updateOrderStatus = (orderId, newStatus) => {
    socket.emit('update_order_status', { orderId, status: newStatus });
  };

  const clearAllOrders = () => {
    if (window.confirm('Очистить все активные заказы на кухне?')) {
      socket.emit('clear_orders');
    }
  };

  const activeOrders = orders.filter(o => o.status !== 'ready' && o.status !== 'completed');
  const readyOrders = orders.filter(o => o.status === 'ready');

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-hidden select-none">
      <header className="bg-[#1C1C1E] border-b border-white/10 px-6 py-4 flex justify-between items-center z-10">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-black tracking-tight text-white">Деда Пицца • KDS</h1>
          <div className="flex gap-4">
            <div className="px-3 py-1 bg-white/10 rounded-full text-sm font-medium">
              Активных: <span className="text-orange-400 font-bold">{activeOrders.length}</span>
            </div>
            <div className="px-3 py-1 bg-white/10 rounded-full text-sm font-medium">
              Готовых: <span className="text-green-400 font-bold">{readyOrders.length}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <button 
            onClick={clearAllOrders} 
            className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg text-sm font-bold transition-colors cursor-pointer"
          >
            Очистить все заказы
          </button>
          <div className="text-3xl font-black tracking-tighter text-white">{currentTime}</div>
        </div>
      </header>

      <main className="flex-1 overflow-x-auto overflow-y-hidden p-6">
        <div className="h-full flex gap-6 min-w-max">
          <div className="flex flex-col h-full w-[1200px]">
            <h2 className="text-lg font-bold text-gray-500 uppercase tracking-widest mb-4">Очередь заказов</h2>
            <div className="flex-1 overflow-y-auto pr-4 hide-scrollbar">
              {activeOrders.length === 0 ? (
                <div className="h-full flex items-center justify-center border-2 border-dashed border-white/10 rounded-3xl">
                  <p className="text-gray-500 text-xl font-medium">Нет активных заказов</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 xl:grid-cols-4 auto-rows-max gap-4 pb-12">
                  {activeOrders.map(order => (
                    <OrderTicket key={order.orderId} order={order} onUpdateStatus={updateOrderStatus} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="w-px bg-white/10 shrink-0" />

          <div className="flex flex-col h-full w-[400px]">
            <h2 className="text-lg font-bold text-green-500/70 uppercase tracking-widest mb-4">Ждут выдачи</h2>
            <div className="flex-1 overflow-y-auto pr-4 hide-scrollbar">
              {readyOrders.length === 0 ? (
                <div className="h-full flex items-center justify-center border-2 border-dashed border-white/10 rounded-3xl">
                  <p className="text-gray-500 text-xl font-medium">Нет готовых</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 auto-rows-max gap-4 pb-12">
                  {readyOrders.map(order => (
                    <OrderTicket key={order.orderId} order={order} onUpdateStatus={updateOrderStatus} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <style dangerouslySetInnerHTML={{__html: `.hide-scrollbar::-webkit-scrollbar { display: none; }`}} />
    </div>
  );
}