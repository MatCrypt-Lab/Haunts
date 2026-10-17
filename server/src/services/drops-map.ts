import { cellToLatLng, getCity, getNeighbourhood, type DropDetails } from '@unfog/core';

export type DropRow = {
  id: string;
  kind: 'community' | 'venue' | 'quest';
  title: string;
  note: string | null;
  sponsor: string | null;
  cell: string;
  city_id: string | null;
  neighbourhood_id: string | null;
  created_by: string | null;
};

export function neighbourhoodName(cityId: string | null, nbId: string | null): string | null {
  if (!cityId || !nbId) return null;
  const city = getCity(cityId);
  return (city && getNeighbourhood(city, nbId)?.name) ?? null;
}

export function toDropDetails(row: DropRow, viewerId: string): DropDetails {
  const p = cellToLatLng(row.cell);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    note: row.note,
    sponsor: row.sponsor,
    cell: row.cell,
    lat: p.lat,
    lng: p.lng,
    neighbourhoodName: neighbourhoodName(row.city_id, row.neighbourhood_id),
    isMine: row.created_by === viewerId,
  };
}

export const DROP_COLUMNS = 'd.id, d.kind, d.title, d.note, d.sponsor, d.cell, d.city_id, d.neighbourhood_id, d.created_by';
export const DROP_ACTIVE_SQL = 'NOT d.hidden AND d.starts_at <= now() AND (d.ends_at IS NULL OR d.ends_at > now())';
