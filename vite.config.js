import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  // 💡 БАЗОВЫЙ ПУТЬ ДЛЯ СЕРВЕРА VDS (чтобы сайт открывался по адресу quok.art/pizza/)
  base: '/pizza/',

  plugins: [
    react(),
    legacy({
      // Гарантируем работу на старых кассах и планшетах (Android 6+)
      targets: ['chrome >= 44', 'android >= 6'],
      polyfills: true
    })
  ],
  build: {
    // Делаем современный код совместимым со старыми устройствами
    target: 'chrome60',
    cssTarget: 'chrome60'
  },
  server: {
    host: true, 
    allowedHosts: [
      'quok.art',                        // Разрешаем ваш основной домен
      'g7v2cj-37-214-34-200.ru.tuna.am', // Ваш адрес туннеля (если используете)
      '.tuna.am'                         
    ]
  },
  preview: {
    host: true,
    allowedHosts: [
      'quok.art',
      'g7v2cj-37-214-34-200.ru.tuna.am',
      '.tuna.am'
    ]
  }
})