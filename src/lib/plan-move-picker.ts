/** The Add moves picker's list: the library narrowed by a sport chip ("" is All), then by search. */
export function pickerMoves<
  M extends { sport: string; name: string; category: string; cue: string },
>(moves: M[], sport: string, query: string): M[] {
  const q = query.trim().toLowerCase();
  return moves.filter((m) => {
    if (sport && m.sport !== sport) return false;
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.cue.toLowerCase().includes(q)
    );
  });
}
