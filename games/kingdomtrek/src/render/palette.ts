import type { Biome } from '../content/types.ts'

export interface Palette {
  ground: [string, string]
  grass: string
  path: string
  pathEdge: string
  trees: string[]
  decor: string[]
  sky: [string, string]
  water?: string
}

/** One look per biome: towns, roads, battle backdrops and the map all use it. */
export const PALETTES: Record<Biome, Palette> = {
  plains: { ground: ['#a9da72', '#86c257'], grass: '#5f9e3a', path: '#ecd9a6', pathEdge: '#c9b07a', trees: ['🌳', '🌳', '🌲'], decor: ['🌼', '🌻', '🌾', '🐑', '🐄', '🌷'], sky: ['#8fd0ff', '#e8f6ff'] },
  forest: { ground: ['#62a24c', '#3f7f36'], grass: '#2c6428', path: '#cdb07a', pathEdge: '#9d8150', trees: ['🌲', '🌳', '🌲', '🌲'], decor: ['🍄', '🌿', '🦌', '🐿️', '🪵'], sky: ['#8fc9a5', '#dff3e3'] },
  hills: { ground: ['#b6db79', '#91bf60'], grass: '#6e9e44', path: '#e8d39e', pathEdge: '#c3aa72', trees: ['🌳', '🌲'], decor: ['🐑', '🪨', '🌼', '🐐'], sky: ['#9fd6ff', '#eef8ff'] },
  coast: { ground: ['#f3e3ae', '#e4cd8c'], grass: '#b7d487', path: '#dcc48e', pathEdge: '#b59c66', trees: ['🌴', '🌴', '🌳'], decor: ['🐚', '🦀', '🪸', '🌾'], sky: ['#86d0ff', '#f0fbff'], water: '#3a9fd3' },
  mountain: { ground: ['#bdb6a8', '#8e887c'], grass: '#6f8456', path: '#d9cba9', pathEdge: '#a39374', trees: ['🌲', '🌲'], decor: ['🪨', '⛰️', '🐐', '🪨'], sky: ['#b2c6df', '#eef2f8'] },
  swamp: { ground: ['#82a05a', '#5c7a40'], grass: '#45622f', path: '#ab9c6c', pathEdge: '#7d7048', trees: ['🌳', '🌿'], decor: ['🐸', '🪷', '🍄', '🌾'], sky: ['#a3b596', '#e2e9d6'], water: '#4e6e4a' },
  snow: { ground: ['#f7fbfd', '#dbe7ef'], grass: '#bccfdd', path: '#d3c7b3', pathEdge: '#a89b86', trees: ['🌲', '🌲'], decor: ['☃️', '❄️', '🪨', '🦌'], sky: ['#c3dbf0', '#f5fbff'] },
  volcano: { ground: ['#654539', '#3b2723'], grass: '#4a2f28', path: '#8e6c56', pathEdge: '#5a4236', trees: ['🌵', '🪨'], decor: ['🪨', '🔥', '🦴', '🪨'], sky: ['#6f3d33', '#d98c5f'], water: '#ff6a1f' },
  desert: { ground: ['#f0d696', '#dbb66a'], grass: '#c7a656', path: '#f6e5b6', pathEdge: '#cdac6c', trees: ['🌵', '🌴'], decor: ['🐪', '🪨', '🦂', '🌵'], sky: ['#ffd49a', '#fff4dc'] },
}
