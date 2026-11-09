/** Plain mutable state shared by the scroll story (writer) and the 3D city (reader). */
export const cityStore = {
  /** Story position, 0 to 3: fog lifts, memory, crews, Ask. */
  chapter: 0,
  /** 0 hides the city after the story has scrolled past. */
  visible: 1,
  /** Scroll speed nudges the walkers. */
  boost: 0,
  painted: 0,
};
