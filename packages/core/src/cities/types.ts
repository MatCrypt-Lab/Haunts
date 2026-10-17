export type Neighbourhood = { id: string; name: string; lat: number; lng: number };

export type CityDefinition = {
  id: string;
  name: string;
  /** Offset from UTC in minutes, used for the city's day and week boundaries. */
  tzOffsetMinutes: number;
  /** A cell belongs to the city only if its nearest anchor is within this distance. */
  maxDistanceM: number;
  neighbourhoods: Neighbourhood[];
};

export type CityStats = {
  totalCells: number;
  cellsByNeighbourhood: Record<string, number>;
};

export type CityBBox = { south: number; west: number; north: number; east: number };
