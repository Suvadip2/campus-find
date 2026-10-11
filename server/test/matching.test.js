import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluatePossibleMatch } from '../src/matching.js';

const lost = {
  title: 'Blue Hydro Flask',
  description: 'Blue steel bottle with sticker on the side',
  category: 'Other',
  type: 'lost',
  location: 'Science Library',
  brand: 'Hydro Flask',
  color: 'blue',
  ownerId: 'owner-a',
  status: 'open'
};

test('suggests an opposite-type match with corroborating details without resolving either item', () => {
  const found = {
    ...lost,
    type: 'found',
    ownerId: 'owner-b',
    description: 'Blue steel bottle with a sticker, turned in at the desk'
  };

  const result = evaluatePossibleMatch(lost, found);

  assert.ok(result);
  assert.ok(result.score >= 58);
  assert.ok(result.details.includes('brand'));
  assert.ok(result.details.includes('color'));
  assert.equal(lost.status, 'open');
  assert.equal(found.status, 'open');
});

test('does not suggest a match based on a similar name alone', () => {
  const found = {
    ...lost,
    type: 'found',
    ownerId: 'owner-b',
    description: '',
    location: '',
    brand: '',
    color: ''
  };

  assert.equal(evaluatePossibleMatch(lost, found), null);
});

test('rejects same-owner, same-type, different-category, and resolved candidates', () => {
  assert.equal(evaluatePossibleMatch(lost, { ...lost, ownerId: 'owner-a', type: 'found' }), null);
  assert.equal(evaluatePossibleMatch(lost, { ...lost, type: 'lost', ownerId: 'owner-b' }), null);
  assert.equal(evaluatePossibleMatch(lost, { ...lost, type: 'found', ownerId: 'owner-b', category: 'Keys' }), null);
  assert.equal(evaluatePossibleMatch(lost, { ...lost, type: 'found', ownerId: 'owner-b', status: 'resolved' }), null);
});
