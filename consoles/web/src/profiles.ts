// Profiles, the status timeline, leaderboards and cheers (PLAN.md §18.6–18.7): the console's calls and the
// small bits of presentation they share. Pure helpers are unit-tested.
import { api, query } from './api'
import type {
  Board, BoardResponse, BoardsResponse, CheerReceived, FeedEntry, HomeSummary, Notice, PersonalBest,
  PlayerCard, PlayersResponse, Profile, ProfileUpdate, Streak,
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

/**
 * The name to show for a player: their real name if they gave one, else the display name, else the handle.
 *
 * A private player has no handle at all — the server sends their pseudonym as `displayName` and nulls
 * everything else — so the handle is the last resort rather than a guarantee.
 */
export function playerName(p: Pick<PlayerCard, 'firstName' | 'lastName' | 'displayName'>
  & { username?: string | null }): string {
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ').trim()
  return full || (p.displayName || '').trim() || p.username || 'Somebody'
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

// --- the feed (PLAN.md §18.2) ---------------------------------------------------------------

export const feed = (before?: string, from?: 'following') => {
  const q = [before ? `before=${encodeURIComponent(before)}` : '', from ? `from=${from}` : ''].filter(Boolean)
  return api<{ entries: FeedEntry[]; more: boolean }>(`/api/feed${q.length ? `?${q.join('&')}` : ''}`)
}

export const cheersForMe = (before?: number) =>
  api<{ cheers: CheerReceived[]; more: boolean; unseen: number }>(
    `/api/feed/cheers${before ? `?before=${before}` : ''}`)

/** Clear the badge. Deliberately not done by merely fetching them — see the server's route. */
export const markCheersSeen = () => api<{ unseen: number }>('/api/feed/cheers/seen', 'POST')

export const homeSummary = () => api<HomeSummary>('/api/home')

export const personalBests = (username: string) =>
  api<{ bests: PersonalBest[] }>(`/api/profiles/${encodeURIComponent(username)}/bests`)
    .then((r) => r.bests)

// --- following (PLAN.md §18.2) ----------------------------------------------------------------

export const follow = (username: string) =>
  api<{ following: boolean; followers: number }>(
    `/api/profiles/${encodeURIComponent(username)}/follow`, 'POST')

export const unfollow = (username: string) =>
  api<{ following: boolean; followers: number }>(
    `/api/profiles/${encodeURIComponent(username)}/follow`, 'DELETE')

/** The people you follow. Yours alone: nobody may read whom somebody else is watching. */
export const followingList = () =>
  api<{ players: PlayerCard[]; following: number; followers: number }>('/api/following')

export const noticesForMe = (before?: string) =>
  api<{ notices: Notice[]; more: boolean; unseen: number }>(
    `/api/feed/notices${before ? `?before=${encodeURIComponent(before)}` : ''}`)

export const markNoticesSeen = () => api<{ unseen: number }>('/api/feed/notices/seen', 'POST')
