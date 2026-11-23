import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAIN_SCRIPT_RE = /<script\s+type="module"\s+src="\.\/src\/main\.js(?:\?[^"]*)?"\s*><\/script>/i;

/**
 * Rewrite the local WebGPU scenes entry script from `./src/main.js` to `./bundle.js`
 * so production deployments load all WebGPU engine + scene modules in a single request.
 */
export function rewriteScenesHtmlToBundle(html) {
  if (html.includes('<script type="module" src="./bundle.js"></script>')) {
    return html;
  }
  return html.replace(MAIN_SCRIPT_RE, '<script type="module" src="./bundle.js"></script>');
}

const RUNTIME_WORKLET_FILES = new Set([
  path.join('engine', 'audio-worklet.js'),
  path.join('engine', 'breath-worklet.js'),
]);

function pruneBundledSources(distScenesSrcDir) {
  if (!fs.existsSync(distScenesSrcDir)) return;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else {
        const rel = path.relative(distScenesSrcDir, fullPath);
        if (!RUNTIME_WORKLET_FILES.has(rel)) {
          fs.rmSync(fullPath);
        }
      }
    }
  };

  walk(distScenesSrcDir);
}

export async function buildScenesBundle(rootDir = process.cwd()) {
  const entryFile = path.resolve(rootDir, 'public', 'scenes', 'src', 'main.js');
  const distScenesDir = path.resolve(rootDir, 'dist', 'scenes');
  const distHtmlFile = path.join(distScenesDir, 'index.html');
  const outBundleFile = path.join(distScenesDir, 'bundle.js');

  if (!fs.existsSync(entryFile)) {
    throw new Error(`Missing scenes entry point: ${entryFile}`);
  }
  if (!fs.existsSync(distHtmlFile)) {
    throw new Error(`dist/scenes/index.html does not exist — run \`vite build\` first.`);
  }

  const result = await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'esm',
    minify: true,
    write: false,
    external: ['three', 'three/*', 'https://cdn.jsdelivr.net/*'],
  });

  const code = result.outputFiles[0]?.text ?? '';
  if (!code) {
    throw new Error('esbuild produced an empty scenes bundle.');
  }

  fs.writeFileSync(outBundleFile, code, 'utf8');

  const rawHtml = fs.readFileSync(distHtmlFile, 'utf8');
  const updatedHtml = rewriteScenesHtmlToBundle(rawHtml);
  if (updatedHtml === rawHtml && !rawHtml.includes('src="./bundle.js"')) {
    throw new Error('Could not find ./src/main.js module script tag in dist/scenes/index.html.');
  }
  fs.writeFileSync(distHtmlFile, updatedHtml, 'utf8');

  pruneBundledSources(path.join(distScenesDir, 'src'));

  console.log(
    `[scenes-bundle] Bundled local WebGPU scenes into ${path.relative(rootDir, outBundleFile)} (${code.length} bytes)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildScenesBundle().catch((err) => {
    console.error('[scenes-bundle] Failed:', err);
    process.exit(1);
  });
}
