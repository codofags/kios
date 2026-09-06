import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';

// 🌐 СТРОГО УКАЗЫВАЕМ ВАШ ОБЛАЧНЫЙ СЕРВЕР (Так как APK будет работать на телефонах клиентов)
const SERVER_URL = 'https://quok.art';
const BASE_PATH = '/pizza';

const socket = io(SERVER_URL, { path: `${BASE_PATH}/socket.io` });

const C = { 
  primary: '#1E5343', bg: '#123024', card: '#FAF6E8', text: '#132B25', gold: '#DFB972' 
};

export default function DeliveryApp() {
  const [menu, setMenu] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCat, setActiveCat] = useState('Все');
  const [cart, setCart] = useState([]);
  
  const [step, setStep] = useState('menu'); // menu, cart, payment, success
  const [formData, setFormData] = useState({ name: '', phone: '', address: '' });
  
  const [sbpLink, setSbpLink] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const pollingRef = useRef(null);

  useEffect(() => {
    socket.on('menu_updated', setMenu);
    socket.on('categories_updated', setCategories);
    socket.emit('get_initial_data');
    return () => {
      socket.off('menu_updated');
      socket.off('categories_updated');
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const addToCart = (item) => {
    setCart(prev => {
      const exist = prev.find(i => i.id === item.id);
      if (exist) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateQty = (id, delta) => setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0));

  const totalAmount = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const filteredMenu = activeCat === 'Все' ? menu : menu.filter(i => i.category === activeCat);

  // 💳 ИНИЦИАЛИЗАЦИЯ ОПЛАТЫ СБП ДЛЯ МОБИЛОК
  const startPayment = async () => {
    if (!formData.phone || !formData.address) return alert('Введите телефон и адрес!');
    setStep('payment');
    
    try {
      const res = await fetch(`${SERVER_URL}${BASE_PATH}/api/alfa/generate-qr`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: totalAmount, orderId: Date.now(), kioskId: 'APP' })
      });
      const data = await res.json();
      
      if (data.success) {
        setSbpLink(data.payload); // Это ссылка вида https://qr.nspk.ru/...
        
        // Начинаем опрос: оплатил ли клиент в банковском приложении?
        pollingRef.current = setInterval(async () => {
          const statusRes = await fetch(`${SERVER_URL}${BASE_PATH}/api/alfa/status/${data.bankOrderId}`);
          const statusData = await statusRes.json();
          if (statusData.isPaid) {
            clearInterval(pollingRef.current);
            finishOrder();
          }
        }, 3000);
      } else {
        alert('Ошибка банка: ' + data.error);
        setStep('cart');
      }
    } catch (e) {
      alert('Ошибка соединения с сервером.');
      setStep('cart');
    }
  };

  // 🏁 ОТПРАВКА ЗАКАЗА НА КУХНЮ
  const finishOrder = () => {
    const payload = {
      timestamp: new Date().toISOString(),
      items: cart,
      totalAmount,
      status: 'new',
      orderType: 'delivery',
      paymentMethod: 'sbp_app',
      client: formData
    };

    socket.emit('save_new_order', payload, (res) => {
      if (res.success) {
        setOrderId(res.orderId);
        setCart([]);
        setStep('success');
      }
    });
  };

  // ----------------------------------------------------
  // ИНТЕРФЕЙС ПРИЛОЖЕНИЯ
  // ----------------------------------------------------
  return (
    <div className="h-screen w-full bg-[#123024] text-white font-sans overflow-hidden flex flex-col relative select-none pb-safe">
      {/* ШАПКА */}
      <div className="pt-10 pb-4 px-6 bg-[#1A473A] shadow-md flex items-center justify-between shrink-0 z-20">
        <div>
          <h1 className="text-2xl font-black tracking-widest">ДЕДА ПИЦЦА</h1>
          <p className="text-[#DFB972] text-[10px] font-bold tracking-widest uppercase">Доставка</p>
        </div>
        {step === 'menu' && (
          <button onClick={() => setStep('cart')} className="relative bg-[#DFB972] text-[#123024] p-3 rounded-full shadow-lg active:scale-95">
            🛒 {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-[#123024]">{cart.length}</span>}
          </button>
        )}
      </div>

      {/* ЭКРАН 1: МЕНЮ */}
      {step === 'menu' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex gap-2 overflow-x-auto px-4 py-4 shrink-0 no-scrollbar">
            <button onClick={() => setActiveCat('Все')} className={`px-4 py-2 rounded-xl text-sm font-bold shrink-0 transition-all ${activeCat === 'Все' ? 'bg-[#DFB972] text-[#123024]' : 'bg-white/10 text-white/70'}`}>Все</button>
            {categories.map(c => (
              <button key={c} onClick={() => setActiveCat(c)} className={`px-4 py-2 rounded-xl text-sm font-bold shrink-0 transition-all ${activeCat === c ? 'bg-[#DFB972] text-[#123024]' : 'bg-white/10 text-white/70'}`}>{c}</button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-24 grid grid-cols-2 gap-4">
            {filteredMenu.map(item => (
              <div key={item.id} className="bg-[#FAF6E8] rounded-2xl p-3 flex flex-col text-[#132B25] shadow-lg">
                <img src={item.image} alt={item.name} className="w-full aspect-square object-cover rounded-xl mb-3" />
                <h3 className="font-black text-sm leading-tight mb-1">{item.name}</h3>
                <p className="text-[10px] text-[#5F736E] line-clamp-2 mb-3 flex-1">{item.desc}</p>
                <div className="flex justify-between items-center mt-auto">
                  <span className="font-black text-base">{item.price} ₽</span>
                  <button onClick={() => addToCart(item)} className="bg-[#1E5343] text-white w-8 h-8 rounded-full flex items-center justify-center font-bold active:scale-90">+</button>
                </div>
              </div>
            ))}
          </div>

          {cart.length > 0 && (
            <div className="absolute bottom-6 left-6 right-6">
              <button onClick={() => setStep('cart')} className="w-full bg-[#DFB972] text-[#123024] py-4 rounded-2xl font-black text-lg shadow-[0_10px_30px_rgba(223,185,114,0.3)] active:scale-95 transition-transform flex justify-between px-6">
                <span>Корзина</span><span>{totalAmount} ₽</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ЭКРАН 2: КОРЗИНА И ДАННЫЕ ДОСТАВКИ */}
      {step === 'cart' && (
        <div className="flex-1 overflow-y-auto px-6 py-6 pb-32">
          <button onClick={() => setStep('menu')} className="text-[#DFB972] font-bold mb-6 flex items-center gap-2">← В меню</button>
          <h2 className="text-3xl font-black mb-6">Оформление</h2>
          
          <div className="space-y-4 mb-8">
            {cart.map(item => (
              <div key={item.id} className="bg-white/10 p-4 rounded-2xl flex items-center gap-4">
                <img src={item.image} className="w-16 h-16 rounded-xl object-cover" alt="" />
                <div className="flex-1">
                  <h4 className="font-bold text-sm">{item.name}</h4>
                  <p className="text-[#DFB972] font-black">{item.price} ₽</p>
                </div>
                <div className="flex items-center gap-3 bg-black/30 rounded-full p-1">
                  <button onClick={() => updateQty(item.id, -1)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold">−</button>
                  <span className="w-4 text-center font-bold text-sm">{item.quantity}</span>
                  <button onClick={() => updateQty(item.id, 1)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold">+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white/5 p-6 rounded-3xl space-y-4 mb-6">
            <h3 className="font-bold text-[#DFB972] uppercase tracking-wider text-xs">Куда везти?</h3>
            <input type="text" placeholder="Имя" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full bg-black/30 border border-white/10 px-4 py-3 rounded-xl text-white outline-none focus:border-[#DFB972]" />
            <input type="tel" placeholder="Телефон" value={formData.phone} onChange={e=>setFormData({...formData, phone: e.target.value})} className="w-full bg-black/30 border border-white/10 px-4 py-3 rounded-xl text-white outline-none focus:border-[#DFB972]" />
            <textarea placeholder="Улица, дом, квартира, подъезд" value={formData.address} onChange={e=>setFormData({...formData, address: e.target.value})} className="w-full bg-black/30 border border-white/10 px-4 py-3 rounded-xl text-white outline-none focus:border-[#DFB972] h-24 resize-none" />
          </div>

          <button onClick={startPayment} disabled={cart.length === 0} className="w-full bg-[#DFB972] text-[#123024] py-5 rounded-2xl font-black text-xl shadow-[0_10px_30px_rgba(223,185,114,0.3)] active:scale-95 disabled:opacity-50">
            К ОПЛАТЕ {totalAmount} ₽
          </button>
        </div>
      )}

      {/* ЭКРАН 3: ОПЛАТА СБП (DEEP LINK В ПРИЛОЖЕНИЕ БАНКА) */}
      {step === 'payment' && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-24 h-24 bg-[#DFB972] rounded-3xl mb-8 flex items-center justify-center shadow-lg animate-pulse">
            <span className="text-5xl">📱</span>
          </div>
          <h2 className="text-3xl font-black mb-2">Оплата СБП</h2>
          <p className="text-white/70 mb-10">Нажмите на кнопку ниже. Откроется ваше банковское приложение для подтверждения оплаты.</p>
          
          {sbpLink ? (
            <a href={sbpLink} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 block mb-6">
              ОПЛАТИТЬ В ПРИЛОЖЕНИИ БАНКА
            </a>
          ) : (
            <div className="w-full bg-white/10 py-5 rounded-2xl font-bold text-white/50 mb-6">Создаем ссылку...</div>
          )}

          <div className="flex items-center gap-3 text-[#DFB972] text-sm animate-pulse mb-8">
            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="3" strokeDasharray="32" className="opacity-100" strokeLinecap="round" /></svg>
            Ждем подтверждения банка...
          </div>

          <button onClick={() => { setStep('cart'); if(pollingRef.current) clearInterval(pollingRef.current); }} className="text-white/50 border-b border-white/30 pb-1 text-sm font-bold">
            Отменить и вернуться
          </button>
        </div>
      )}

      {/* ЭКРАН 4: УСПЕХ */}
      {step === 'success' && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-32 h-32 bg-[#DFB972] rounded-full mb-8 flex items-center justify-center shadow-[0_0_50px_rgba(223,185,114,0.4)]">
            <span className="text-6xl">🎉</span>
          </div>
          <h2 className="text-4xl font-black mb-2">Заказ принят!</h2>
          <p className="text-[#DFB972] font-bold tracking-widest uppercase mb-8">Уже готовим</p>
          
          <div className="bg-white/10 p-8 rounded-3xl w-full">
            <p className="text-white/50 text-sm mb-2">Номер вашего заказа:</p>
            <p className="text-6xl font-black text-white">{orderId}</p>
          </div>
          
          <button onClick={() => { setStep('menu'); setFormData({name:'', phone:'', address:''}); }} className="mt-12 bg-white/10 px-8 py-4 rounded-full font-bold active:scale-95">
            На главную
          </button>
        </div>
      )}
    </div>
  );
}