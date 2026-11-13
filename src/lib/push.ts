// 前端推播訂閱。iOS 只有從主畫面開啟的 PWA（16.4+）能訂閱。
import { deletePushSubscription, hasPushSubscription, savePushSubscription, sendTestPush } from './db'

export type PushStatus = 'unsupported' | 'need-install' | 'denied' | 'off' | 'on'

const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function pushStatus(): Promise<PushStatus> {
  if (!('PushManager' in window) || !('serviceWorker' in navigator) || !vapidKey) return isIos() && !isStandalone() ? 'need-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return 'off'
  // 訂閱可能已被伺服器刪掉（推播服務回 410）
  return (await hasPushSubscription(sub.endpoint)) ? 'on' : 'off'
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function enablePush(): Promise<void> {
  if (!vapidKey) throw new Error('沒有設定 VITE_VAPID_PUBLIC_KEY')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('沒有允許通知，請到 iPhone 設定 → 通知 打開')
  const reg = (await registration()) ?? (await navigator.serviceWorker.ready)
  const old = await reg.pushManager.getSubscription()
  const sub = old ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }))
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('訂閱資料不完整')
  await savePushSubscription({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
  await sendTestPush()
}

export async function disablePush(): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription()
  if (!sub) return
  await deletePushSubscription(sub.endpoint)
  await sub.unsubscribe()
}
