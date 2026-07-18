import type { Metadata } from 'next'
import './globals.css'
import { ToastProvider } from './components/Toast'
import { ThemeProvider } from './components/ThemeProvider'

export const metadata: Metadata = {
  title: 'helpdesk — HR for small businesses',
  description: 'Simple AI-powered HR for small businesses',
}

// Runs before hydration so `data-theme` is set on first paint, avoiding a
// flash of the wrong theme while ThemeProvider's effect hasn't run yet.
const setThemeBeforeHydration = `
try {
  var t = localStorage.getItem('theme');
  document.documentElement.dataset.theme = (t === 'light' || t === 'dark') ? t : 'dark';
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: setThemeBeforeHydration }} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
