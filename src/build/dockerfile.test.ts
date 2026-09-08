import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The web builder stage must see the whole of src.
 *
 * It used to copy a list of subdirectories, which meant every newly shared
 * module needed a matching Dockerfile edit. Forgetting cost a silent 49-minute
 * deploy failure, and the restriction bought nothing: the stage builds with all
 * of src present, because nothing is type-checked or bundled unless the web app
 * imports it. This locks that in - a build that succeeds locally and fails on
 * deploy is the most expensive kind of failure this repo produces.
 */
test('the web builder stage copies all of src', () => {
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const webStage = dockerfile.split(/^FROM /m).find(s => s.includes('AS web-builder'));
  assert.ok(webStage, 'no web-builder stage in the Dockerfile');
  assert.match(
    webStage,
    /^COPY src\/ \/app\/src\/$/m,
    'the web-builder stage must COPY all of src, not a list of subdirectories',
  );
});

test('every @shared import resolves under src', async () => {
  // @shared maps to ../src from web/. If that ever stops being true the alias
  // and the COPY have to move together.
  const config = readFileSync(new URL('../../web/next.config.ts', import.meta.url), 'utf8');
  assert.match(config, /"@shared":\s*path\.join\(__dirname,\s*"\.\.",\s*"src"\)/);
});
