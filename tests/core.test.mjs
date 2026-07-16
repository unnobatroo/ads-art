import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadScript(path, globals = {}) {
  const source = await readFile(path, 'utf8');
  const context = vm.createContext({ console, URL, ...globals });
  vm.runInContext(source, context);
  return (expression) => vm.runInContext(expression, context);
}

function backgroundGlobals() {
  return {
    chrome: {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
      },
      runtime: {
        onMessage: { addListener() {} },
        onInstalled: { addListener() {} },
      },
    },
    fetch: async () => {
      throw new Error('Unexpected network request');
    },
  };
}

test('artwork selection prefers the closest aspect ratio', async () => {
  const evaluate = await loadScript(
    'dist/.compiled/background/service-worker.js',
    backgroundGlobals(),
  );

  assert.equal(evaluate('classifyAspect(728, 90)'), 'landscape');
  assert.equal(evaluate('classifyAspect(300, 600)'), 'portrait');
  assert.equal(evaluate('classifyAspect(300, 250)'), 'square');

  const bestId = evaluate(`
    pickBestArtwork([
      { id: 'wide', width: 1200, height: 300 },
      { id: 'square', width: 800, height: 800 },
      { id: 'portrait', width: 400, height: 900 }
    ], 1, 300, 300)?.id
  `);
  assert.equal(bestId, 'square');
});

test('large source images are not penalized for extra resolution', async () => {
  const evaluate = await loadScript(
    'dist/.compiled/background/service-worker.js',
    backgroundGlobals(),
  );

  const scores = evaluate(`[
    scoreArtwork({ width: 300, height: 250 }, 1.2, 300, 250),
    scoreArtwork({ width: 3000, height: 2500 }, 1.2, 300, 250)
  ]`);
  assert.deepEqual([...scores], [0, 0]);
});

test('ad naming avoids common false positives', async () => {
  class HTMLElement {}

  const evaluate = await loadScript('dist/.compiled/content/detector.js', {
    document: {},
    HTMLElement,
    window: {},
  });

  assert.equal(
    evaluate(`matchesAdName({ getAttribute: () => 'masthead-container', id: '' })`),
    false,
  );
  assert.equal(
    evaluate(`matchesAdName({ getAttribute: () => 'sidebar-ad-container', id: '' })`),
    true,
  );
  assert.equal(evaluate('matchesAdSize(300, 250)'), true);
  assert.equal(evaluate('matchesAdSize(500, 500)'), false);
});

test('browser manifests use supported Manifest V3', async () => {
  const chromeManifest = JSON.parse(await readFile('manifest.json', 'utf8'));
  const firefoxManifest = JSON.parse(await readFile('manifest.firefox.json', 'utf8'));
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(chromeManifest.manifest_version, 3);
  assert.equal(firefoxManifest.manifest_version, 3);
  assert.equal(chromeManifest.content_scripts.length, 1);
  assert.equal(firefoxManifest.content_scripts.length, 1);
  assert.equal(chromeManifest.version, firefoxManifest.version);
  assert.equal(normalizeVersion(packageJson.version), normalizeVersion(chromeManifest.version));
});

test('overlay CSS does not hide ads before a replacement is ready', async () => {
  const css = await readFile('styles/art-overlay.css', 'utf8');

  assert.match(css, /\[data-art-replacer="replacing"\]/);
  assert.doesNotMatch(css, /ins\.adsbygoogle|doubleclick\.net|\[data-ad-slot\]/);
});

function normalizeVersion(version) {
  return version.split('.').map(Number).concat(0, 0, 0).slice(0, 3).join('.');
}
