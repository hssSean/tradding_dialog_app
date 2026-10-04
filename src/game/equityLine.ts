/** 前山＝本季權益曲線（SPEC §3）：累積 R 做指數平滑，終點強制等於真實累積值。 */
export function smoothCumR(rs: number[]): { cum: number[]; smooth: number[] } {
  const cum = [0]
  for (const r of rs) cum.push(cum[cum.length - 1] + r)
  const smooth: number[] = []
  cum.forEach((c, i) => smooth.push(i === 0 ? c : smooth[i - 1] * 0.45 + c * 0.55))
  smooth[smooth.length - 1] = cum[cum.length - 1]
  return { cum, smooth }
}
