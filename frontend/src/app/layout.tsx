import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HarryRAG — Ask your documents',
  description: 'Chat with any document using hybrid RAG + LLM, by Muhammad Haris',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
