import { useQuery } from '@tanstack/react-query';
import type { ChallengeView, CrewDetails, CrewMapCell, DropsList, Recap, Stats, Territory, Title } from '@unfog/core';
import { api } from './api';

export const keys = {
  stats: ['stats'] as const,
  titles: ['titles'] as const,
  crew: ['crew'] as const,
  crewMap: ['crewMap'] as const,
  territory: ['territory'] as const,
  drops: ['drops'] as const,
  challenges: ['challenges'] as const,
  recap: (month: string) => ['recap', month] as const,
};

export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: () => api<Stats>('/me/stats') });
export const useTitles = () =>
  useQuery({ queryKey: keys.titles, queryFn: async () => (await api<{ titles: Title[] }>('/me/titles')).titles });
export const useCrew = () =>
  useQuery({ queryKey: keys.crew, queryFn: async () => (await api<{ crew: CrewDetails | null }>('/crews/mine')).crew });
export const useCrewMap = (enabled: boolean) =>
  useQuery({
    queryKey: keys.crewMap,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => (await api<{ cells: CrewMapCell[] }>('/crews/mine/map')).cells,
  });
export const useTerritory = () => useQuery({ queryKey: keys.territory, queryFn: () => api<Territory>('/territory') });
export const useDrops = () => useQuery({ queryKey: keys.drops, queryFn: () => api<DropsList>('/drops') });
export const useChallenges = () =>
  useQuery({
    queryKey: keys.challenges,
    queryFn: async () => (await api<{ challenges: ChallengeView[] }>('/challenges/mine')).challenges,
  });
export const useRecap = (month: string) => useQuery({ queryKey: keys.recap(month), queryFn: () => api<Recap>(`/me/recap?month=${month}`) });
