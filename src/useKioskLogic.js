import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = 'https://quok.art';
const BASE_PATH = '/pizza';

const socket = io(SERVER_URL, {
  path: `${BASE_PATH}/socket.io`,
  reconnection: true,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

const INACTIVITY_RESET_MS = 60000;
const PAYMENT_SAFETY_MS = 180000;

const ERROR_MESSAGES = {
  PAPER_OUT: { icon: '🧾', title: 'В кассе закончилась чековая лента', message: 'Ваш заказ принят и уже передан на кухню! Сотрудник заменит ленту и выдаст чек.' },
  INSUFFICIENT_FUNDS: { icon: '💳', title: 'Недостаточно средств на карте', message: 'На карте недостаточно средств. Попробуйте другую карту или СБП.' },
  LIMIT_EXCEEDED: { icon: '🛡', title: 'Превышен лимит операций', message: 'Банк отклонил операцию по лимиту карты.' },
  CARD_RETAINED: { icon: '⚠️', title: 'Карта изъята терминалом', message: 'Позовите сотрудника — карта осталась в терминале.' },
  BANK_DECLINED: { icon: '🚫', title: 'Банк отклонил оплату', message: 'Банк отказал в проведении операции.' },
  NO_CONNECTION: { icon: '📡', title: 'Нет связи с банком/кассой', message: 'Попробуйте ещё раз через минуту или позовите сотрудника.' },
  TIMEOUT: { icon: '⏱', title: 'Время ожидания истекло', message: 'Оплата не была завершена вовремя.' },
  CANCELLED: { icon: '✋', title: 'Оплата отменена', message: 'Операция была отменена.' },
  UNKNOWN: { icon: '⚠️', title: 'Произошла ошибка', message: 'Попробуйте ещё раз или позовите сотрудника.' }
};

function mapErrorToDisplay(source, fallbackTitle) {
  const code = source && source.errorCode;
  if (code && ERROR_MESSAGES[code]) return { code, ...ERROR_MESSAGES[code], raw: source.error || '' };

  const raw = (source && (source.error || source.message)) || '';
  const text = String(raw).toLowerCase();
  if (text.includes('лент') || text.includes('бумаг')) return { code: 'PAPER_OUT', ...ERROR_MESSAGES.PAPER_OUT, raw };
  if (text.includes('недостаточно средств')) return { code: 'INSUFFICIENT_FUNDS', ...ERROR_MESSAGES.INSUFFICIENT_FUNDS, raw };
  if (text.includes('connection') || text.includes('связ')) return { code: 'NO_CONNECTION', ...ERROR_MESSAGES.NO_CONNECTION, raw };
  if (text.includes('таймаут') || text.includes('время')) return { code: 'TIMEOUT', ...ERROR_MESSAGES.TIMEOUT, raw };
  if (text.includes('отмен')) return { code: 'CANCELLED', ...ERROR_MESSAGES.CANCELLED, raw };
  return { code: 'UNKNOWN', ...ERROR_MESSAGES.UNKNOWN, title: fallbackTitle || ERROR_MESSAGES.UNKNOWN.title, raw };
}

function initKioskId() {
  if (typeof window === 'undefined') return '1';
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const pinFromUrl = urlParams.get('pin') || urlParams.get('kiosk');
    if (pinFromUrl) {
      localStorage.setItem('KIOSK_ID', pinFromUrl);
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      return pinFromUrl;
    }
    return localStorage.getItem('KIOSK_ID') || '1';
  } catch (e) { return '1'; }
}

const KIOSK_ID = initKioskId();

export default function useKioskLogic() {
  const [step, setStep] = useState('onboarding');
  const [activeCategory, setActiveCategory] = useState('Все');
  const [activeTag, setActiveTag] = useState(null);
  const [cart, setCart] = useState([]);
  const [isCartModalOpen, setIsCartModalOpen] = useState(false);
  const [transition, setTransition] = useState({ type: 'idle', previous: null, next: null });
  const [lastOrderId, setLastOrderId] = useState(null);
  const [orderType, setOrderType] = useState('in_hall');
  const [printPaperReceipt, setPrintPaperReceipt] = useState(true);
  const [receiptData, setReceiptData] = useState(null);
  const [globalError, setGlobalError] = useState(null);
  const [printerWarning, setPrinterWarning] = useState(null);

  const [tableNumber, setTableNumber] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [sbpQrString, setSbpQrString] = useState(null);
  const pollingIntervalRef = useRef(null);

  const [dynamicMenu, setDynamicMenu] = useState([]);
  const [categoriesList, setCategoriesList] = useState([]);
  const [tagsList, setTagsList] = useState([]);

  const stepRef = useRef(step);
  stepRef.current = step;

  const lastActivityRef = useRef(Date.now());
  const [idleResetInSeconds, setIdleResetInSeconds] = useState(null);
  const paymentCancelledRef = useRef(false);
  const paymentMethodRef = useRef('card');
  const errorTimerRef = useRef(null);
  const resetTimerRef = useRef(null);

  const markActivity = useCallback(() => { lastActivityRef.current = Date.now(); }, []);

  useEffect(() => {
    const events = ['pointerdown', 'touchstart', 'click', 'keydown'];
    events.forEach((e) => window.addEventListener(e, markActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, markActivity));
  }, [markActivity]);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    setIdleResetInSeconds(null);
  }, [step]);

  useEffect(() => {
    const handleMenu = (menu) => setDynamicMenu(menu || []);
    const handleCategories = (cats) => setCategoriesList(cats || []);
    const handleTags = (tags) => setTagsList(tags || []);

    socket.on('menu_updated', handleMenu);
    socket.on('categories_updated', handleCategories);
    socket.on('tags_updated', handleTags);
    socket.emit('get_initial_data');

    return () => {
      socket.off('menu_updated');
      socket.off('categories_updated');
      socket.off('tags_updated');
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  const categories = useMemo(() => ['Все', ...categoriesList].map(c => ({ key: c, label: c })), [categoriesList]);

  const handleCategoryChange = (catKey) => {
    setActiveCategory(catKey);
    setActiveTag(null);
  };

  const navigateTo = useCallback((targetStep) => {
    if (transition.type !== 'idle' || targetStep === stepRef.current) return;
    setTransition({ type: 'transitioning', previous: stepRef.current, next: targetStep });
    setStep(targetStep);
    setTimeout(() => setTransition({ type: 'idle', previous: null, next: null }), 300);
  }, [transition.type]);

  const resetKiosk = useCallback(() => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    navigateTo('onboarding');
    setLastOrderId(null);
    setReceiptData(null);
    setCart([]);
    setActiveTag(null);
    setSbpQrString(null);
    setTableNumber(null);
    setIsCartModalOpen(false);
    setPrinterWarning(null);
    setGlobalError(null);
  }, [navigateTo]);

  useEffect(() => {
    const checker = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      const currentStep = stepRef.current;

      const isPaymentStep = currentStep === 'nfc' || currentStep === 'sbp' || currentStep === 'processing';
      if (isPaymentStep) {
        setIdleResetInSeconds(null);
        if (idleMs >= PAYMENT_SAFETY_MS) {
          paymentCancelledRef.current = true;
          if (paymentMethodRef.current === 'card') {
            fetch(`${SERVER_URL}${BASE_PATH}/api/sber/cancel`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kioskId: KIOSK_ID })
            }).catch(() => {});
          }
          resetKiosk();
        }
        return;
      }

      if (currentStep === 'onboarding' || currentStep === 'success') { 
        setIdleResetInSeconds(null); 
        return; 
      }

      const remainingMs = INACTIVITY_RESET_MS - idleMs;
      if (remainingMs <= 0) resetKiosk();
      else setIdleResetInSeconds(Math.ceil(remainingMs / 1000));
    }, 1000);
    return () => clearInterval(checker);
  }, [resetKiosk]);

  const clearCart = useCallback(() => setCart([]), []);

  const showKioskError = (errorSource, options = {}) => {
    const display = (errorSource && errorSource.code) ? errorSource : mapErrorToDisplay(errorSource, options.fallbackTitle);
    socket.emit('kiosk_log', { level: 'error', message: `[${display.code}] ${display.title}`, details: display.raw || '' });

    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    setGlobalError(display);

    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setGlobalError(null), 12000);

    if (!options.stayOnScreen) navigateTo('menu');
  };

  const dismissGlobalError = useCallback(() => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setGlobalError(null);
  }, []);

  const clearPrinterWarning = useCallback(() => setPrinterWarning(null), []);

  const printFiscalOnAtol = async (orderItems, totalSum) => {
    const isElectronicOnly = printPaperReceipt === false;
    const items = orderItems.map((i) => {
      const price = parseFloat(Number(i.price).toFixed(2));
      const quantity = parseFloat(Number(i.quantity).toFixed(3));
      return {
        type: 'position', name: String(i.name || 'Товар').trim().substring(0, 128),
        price, quantity, amount: parseFloat((price * quantity).toFixed(2)),
        department: 1, paymentMethod: 'fullPayment', paymentObject: 'commodity',
        tax: { type: 'none' }, measurementUnit: 'piece'
      };
    });

    const total = parseFloat(items.reduce((acc, item) => acc + item.amount, 0).toFixed(2));
    const body = {
      uuid: 'kiosk-task-' + Date.now(),
      request: [{
        type: 'sell', validateMarkingCodes: false, taxationType: 'usnIncome',
        ignoreNonFiscalPrintErrors: false, electronically: isElectronicOnly,
        operator: { name: 'Касса самообслуживания' }, items, total,
        payments: [{ type: 'electronically', sum: total }]
      }]
    };

    try {
      const res = await fetch(`${SERVER_URL}${BASE_PATH}/api/atol/print`, {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json(); 
    } catch (e) {
      return { success: false, errorCode: 'NO_CONNECTION', error: `Нет связи: ${e.message}` };
    }
  };

  const addToCart = useCallback((item, isSlice = false, selectedAddons = []) => {
    if (!item) return;
    setCart((prev) => {
      const safeAddons = Array.isArray(selectedAddons) ? selectedAddons : [];
      const addonKey = safeAddons.map((a) => (a ? a.name : '')).filter(Boolean).sort().join('-');
      const itemId = item.id || Date.now();
      const cartItemId = `${itemId}_${isSlice ? 'slice' : 'whole'}_${addonKey}`;
      const basePrice = Number(isSlice ? item.slicePrice || 0 : item.price || 0);
      const addonsPrice = safeAddons.reduce((sum, a) => sum + Number(a?.price || 0), 0);
      const finalPrice = basePrice + addonsPrice;
      const baseName = item.name || 'Без названия';
      let finalName = isSlice ? `${baseName} (Кусочек)` : baseName;
      if (safeAddons.length > 0) finalName += ` + ${safeAddons.map((a) => a.name).join(', ')}`;

      const existingIndex = prev.findIndex((i) => i.id === cartItemId);
      if (existingIndex > -1) {
        return prev.map((i, index) => index === existingIndex ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, id: cartItemId, originalId: itemId, name: finalName, price: finalPrice, quantity: 1, isSlice, selectedAddons: safeAddons }];
    });
  }, []);

  const updateQuantity = (id, delta) =>
    setCart((prev) => prev.map((item) => {
      if (item.id === id) return { ...item, quantity: item.quantity + delta > 0 ? item.quantity + delta : 0 };
      return item;
    }).filter((item) => item.quantity > 0));

  const totalPrice = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  let filteredItems = (activeCategory === 'Все'
    ? dynamicMenu
    : dynamicMenu.filter((i) => i.category === activeCategory)
  ).filter((item) => !item.isHidden && item.isAvailable !== false);

  if (activeTag) {
    filteredItems = filteredItems.filter((i) => i.tags && i.tags.includes(activeTag));
  }

  // =========================================================
  // ⚡️ ФИНАЛИЗАЦИЯ (ВЫЗЫВАЕТСЯ СТРОГО ПОСЛЕ ПОДТВЕРЖДЕНИЯ ОПЛАТЫ)
  // =========================================================
  const finalizeOrder = async () => {
    if (paymentCancelledRef.current || !cart || cart.length === 0) return;

    navigateTo('processing');

    const cartSnapshot = [...cart];
    const orderTotal = totalPrice;
    const currentOrderType = orderType;
    const currentPaymentMethod = paymentMethod;
    const formattedTable = tableNumber ? `Стол №${tableNumber}` : 'У стойки / Сам';

    const orderPayload = {
      timestamp: new Date().toISOString(),
      items: cartSnapshot, 
      totalAmount: orderTotal,
      status: 'new', 
      orderType: currentOrderType, 
      paymentMethod: currentPaymentMethod,
      tableNumber: formattedTable, 
      kioskId: KIOSK_ID
    };

    socket.emit('save_new_order', orderPayload, async (serverRes) => {
      if (serverRes && serverRes.success) {
        setLastOrderId(serverRes.orderId);

        const atolPromise = printFiscalOnAtol(cartSnapshot, orderTotal);
        navigateTo('success');

        setCart([]);
        setOrderType('in_hall');
        setPrintPaperReceipt(true);
        setActiveTag(null);
        setSbpQrString(null);
        setTableNumber(null);

        resetTimerRef.current = setTimeout(() => { resetKiosk(); }, 10000);

        try {
          const atolRes = await atolPromise;
          if (paymentCancelledRef.current) return;

          if (!atolRes.success) {
            const display = mapErrorToDisplay(atolRes, 'Чек не напечатан');
            setPrinterWarning(display);
            socket.emit('kiosk_log', {
              level: 'warn', message: `[${display.code}] Чек #${serverRes.orderId} не напечатан: ${display.raw}`
            });
          }

          const fd = atolRes?.fiscalData || { fn: 'Эмуляция', fd: 'Эмуляция', fp: 'Эмуляция', fnsSite: 'www.nalog.gov.ru' };
          const pad = (n) => String(n).padStart(2, '0');
          const now = new Date();
          const timestampFns = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          const qrString = fd.fn !== 'Эмуляция' ? `t=${timestampFns}&s=${orderTotal.toFixed(2)}&fn=${fd.fn}&i=${fd.fd}&fp=${fd.fp}&n=1` : '';

          setReceiptData({
            items: cartSnapshot, total: orderTotal, orderId: serverRes.orderId,
            orderType: currentOrderType, tableNumber: formattedTable, evotorUuid: atolRes?.uuid || 'uuid',
            date: new Date().toLocaleString('ru-RU'),
            fn: fd.fn, fd: fd.fd, fp: fd.fp, fnsSite: fd.fnsSite, qrString,
            fiscalPending: !atolRes.success
          });
        } catch (e) {
          console.error('Ошибка печати чека', e);
        }
      }
    });
  };

  const cancelPayment = useCallback(async () => {
    socket.emit('kiosk_log', { level: 'info', message: `Покупатель киоска #${KIOSK_ID} нажал "Отменить оплату".` });
    if (paymentMethodRef.current === 'card') {
      try {
        await fetch(`${SERVER_URL}${BASE_PATH}/api/sber/cancel`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kioskId: KIOSK_ID })
        });
      } catch (e) {}
    }
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    navigateTo('menu');
    setIsCartModalOpen(true);
  }, [navigateTo]);

  // =========================================================
  // 💳 БОЕВОЙ СБП (БЕЗ ТЕСТОВЫХ СИМУЛЯЦИЙ)
  // =========================================================
  const startPayment = useCallback(async (methodOrEvent) => {
      const method = typeof methodOrEvent === 'string' ? methodOrEvent : 'card';
      setPaymentMethod(method);
      paymentMethodRef.current = method;
      paymentCancelledRef.current = false;
      setIsCartModalOpen(false);

      if (method === 'sbp') {
        navigateTo('sbp');
        setSbpQrString(null);

        try {
          const res = await fetch(`${SERVER_URL}${BASE_PATH}/api/alfa/generate-qr`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: totalPrice, orderId: Date.now(), kioskId: KIOSK_ID })
          });
          const data = await res.json();

          // 💡 СТРОГО: Если банк выдал реальный QR-код — опрашиваем статус
          if (data.success && data.payload) {
            setSbpQrString(data.payload);
            pollingIntervalRef.current = setInterval(async () => {
              if (paymentCancelledRef.current) { clearInterval(pollingIntervalRef.current); return; }
              try {
                const statusRes = await fetch(`${SERVER_URL}${BASE_PATH}/api/alfa/status/${data.bankOrderId}`);
                const statusData = await statusRes.json();
                
                // 💡 ТОЛЬКО ПРИ РЕАЛЬНОМ ПОДТВЕРЖДЕНИИ ОТ БАНКА:
                if (statusData.isPaid) {
                  clearInterval(pollingIntervalRef.current);
                  finalizeOrder();
                }
              } catch (err) {}
            }, 3000);
          } else {
            // 🛑 ТЕСТОВАЯ СИМУЛЯЦИЯ УДАЛЕНА: Если QR не получен — честная ошибка!
            showKioskError({ errorCode: 'BANK_DECLINED', error: data.error || 'Ошибка банка при создании QR-кода' }, { stayOnScreen: true });
          }
        } catch (err) {
          showKioskError({ errorCode: 'NO_CONNECTION', error: `Ошибка связи: ${err.message}` }, { stayOnScreen: true });
        }
      } else {
        navigateTo('nfc');
        try {
          const res = await fetch(`${SERVER_URL}${BASE_PATH}/api/sber/pay`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: totalPrice, kioskId: KIOSK_ID })
          });
          const data = await res.json();

          if (paymentCancelledRef.current) return;

          if (data.success) {
            finalizeOrder();
          } else {
            showKioskError(data, { fallbackTitle: 'Оплата не прошла', stayOnScreen: true });
          }
        } catch (err) {
          if (paymentCancelledRef.current) return;
          showKioskError({ errorCode: 'NO_CONNECTION', error: `Ошибка связи с банком: ${err.message}` }, { stayOnScreen: true });
        }
      }
    },
    [navigateTo, totalPrice, cart, tableNumber]
  );

  return {
    step, activeCategory, cart, isCartModalOpen, transition, tagsList, activeTag,
    tableNumber, setTableNumber, setStep, setActiveCategory: handleCategoryChange, setActiveTag,
    setIsCartModalOpen, addToCart, updateQuantity, handleStartOrder: (type = 'in_hall') => { setOrderType(type); navigateTo('menu'); },
    startPayment, navigateTo, resetKiosk, clearCart, cancelPayment,
    menuItems: dynamicMenu, categories, filteredItems, totalPrice, lastOrderId,
    orderType, setOrderType, receiptData, printPaperReceipt, setPrintPaperReceipt,
    globalError, dismissGlobalError, printerWarning, clearPrinterWarning,
    sbpQrString, kioskId: KIOSK_ID, idleResetInSeconds
  };
}