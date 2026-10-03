import { useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from './draft'

/**
 * 表單狀態 + localStorage 草稿。開頁時若有舊草稿，放在 pending 讓使用者決定還原或捨棄；
 * 使用者直接開始填，舊草稿就被新內容覆蓋。
 */
export function useDraftForm<T>(key: string, initial: T) {
  const [form, setFormState] = useState<T>(initial)
  const [pending, setPending] = useState<T | null>(() => loadDraft<T>(key))

  return {
    form,
    pending,
    setForm(f: T) {
      setFormState(f)
      setPending(null)
      saveDraft(key, f)
    },
    restore() {
      if (pending) setFormState(pending)
      setPending(null)
    },
    discard() {
      clearDraft(key)
      setPending(null)
    },
    clear() {
      clearDraft(key)
    },
  }
}
