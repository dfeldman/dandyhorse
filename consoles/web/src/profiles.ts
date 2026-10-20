// Profiles, the status timeline, leaderboards and cheers (PLAN.md §18.6–18.7): the console's calls and the
// small bits of presentation they share. Pure helpers are unit-tested.
import { api, query } from './api'
import type {
  Board, BoardResponse, BoardsResponse, PlayerCard, PlayersResponse, Profile, ProfileUpdate, Streak,
} from './types'

export const players = () => api<PlayersResponse>('/api/profiles').then((r) => r.players)
export const profile = (username: string) => api<Profile>(`/api/profiles/${encodeURIComponent(username)}`)
export const boards = () => api<BoardsResponse>('/api/leaderboards').then((r) => r.boards)
export const board = (id: string, period?: string) =>
  api<BoardResponse>(`/api/leaderboards/${encodeURIComponent(id)}${query({ period })}`)
export const timeline = (username: string, before?: string, limit = 30) =>
  api<{ updates: ProfileUpdate[] }>(
    `/api/profiles/${encodeURIComponent(username)}/updates${query({ before, limit })}`).then((r) => r.updates)
export const postUpdate = (text: string) => api<ProfileUpdate>('/api/profile/updates', 'POST', { text })
export const deleteUpdate = (id: string) => api(`/api/profile/updates/${encodeURIComponent(id)}`, 'DELETE')
/** Toggle a "ride on" on somebody's update. */
export const cheer = (id: string) =>
  api<{ cheers: number; cheered: boolean }>(`/api/updates/${encodeURIComponent(id)}/cheer`, 'POST')

/** The name to show for a player: their real name if they gave one, else the display name, else the handle. */
export function playerName(p: Pick<PlayerCard, 'firstName' | 'lastName' | 'displayName' | 'username'>): string {
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ').trim()
  return full || (p.displayName || '').trim() || p.username
}

/** 🔥 for a streak going, an unlit one for a goal not yet met. '' when no goal is set. */
export function streakIcon(s: Streak | undefined): string {
  if (!s?.goal) return ''
  return s.length > 0 ? '🔥' : '🕯️'
}

export function streakText(s: Streak | undefined): string {
  if (!s?.goal) return ''
  if (s.length === 0) return `aiming for ${s.goal} a week`
  return `${s.length} week${s.length === 1 ? '' : 's'} at ${s.goal} a week`
}

/** 1st, 2nd, 3rd… for a rank badge. */
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** 🥇🥈🥉 for the podium, else the plain number. */
export function rankBadge(rank: number | null): string {
  if (rank === null) return '—'
  return ['🥇', '🥈', '🥉'][rank - 1] ?? String(rank)
}

/** Boards grouped for the page: this week's first, since that is the one people check. */
export function groupBoards(list: Board[]): { title: string; boards: Board[] }[] {
  const of = (p: Board['period']) => list.filter((b) => b.period === p)
  return [
    { title: 'This week', boards: of('week') },
    { title: 'This month', boards: of('month') },
    { title: 'All time', boards: of('all') },
  ].filter((g) => g.boards.length > 0)
}

/** The kind of update, as one glyph. */
export function updateIcon(kind: ProfileUpdate['kind']): string {
  return { session: '🚴', streak: '🔥', achievement: '🏅', manual: '💬' }[kind] ?? '•'
}
