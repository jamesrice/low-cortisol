export type LowCortisolSceneId = 'arc' | 'moss' | 'snow' | 'dog' | 'film';

export interface SceneDescriptor {
  id: LowCortisolSceneId;
  name: string;
  subtitle: string;
  liveDemoParam?: string;
}

export const LOW_CORTISOL_SCENES: ReadonlyArray<SceneDescriptor> = [
  {
    id: 'arc',
    name: 'Arc String',
    subtitle: 'Electric spring-mass plasma lines',
  },
  {
    id: 'moss',
    name: 'Moss & Pappus',
    subtitle: 'Macro mossy trunk & dandelion seeds',
    liveDemoParam: 'moss',
  },
  {
    id: 'snow',
    name: 'Snow & Light',
    subtitle: 'Frozen-glass drift & light shafts',
    liveDemoParam: 'snow',
  },
  {
    id: 'dog',
    name: 'Petting Fur',
    subtitle: 'Multi-touch tactile coat simulation',
    liveDemoParam: 'dog',
  },
  {
    id: 'film',
    name: 'Film Bloom',
    subtitle: 'Iridescent thin-film water optics',
    liveDemoParam: 'film',
  },
];

export function getSceneById(id: LowCortisolSceneId): SceneDescriptor {
  return LOW_CORTISOL_SCENES.find((s) => s.id === id) ?? LOW_CORTISOL_SCENES[0];
}

export function getNextSceneIndex(currentIndex: number, delta: 1 | -1, total = LOW_CORTISOL_SCENES.length): number {
  return (currentIndex + delta + total) % total;
}

export function resolveSceneFromQuery(param: string | null | undefined): LowCortisolSceneId {
  const normalized = (param ?? '').trim().toLowerCase();
  if (normalized === 'moss' || normalized === 'moss-tree') return 'moss';
  if (normalized === 'snow' || normalized === 'snow-and-light' || normalized === 'light') return 'snow';
  if (normalized === 'dog' || normalized === 'fur' || normalized === 'dog-fur' || normalized === 'petting') return 'dog';
  if (normalized === 'film' || normalized === 'film-bloom' || normalized === 'bloom' || normalized === 'lake') return 'film';
  return 'arc';
}

const FORWARDED_SCENE_FLAGS = new Set([
  'q',
  'dpr',
  'drs',
  'webgl',
  'debug',
  'breed',
  'surface',
  'debug-input',
]);

/** Build the self-hosted iframe URL for a WebGPU scene, forwarding supported engine runtime flags. */
export function buildEmbeddedSceneUrl(demoParam: string, currentSearch = ''): string {
  const params = new URLSearchParams();
  params.set('demo', demoParam);
  if (currentSearch) {
    const incoming = new URLSearchParams(currentSearch);
    for (const [key, value] of incoming.entries()) {
      if (FORWARDED_SCENE_FLAGS.has(key) && value.length <= 32) {
        params.set(key, value);
      }
    }
  }
  return `/scenes/index.html?${params.toString()}`;
}
