import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import KitchenApp from './KitchenApp.jsx';
import BoardApp from './BoardApp.jsx';
import AdminApp from './AdminApp.jsx';
import DeliveryApp from './DeliveryApp.jsx'; // 💡 Подключили доставку
import './index.css';

// ============================================================================
// ГЛОБАЛЬНЫЙ ПЕРЕХВАТЧИК ОШИБОК
// ============================================================================
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, windowError: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("React Error:", error, errorInfo);
  }

  componentDidMount() {
    window.onerror = (message, source, lineno, colno, error) => {
      this.setState({ hasError: true, windowError: `${message} в файле ${source} (строка ${lineno}:${colno})` });
      return true;
    };
    window.onunhandledrejection = (event) => {
      this.setState({ hasError: true, windowError: `Необработанный Promise: ${event.reason}` });
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ backgroundColor: '#990000', color: 'white', minHeight: '100vh', padding: '30px', fontFamily: 'monospace', zIndex: 99999, position: 'relative' }}>
          <h1 style={{ fontSize: '30px', fontWeight: 'bold', marginBottom: '20px' }}>Критическая ошибка приложения</h1>
          <div style={{ display: 'flex', gap: '15px', marginBottom: '30px' }}>
            <button onClick={() => window.location.reload()} style={{ padding: '15px 30px', fontSize: '20px', backgroundColor: '#fff', color: '#990000', border: 'none', borderRadius: '10px', fontWeight: 'bold' }}>Перезагрузить приложение</button>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} style={{ padding: '15px 30px', fontSize: '20px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold' }}>Сбросить память (Очистить кэш)</button>
          </div>
          <div style={{ backgroundColor: '#000', padding: '20px', borderRadius: '10px', overflowX: 'auto', fontSize: '16px', lineHeight: '1.5' }}>
            <p style={{ color: '#ffb3b3' }}><strong>Системная ошибка (Android WebView):</strong> {this.state.windowError || 'Нет'}</p>
            <p style={{ color: '#ffb3b3', marginTop: '15px' }}><strong>Ошибка React:</strong> {this.state.error ? this.state.error.toString() : 'Нет'}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// ГЛАВНОЕ МЕНЮ И ЛОГИКА ВЫБОРА РОЛЕЙ
// ============================================================================
function Main() {
  const path = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '';
  const search = typeof window !== 'undefined' ? window.location.search.toLowerCase() : '';

  // 💡 Автоматически включаем доставку, если открыто по прямой ссылке /delivery
  const isDirectDelivery = path.includes('/delivery') || search.includes('delivery');

  const [role, setRole] = useState(() => {
    if (isDirectDelivery) return 'delivery';
    return localStorage.getItem('TALVI_APP_ROLE');
  });

  const tapTimestamps = useRef([]);

  useEffect(() => {
    const handleSecretTap = (e) => {
      // Квадрат 150x150 пикселей в верхнем левом или правом углу
      const isTopLeft = e.clientX < 150 && e.clientY < 150;
      const isTopRight = e.clientX > window.innerWidth - 150 && e.clientY < 150;

      if (!isTopLeft && !isTopRight) {
        tapTimestamps.current = [];
        return;
      }

      const now = Date.now();
      
      // Храним тапы только за последние 5 секунд
      tapTimestamps.current = tapTimestamps.current.filter(t => now - t < 5000);
      tapTimestamps.current.push(now);

      // Если собрали 15 тапов — сбрасываем роль и выходим в главное меню
      if (tapTimestamps.current.length >= 15) {
        localStorage.removeItem('TALVI_APP_ROLE');
        setRole(null);
        tapTimestamps.current = [];
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]); 
      }
    };

    window.addEventListener('pointerdown', handleSecretTap);
    return () => window.removeEventListener('pointerdown', handleSecretTap);
  }, []);

  const selectRole = (selectedRole) => {
    localStorage.setItem('TALVI_APP_ROLE', selectedRole);
    setRole(selectedRole);
  };

  if (!role) {
    return (
      <div className="min-h-screen bg-[#1C1C1E] flex flex-col items-center justify-center font-sans select-none px-6 py-10">
        <h1 className="text-white text-4xl font-black mb-12 tracking-tight text-center">Выберите роль устройства</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 w-full max-w-5xl">
          
          <button onClick={() => selectRole('kiosk')} className="bg-[#FF7A00] p-8 sm:p-10 rounded-[32px] active:scale-95 transition-transform shadow-2xl flex flex-col items-center justify-center cursor-pointer">
            <div className="text-6xl mb-4">🖥️</div>
            <h2 className="text-white text-xl sm:text-2xl font-bold text-center">Киоск (Зал)</h2>
          </button>

          <button onClick={() => selectRole('kitchen')} className="bg-[#0A84FF] p-8 sm:p-10 rounded-[32px] active:scale-95 transition-transform shadow-2xl flex flex-col items-center justify-center cursor-pointer">
            <div className="text-6xl mb-4">🧑‍🍳</div>
            <h2 className="text-white text-xl sm:text-2xl font-bold text-center">Кухня (KDS)</h2>
          </button>

          <button onClick={() => selectRole('board')} className="bg-[#32D74B] p-8 sm:p-10 rounded-[32px] active:scale-95 transition-transform shadow-2xl flex flex-col items-center justify-center cursor-pointer">
            <div className="text-6xl mb-4">📺</div>
            <h2 className="text-white text-xl sm:text-2xl font-bold text-center">Табло Зала</h2>
          </button>

          {/* 💡 НОВАЯ РОЛЬ: ДОСТАВКА */}
          <button onClick={() => selectRole('delivery')} className="bg-[#5856D6] p-8 sm:p-10 rounded-[32px] active:scale-95 transition-transform shadow-2xl flex flex-col items-center justify-center cursor-pointer">
            <div className="text-6xl mb-4">🛵</div>
            <h2 className="text-white text-xl sm:text-2xl font-bold text-center">Доставка (App)</h2>
          </button>

          <button onClick={() => selectRole('admin')} className="bg-[#8E8E93] p-8 sm:p-10 rounded-[32px] active:scale-95 transition-transform shadow-2xl flex flex-col items-center justify-center cursor-pointer md:col-span-2">
            <div className="text-6xl mb-4">⚙️</div>
            <h2 className="text-white text-xl sm:text-2xl font-bold text-center">Админка</h2>
          </button>

        </div>
      </div>
    );
  }

  if (role === 'kiosk') return <App />;
  if (role === 'kitchen') return <KitchenApp />;
  if (role === 'board') return <BoardApp />;
  if (role === 'admin') return <AdminApp />;
  if (role === 'delivery') return <DeliveryApp />;
  
  return null;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Main />
    </ErrorBoundary>
  </React.StrictMode>
);