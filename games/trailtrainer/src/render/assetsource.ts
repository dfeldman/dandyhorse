/**
 * Where the nature libraries (trees, plants, rocks) and the rider's avatar assets come from.
 *
 * By default, the shared asset bucket: assetkit's `assetkit-trees`, `assetkit-plants` and `assetkit-rocks`
 * indexes, managed with assetmgr (github.com/dfeldman/assetmgr) and read over public HTTPS with no key. Each
 * assetmgr asset keeps the entry Trail Trainer's own `index.json` had for it in `extra.trailtrainer`, file name
 * included, so the rest of the renderer still asks for `oak_003.glb` and gets the same height, crown radius and
 * season it always did; only the URL it is fetched from changes. The GLBs' textures sit beside them in the
 * bucket under their own content-hashed names, which the import rewrote into each file.
 *
 * `?assets=local` (or `Config.assetSource = 'local'`) reads assetkit's generated `public/trees|plants|rocks/` instead
 * (through the dev server, at ASSETKIT_DIR), for working offline with a library regenerated locally.
 */
import { Config } from '../config.ts'
import type { Library } from './ecology.ts'

/** One entry of a library, as Trail Trainer's generators wrote it (and assetkit keeps it). */
export interface LibraryEntry {
  species: string
  file: string
  season?: string
  height?: number
  crown_radius?: number
  bounds?: { top: number; bottom: number; radius: number }
  [k: string]: unknown
}

export interface LibraryIndex {
  entries: LibraryEntry[]
  /** The URL to load one of the library's files from. */
  url(file: string): string
}

const INDEX_NAME: Record<Library, string> = {
  trees: 'assetkit-trees',
  plants: 'assetkit-plants',
  rocks: 'assetkit-rocks',
}

interface BucketAsset {
  isDeleted?: boolean
  isTemp?: boolean
  assetFiles: { filename: string; isDeleted?: boolean; isProd?: boolean; fileFormat?: string }[]
  extra?: { trailtrainer?: LibraryEntry }
}

/** 'bucket' or 'local', from the page's ?assets= or the config. */
export function assetSource(): 'bucket' | 'local' {
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('assets')
  return q === 'local' || q === 'bucket' ? q : Config.assetSource
}

const cache = new Map<Library, Promise<LibraryIndex | null>>()

/**
 * A library's index and where its files are. Null when the library can't be read: the caller treats that as an
 * empty library, as it always treated a missing local one.
 */
export function libraryIndex(lib: Library): Promise<LibraryIndex | null> {
  let p = cache.get(lib)
  if (!p) {
    p = (assetSource() === 'local' ? localIndex(lib) : bucketIndex(lib)).catch((e) => {
      console.warn(`assets: the ${lib} library could not be read`, e)
      return null
    })
    cache.set(lib, p)
  }
  return p
}

/**
 * A sibling repo's file through the dev server's /@fs/ route (vite.config.ts takes the repo paths from
 * AVATARKIT_DIR / ASSETKIT_DIR). Nothing is symlinked into this repo.
 */
export function siblingUrl(repo: 'avatarkit' | 'assetkit', rel: string): string {
  const dir = repo === 'avatarkit' ? (typeof __AVATARKIT_DIR__ === 'string' ? __AVATARKIT_DIR__ : '') : (typeof __ASSETKIT_DIR__ === 'string' ? __ASSETKIT_DIR__ : '')
  return new URL(`/@fs${dir}/${rel}`, location.origin).href
}

async function localIndex(lib: Library): Promise<LibraryIndex | null> {
  const base = siblingUrl('assetkit', `public/${lib}/`)
  const res = await fetch(`${base}index.json`)
  if (!res.ok) return null
  const body = (await res.json()) as { trees: LibraryEntry[] }
  return { entries: body.trees, url: (file) => `${base}${file}` }
}

async function bucketIndex(lib: Library): Promise<LibraryIndex> {
  const base = Config.assetBucket.replace(/\/+$/, '')
  const res = await fetch(`${base}/asset-index-${INDEX_NAME[lib]}.json`)
  if (!res.ok) throw new Error(`asset index ${INDEX_NAME[lib]}: HTTP ${res.status}`)
  const index = (await res.json()) as { assets: BucketAsset[] }
  const entries: LibraryEntry[] = []
  const urls = new Map<string, string>()
  for (const a of index.assets) {
    const entry = a.extra?.trailtrainer
    if (a.isDeleted || a.isTemp || !entry?.file) continue
    const glb = a.assetFiles.find((f) => !f.isDeleted && f.fileFormat === 'glb' && f.isProd) ?? a.assetFiles.find((f) => !f.isDeleted && f.fileFormat === 'glb')
    if (!glb) continue
    entries.push(entry)
    urls.set(entry.file, `${base}/${glb.filename}`)
  }
  return {
    entries,
    url: (file) => {
      const u = urls.get(file)
      if (!u) throw new Error(`${lib}/${file} is not in ${INDEX_NAME[lib]}`)
      return u
    },
  }
}
