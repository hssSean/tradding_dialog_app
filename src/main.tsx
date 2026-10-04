import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AuthGate from './components/AuthGate'
import Layout from './components/Layout'
import './index.css'
import './components/home/home.css'
import Character from './pages/Character'
import CloseTrade from './pages/CloseTrade'
import Dex from './pages/Dex'
import EditTrade from './pages/EditTrade'
import Home from './pages/Home'
import NewTrade from './pages/NewTrade'
import Notes from './pages/Notes'
import TradeDetail from './pages/TradeDetail'
import TradeList from './pages/TradeList'
import WeeklyReview from './pages/WeeklyReview'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="log" element={<TradeList />} />
            <Route path="dex" element={<Dex />} />
            <Route path="me" element={<Character />} />
            <Route path="card/new" element={<NewTrade mode="card" />} />
            <Route path="trade/new" element={<NewTrade mode="late" />} />
            <Route path="trade/:id" element={<TradeDetail />} />
            <Route path="trade/:id/close" element={<CloseTrade />} />
            <Route path="trade/:id/edit" element={<EditTrade />} />
            <Route path="notes" element={<Notes />} />
            <Route path="review" element={<WeeklyReview />} />
            <Route path="review/:week" element={<WeeklyReview />} />
            {/* v1 的舊網址 */}
            <Route path="new" element={<Navigate to="/card/new" replace />} />
            <Route path="settings" element={<Navigate to="/me" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthGate>
  </StrictMode>,
)
