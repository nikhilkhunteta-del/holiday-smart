/** [2019, 2022, 2023, 2024] -> "2019, 2022-2024" (sorted, consecutive runs collapsed).
 *  Storage format for weather_window_stats year-list columns (sea_temp_years,
 *  severe_rain_years). Shared by Tasks 4b and 4c so both columns read the same way. */
export function formatYears(years: number[]): string {
  const s = [...years].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}
