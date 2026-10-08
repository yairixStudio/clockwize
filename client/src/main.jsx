import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/global.css'

// Inside the desktop app (desktop/preload.js) the window has a hidden title bar
if (window.clockwizeDesktop?.isDesktop) {
  document.documentElement.classList.add('is-desktop')
  const titlebar = document.createElement('div')
  titlebar.className = 'desktop-titlebar'
  titlebar.setAttribute('aria-hidden', 'true')
  document.body.prepend(titlebar)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

