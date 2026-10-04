export const formatWorktreeEntries = (entries: readonly string[]): string => {
  if (entries.length === 0) return ""
  if (entries.length === 1) return entries[0] ?? ""
  const latest = entries[entries.length - 1] ?? ""
  return `${latest} (${entries.length})`
}
