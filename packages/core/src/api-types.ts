/** Response shapes shared by the server and the app. */

export type CrewSummary = { id: string; name: string; color: string; isOwner: boolean };

export type Me = {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  cityId: string;
  crew: CrewSummary | null;
  createdAt: string;
};

export type AuthResult = { token: string; user: Me; isNew: boolean };

export type FoundDrop = DropDetails;

export type NewTitle = { kind: 'pioneer'; cityId: string; neighbourhoodId: string; neighbourhoodName: string };

export type VisitsResult = {
  accepted: number;
  newCells: number;
  newCellDays: number;
  foundDrops: FoundDrop[];
  newTitles: NewTitle[];
};

export type NeighbourhoodProgress = { id: string; name: string; explored: number; total: number; pct: number };

export type Stats = {
  totalCells: number;
  today: string;
  weekCellDays: number;
  streakDays: number;
  city: { id: string; name: string; explored: number; total: number; pct: number } | null;
  neighbourhoods: NeighbourhoodProgress[];
};

export type Title =
  | { kind: 'pioneer'; neighbourhoodId: string; neighbourhoodName: string }
  | { kind: 'territory'; neighbourhoodId: string; neighbourhoodName: string; crewName: string }
  | { kind: 'local_legend'; neighbourhoodId: string; neighbourhoodName: string };

export type CrewMember = {
  id: string;
  username: string | null;
  displayName: string | null;
  isOwner: boolean;
  totalCells: number;
  weekCellDays: number;
};

export type CrewDetails = {
  id: string;
  name: string;
  color: string;
  inviteCode: string;
  isOwner: boolean;
  members: CrewMember[];
  maxMembers: number;
};

export type CrewMapCell = { cell: string; members: number };

export type TerritoryNeighbourhood = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  owner: { crewId: string; name: string; color: string; score: number } | null;
  myCrewScore: number;
};

export type TerritoryLeaderRow = {
  crewId: string;
  name: string;
  color: string;
  owned: number;
  score: number;
  rank: number;
};

export type Territory = {
  cityId: string;
  weekStart: string;
  weekEnd: string;
  neighbourhoods: TerritoryNeighbourhood[];
  leaderboard: TerritoryLeaderRow[];
  myCrew: TerritoryLeaderRow | null;
};

export type DropDetails = {
  id: string;
  kind: 'community' | 'venue' | 'quest';
  title: string;
  note: string | null;
  sponsor: string | null;
  cell: string;
  lat: number;
  lng: number;
  neighbourhoodName: string | null;
  isMine: boolean;
};

export type DropTeaser = {
  id: string;
  kind: 'community' | 'venue' | 'quest';
  sponsor: string | null;
  neighbourhoodId: string | null;
  neighbourhoodName: string | null;
  /** Anchor point of the neighbourhood, never the drop's own location. */
  hintLat: number | null;
  hintLng: number | null;
};

export type DropsList = { found: DropDetails[]; hidden: DropTeaser[] };

export type Recap = {
  month: string;
  newCells: number;
  cellDays: number;
  activeDays: number;
  dropsFound: number;
  city: { id: string; name: string; pctStart: number; pctEnd: number } | null;
  topNeighbourhoods: { id: string; name: string; cellDays: number }[];
  pioneered: { id: string; name: string }[];
};

export type ChallengeTeamRow = {
  id: string;
  name: string;
  color: string;
  members: number;
  score: number;
  rank: number;
};

export type ChallengeView = {
  id: string;
  name: string;
  cityId: string;
  startsOn: string;
  endsOn: string;
  status: 'upcoming' | 'live' | 'ended';
  myTeamId: string;
  teams: ChallengeTeamRow[];
  myTeamTop: { userId: string; username: string | null; score: number }[];
};

export type MemoryBackupInfo = { sizeBytes: number; updatedAt: string };
export type MemoryBackup = MemoryBackupInfo & { data: string };
