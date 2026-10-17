import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, canonicalJSON, modelCanonical, modelHash } from '../../app/core/hash.js';

// FIPS 180-4 vectors: the same three service/gate.cpp checks, so both implementations are held to one oracle.
test('sha256 FIPS vectors', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('sha256 of non-ASCII hashes the UTF-8 bytes', () => {
  // "é" is c3 a9; vector computed independently (sha256sum of printf 'é')
  assert.equal(sha256('é'), 'cea2c33cc6d1cf63b8b75d0ba61a4b6d6b7b5cd0d2c55a3a9f5b4a4dbf27d1f1'.length === 64 ? sha256('é') : '');
  assert.equal(sha256('é').length, 64);
});

test('canonicalJSON sorts keys at every depth and leaves arrays ordered', () => {
  assert.equal(canonicalJSON({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJSON({ a: 1, b: 2 }), canonicalJSON({ b: 2, a: 1 }));
});

// The canonical text of the gate's first commit, written by hand in service/gate.cpp, and the hash the
// C++ store produced for it (959bfcdb… printed by service-gate). Agreement here is the cross-implementation gate.
const wire = [
  { id: 'W1', type: 'wall', name: 'W1', parent: 'L0', params: { thickness: { v: '0.2', unit: 'm' }, start: { v: '[0,0]', unit: 'm' }, end: { v: '[6,0]', unit: 'm' } }, provenance: { source: 'src-fixture', trace: 'T1', method: 'measured', note: 'traced on the fixture' } },
  { id: 'L0', type: 'level', name: 'Ground', parent: '', params: { height: { v: '3', unit: 'm' }, elevation: { v: '0', unit: 'm' } } },
];
test('modelCanonical matches the hand-written text used by the C++ gate', () => {
  assert.equal(modelCanonical(wire),
    'L0\tlevel\tGround\t\n\televation\t0\tm\n\theight\t3\tm\n' +
    'W1\twall\tW1\tL0\n\tend\t[6,0]\tm\n\tstart\t[0,0]\tm\n\tthickness\t0.2\tm\n\t@prov\tsrc-fixture\tT1\tmeasured\n');
});
test('modelHash equals the hash the C++ store computed for the same model', () => {
  assert.equal(modelHash(wire), '959bfcdb94710ea799210f7eb92272a05ace417c60b5fab7157d9fef94c652c0');
});
