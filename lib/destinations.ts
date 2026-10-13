/**
 * Destination display names — pure, client-safe (no Supabase import).
 *
 * The name shown in copy comes from `destinations.name` in the database, shortened to the part
 * before the first comma: "Barcelona, Spain" -> "Barcelona", "Malta" -> "Malta",
 * "Andalusian Corridor, Spain" -> "Andalusian Corridor". The server reads the row (page.tsx,
 * the recommend route, loadWeatherTab.ts) and passes the short name down; nothing types a
 * destination name in.
 */

export function shortDestinationName(fullName: string): string {
  return fullName.split(',')[0].trim();
}

/** Fallback only, for when the destinations row could not be read: "andalusian-corridor" -> "Andalusian Corridor". */
export function humanizeDestinationSlug(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Short name from a destinations row's `name`, falling back to the humanised slug. */
export function destinationDisplayName(name: string | null | undefined, slug: string): string {
  return name ? shortDestinationName(name) : humanizeDestinationSlug(slug);
}
