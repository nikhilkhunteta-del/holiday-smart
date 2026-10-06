/**
 * Which destinations show the Weather tab on the results page.
 *
 * A named allow-list, not "any destination with a weather row": andalusian-corridor has rows,
 * but they come from its old inland hill point and must not be shown until it is re-ingested
 * at Málaga (see CLAUDE.md). Add a slug here only once its weather rows are trusted.
 */
export const WEATHER_TAB_DESTINATIONS: readonly string[] = ['barcelona', 'malta'];

export function weatherTabEnabled(destinationSlug: string): boolean {
  return WEATHER_TAB_DESTINATIONS.includes(destinationSlug);
}
