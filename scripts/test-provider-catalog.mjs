// node --experimental-strip-types --test scripts/test-provider-catalog.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogFromProviders,
  parseProbePayload,
  pickDirectProvider,
} from '../src/lib/provider-catalog.ts';

test('hosted catalog is built in the browser, not by the Worker', () => {
  const data = catalogFromProviders([
    {
      name: 'new',
      baseURL: 'https://new-api.tideflow.top/v1',
      apiKey: 'sk-test',
      models: [{ id: 'gpt-5.6-luna', vision: true }, { id: 'qwen-flash' }],
    },
  ], 'as_sk_test');
  assert.equal(data.models.length, 2);
  assert.equal(data.default, 'gpt-5.6-luna');
  assert.equal(data.models[0].name, 'gpt-5.6-luna (new)');
  assert.equal(data.models[0].vision, true);
  assert.equal(data.capabilities.webSearch, true);
  assert.equal(data.capabilities.searchEngine, 'anysearch');
  assert.equal(data.capabilities.anysearch, true);
  assert.equal(data.capabilities.scholarSearch, true);
});

test('OpenRouter lights :online search without an AnySearch key', () => {
  const data = catalogFromProviders([{
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-or',
    models: [{ id: 'openrouter/auto' }],
  }]);
  assert.equal(data.capabilities.searchEngine, 'openrouter-online');
  assert.equal(data.capabilities.webSearch, true);
});

test('probe payload strips Google models/ prefixes', () => {
  const models = parseProbePayload({
    data: [
      { id: 'models/gemini-2.5-flash', context_length: 128000 },
      {},
    ],
  });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'gemini-2.5-flash');
  assert.equal(models[0].contextLength, 128000);
});

test('hosted generation is direct for every stored provider', () => {
  const providers = [
    { name: 'new', models: [{ id: 'gpt-5.6-luna' }] },
    { name: 'or', models: [{ id: 'openrouter/auto' }] },
  ];
  assert.equal(pickDirectProvider('gpt-5.6-luna', providers, true)?.name, 'new');
  assert.equal(pickDirectProvider('openrouter/auto', providers, true)?.name, 'or');
  assert.equal(pickDirectProvider('gpt-5.6-luna', providers, false), null);
  assert.equal(pickDirectProvider('missing', providers, true), null);
});
