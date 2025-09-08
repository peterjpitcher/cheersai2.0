type ClickHeat = Record<string /* platform */ , number[] /* 7*24 bins */>

export function suggestBestTimes(heat: ClickHeat, platform: string): Array<{ weekday: number; hour: number; score: number }> {
  const bins = heat[platform] || new Array(168).fill(0)
  const picks: Array<{ weekday: number; hour: number; score: number }> = []
  bins.forEach((score, idx) => {
    picks.push({ weekday: Math.floor(idx / 24), hour: idx % 24, score })
  })
  picks.sort((a, b) => b.score - a.score)
  return picks.slice(0, 3)
}

