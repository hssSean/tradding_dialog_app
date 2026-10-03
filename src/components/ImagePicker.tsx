import { useEffect, useState } from 'react'
import { compressImage } from '../lib/image'

/** 選圖 → 在手機上壓縮 → 預覽。上傳由呼叫端在交易存檔後處理。 */
export default function ImagePicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: Blob | null
  onChange: (b: Blob | null) => void
}) {
  const [preview, setPreview] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!value) {
      setPreview(undefined)
      return
    }
    const url = URL.createObjectURL(value)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value])

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(undefined)
    try {
      onChange(await compressImage(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm text-zinc-400">{label}</span>
      {preview ? (
        <div className="space-y-1">
          <img src={preview} alt={label} className="max-h-64 w-full rounded-lg bg-black object-contain" />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{Math.round((value?.size ?? 0) / 1024)} KB</span>
            <button type="button" className="min-h-11 px-3 text-red-400" onClick={() => onChange(null)}>
              移除
            </button>
          </div>
        </div>
      ) : (
        <label className="flex min-h-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-700 text-sm text-zinc-500">
          {busy ? '壓縮中…' : '＋ 選擇截圖'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      )}
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  )
}
