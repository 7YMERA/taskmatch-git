import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TaskMatch',
  description: 'Task-Skill Matching & WIP Allocation System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" style={{ background: '#111111' }}>
      <body style={{ background: '#111111', color: 'white', minHeight: '100vh', margin: 0 }}>
        {children}
      </body>
    </html>
  )
}