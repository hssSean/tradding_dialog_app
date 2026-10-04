export default function DraftBanner({ onRestore, onDiscard }: { onRestore: () => void; onDiscard: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-moon/30 bg-moon/50 p-3 text-sm">
      <span className="text-moon">有上次沒送出的草稿</span>
      <div className="flex gap-2">
        <button type="button" className="min-h-10 rounded-md px-3 text-paper-dim" onClick={onDiscard}>
          捨棄
        </button>
        <button type="button" className="min-h-10 rounded-md bg-moon px-3 text-paper" onClick={onRestore}>
          還原
        </button>
      </div>
    </div>
  )
}
