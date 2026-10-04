import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Catalog, EventsPage, ListEntry, Server, Stats, StatsRange, User, UserRow } from './types'

export interface MeResponse {
  user: User | null
  needsSetup: boolean
}

export const keys = {
  me: ['me'] as const,
  catalog: ['catalog'] as const,
  servers: ['servers'] as const,
  server: (id: string) => ['server', id] as const,
  stats: (id: string, range: StatsRange) => ['server', id, 'stats', range] as const,
  events: (id: string, filters: EventFilters) => ['server', id, 'events', filters] as const,
  lists: (id: string) => ['server', id, 'lists'] as const,
  users: ['users'] as const,
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<MeResponse>('/auth/me'), staleTime: 60_000, retry: false })
}

export function useCatalog() {
  return useQuery({ queryKey: keys.catalog, queryFn: () => api.get<Catalog>('/meta/catalog'), staleTime: Infinity })
}

export function useServers() {
  return useQuery({
    queryKey: keys.servers,
    queryFn: () => api.get<{ items: Server[] }>('/servers').then((r) => r.items),
    refetchInterval: 10_000,
  })
}

export function useServer(id: string) {
  return useQuery({
    queryKey: keys.server(id),
    queryFn: () => api.get<{ server: Server }>(`/servers/${id}`).then((r) => r.server),
    refetchInterval: 8_000,
  })
}

export function useStats(id: string, range: StatsRange) {
  return useQuery({
    queryKey: keys.stats(id, range),
    queryFn: () => api.get<Stats>(`/servers/${id}/stats?range=${range}`),
    refetchInterval: 15_000,
  })
}

export interface EventFilters {
  severity?: string
  type?: string
}

export function useEvents(id: string, filters: EventFilters, opts: { limit?: number; refetch?: boolean } = {}) {
  const limit = opts.limit ?? 40
  return useInfiniteQuery({
    queryKey: [...keys.events(id, filters), limit],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(limit) })
      if (pageParam) q.set('before', String(pageParam))
      if (filters.severity) q.set('severity', filters.severity)
      if (filters.type) q.set('type', filters.type)
      return api.get<EventsPage>(`/servers/${id}/events?${q.toString()}`)
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: opts.refetch === false ? false : 12_000,
  })
}

export function useLists(id: string) {
  return useQuery({
    queryKey: keys.lists(id),
    queryFn: () => api.get<{ items: ListEntry[]; limit: number }>(`/servers/${id}/lists`),
  })
}

export function useUsers() {
  return useQuery({
    queryKey: keys.users,
    queryFn: () => api.get<{ items: UserRow[] }>('/users').then((r) => r.items),
  })
}
