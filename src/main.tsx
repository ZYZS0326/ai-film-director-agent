import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* 顶层兜底：任何未捕获的渲染错误都不该变成一块白屏 */}
    <ErrorBoundary full label="应用主界面">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
