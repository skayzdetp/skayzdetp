import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api'
import { keys } from '@/lib/queries'
import { ThemeProvider } from '@/lib/theme'
import './index.css'

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // client errors (4xx) will not fix themselves – do not hammer the backend
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
  queryCache: new QueryCache({
    onError: (err) => {
      // session expired / signed out elsewhere → re-check who we are, the router then redirects to /login
      if (err instanceof ApiError && err.status === 401) queryClient.invalidateQueries({ queryKey: keys.me })
    },
  }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={150}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
