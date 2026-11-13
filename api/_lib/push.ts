import crypto from 'node:crypto'
// Web Push 送出。訂閱失效（404／410）回報給呼叫端刪除。
import { sendNotification, setVapidDetails } from 'web-push'

export interface Sub {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface Payload {
  title: string
  body: string
  url: string
  tag: string
}

let configured = false
function configure(): void {
  if (configured) return
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) throw new Error('伺服器還沒設定 VAPID_PUBLIC_KEY／VAPID_PRIVATE_KEY')
  setVapidDetails(process.env.VAPID_SUBJECT || 'https://tradding-dialog-app.vercel.app', pub, priv)
  configured = true
}

/** 送給每個訂閱；ok = 至少一個送達；gone = 已失效要刪的訂閱 id */
export async function sendAll(subs: Sub[], payload: Payload): Promise<{ ok: boolean; gone: string[]; errors: string[] }> {
  configure()
  const gone: string[] = []
  const errors: string[] = []
  let ok = false
  for (const s of subs) {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 })
      ok = true
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) gone.push(s.id)
      // 推播服務的回應內容（Apple 會寫原因，例如 {"reason":"BadJwtToken"}）
      else errors.push(`${code ?? ''} ${(e as { body?: string }).body || (e instanceof Error ? e.message : String(e))}`.trim())
    }
  }
  return { ok, gone, errors }
}

/** 診斷用：VAPID 設定是否一致（只回傳是否相符，不回傳金鑰） */
export function vapidDiagnosis(): Record<string, string | boolean> {
  const pub = process.env.VAPID_PUBLIC_KEY ?? ''
  const priv = process.env.VAPID_PRIVATE_KEY ?? ''
  const vite = process.env.VITE_VAPID_PUBLIC_KEY ?? ''
  let derived = ''
  try {
    const ecdh = crypto.createECDH('prime256v1')
    ecdh.setPrivateKey(Buffer.from(priv, 'base64url'))
    derived = ecdh.getPublicKey().toString('base64url')
  } catch {
    derived = 'invalid'
  }
  const subject = process.env.VAPID_SUBJECT ?? ''
  return {
    privMatchesPub: derived === pub,
    pubMatchesVite: pub === vite,
    pubLen: String(pub.length),
    subject: subject.startsWith('mailto:') ? 'mailto' : subject.startsWith('https://') ? 'https' : subject ? 'other' : 'unset',
  }
}
