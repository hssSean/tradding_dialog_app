import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AuthGate from './components/AuthGate'
import Layout from './components/Layout'
import './index.css'
import CloseTrade from './pages/CloseTrade'
import EditTrade from './pages/EditTrade'
import NewTrade from './pages/NewTrade'
import Settings from './pages/Settings'
import TradeDetail from './pages/TradeDetail'
import TradeList from './pages/TradeList'
import WeeklyReview from './pages/WeeklyReview'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<TradeList />} />
            <Route path="new" element={<NewTrade />} />
            <Route path="trade/:id" element={<TradeDetail />} />
            <Route path="trade/:id/close" element={<CloseTrade />} />
            <Route path="trade/:id/edit" element={<EditTrade />} />
            <Route path="review" element={<WeeklyReview />} />
            <Route path="review/:week" element={<WeeklyReview />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthGate>
  </StrictMode>,
)
