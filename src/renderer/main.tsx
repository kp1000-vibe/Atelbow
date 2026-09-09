import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import OverlayView from './components/OverlayView'
import './styles.css'

const isOverlay = window.location.hash === '#overlay'

if (isOverlay) {
  // The chat window's stylesheet paints a solid body background; the overlay window is
  // native-transparent and must stay see-through, so override it before first paint.
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isOverlay ? <OverlayView /> : <App />}</React.StrictMode>
)
