/**
 * Skill-name normalisation shared by every route that writes
 * candidate_skill rows (extension capture, manual create). One rule, one
 * place: the unique index is on (candidate_id, normalized_name).
 */

/** Skills deduped by normalizedName (lower+trim), blanks skipped. */
export function dedupeSkills(skills: string[]): Array<{ name: string, normalizedName: string }> {
  const seen = new Set<string>()
  const out: Array<{ name: string, normalizedName: string }> = []
  for (const raw of skills) {
    const name = raw.trim()
    if (!name) continue
    const normalizedName = name.toLowerCase()
    if (seen.has(normalizedName)) continue
    seen.add(normalizedName)
    out.push({ name, normalizedName })
  }
  return out
}
