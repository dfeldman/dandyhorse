/** Colour themes: each race's city gets one, so every track looks like somewhere new. */
import { Color3 } from '@babylonjs/core'

export interface Theme {
  id: string
  skyTop: string
  skyHorizon: string
  skyGlow: string
  fog: string
  fogDensity: number
  /** Barrier neon, left and right. */
  neon: [string, string]
  signColors: string[]
  winWarm: string
  winCool: string
  winAccent: string
  lamp: string
  ground: string
  streetGlow: string
  buildings: string[]
  asphalt: string
  wallA: string
  wallB: string
  silhouette: string
}

export const THEMES: Theme[] = [
  {
    id: 'synthwave',
    skyTop: '#07041a', skyHorizon: '#35124d', skyGlow: '#ff3d9a', fog: '#1d1033', fogDensity: 0.00125,
    neon: ['#ff3df0', '#34e7ff'], signColors: ['#ff3df0', '#34e7ff', '#ffe14d', '#ff6b3d'],
    winWarm: '#ffcf7a', winCool: '#9fd8ff', winAccent: '#ff5ce1', lamp: '#ffb35c',
    ground: '#171126', streetGlow: '#ff8a3d',
    buildings: ['#221a3d', '#2a2046', '#1b2140', '#33223f', '#182036', '#2c2a4a'],
    asphalt: '#3a3847', wallA: '#2b2540', wallB: '#4a3f6b', silhouette: '#140a24',
  },
  {
    id: 'midnight',
    skyTop: '#01060f', skyHorizon: '#0f2d52', skyGlow: '#3d9bff', fog: '#0b1c33', fogDensity: 0.00118,
    neon: ['#3dfcff', '#ffd23d'], signColors: ['#3dfcff', '#ffd23d', '#7dff9a', '#ff4d6d'],
    winWarm: '#ffd98a', winCool: '#bfe3ff', winAccent: '#7dff9a', lamp: '#ffd9a0',
    ground: '#0f1a28', streetGlow: '#ffb46b',
    buildings: ['#15233a', '#1b2b47', '#212838', '#12203a', '#1f2e48', '#262f45'],
    asphalt: '#343b48', wallA: '#1f2a3d', wallB: '#34496b', silhouette: '#06101f',
  },
  {
    id: 'amber',
    skyTop: '#0b0510', skyHorizon: '#3f1c16', skyGlow: '#ff8c2a', fog: '#24130f', fogDensity: 0.0013,
    neon: ['#ff9d2a', '#ff3d6a'], signColors: ['#ff9d2a', '#ff3d6a', '#ffe14d', '#3dfcff'],
    winWarm: '#ffc56b', winCool: '#ffe8b0', winAccent: '#ff6b6b', lamp: '#ffa347',
    ground: '#1c1210', streetGlow: '#ff9b40',
    buildings: ['#2a1c1b', '#332224', '#241e20', '#3a261f', '#1f1a1c', '#302a2e'],
    asphalt: '#403a3a', wallA: '#302222', wallB: '#5a3a30', silhouette: '#170a0a',
  },
  {
    id: 'emerald',
    skyTop: '#010a0b', skyHorizon: '#0d3a37', skyGlow: '#33ffc0', fog: '#0a2220', fogDensity: 0.00122,
    neon: ['#3dff9a', '#b56bff'], signColors: ['#3dff9a', '#b56bff', '#fff06b', '#ff6bd8'],
    winWarm: '#fff0b0', winCool: '#b0fff0', winAccent: '#ff8ad8', lamp: '#d0ffe8',
    ground: '#0f1a1a', streetGlow: '#7dffcf',
    buildings: ['#132826', '#182b2a', '#1d2a33', '#10211f', '#243032', '#1a2a30'],
    asphalt: '#343f40', wallA: '#1c2a2a', wallB: '#2f4a48', silhouette: '#041413',
  },
]

export const themeFor = (raceNumber: number): Theme => THEMES[(raceNumber - 1) % THEMES.length]!

export const hex = (h: string): Color3 => Color3.FromHexString(h)
