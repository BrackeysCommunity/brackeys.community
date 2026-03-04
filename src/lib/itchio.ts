const ITCHIO_API_BASE = 'https://api.itch.io'

export interface ItchIoUser {
  id: number
  username: string
  display_name: string
  url: string
  cover_url: string
  gamer: boolean
  developer: boolean
  press_user: boolean
}

export interface ItchIoGame {
  id: number
  title: string
  short_text: string
  url: string
  cover_url: string
  type: string
  published: boolean
  published_at: string
  created_at: string
  downloads_count: number
  views_count: number
  purchases_count: number
  min_price: number
  p_windows: boolean
  p_linux: boolean
  p_osx: boolean
  p_android: boolean
}

async function itchApiFetch<T>(endpoint: string, accessToken: string): Promise<T> {
  const res = await fetch(`${ITCHIO_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`itch.io API error (${res.status}): ${body}`)
  }

  return res.json() as Promise<T>
}

export async function validateToken(accessToken: string): Promise<ItchIoUser> {
  const data = await itchApiFetch<{ user: ItchIoUser }>('/profile', accessToken)
  return data.user
}

export async function fetchGames(accessToken: string): Promise<ItchIoGame[]> {
  const data = await itchApiFetch<{ games: ItchIoGame[] }>('/profile/games', accessToken)
  return data.games ?? []
}
