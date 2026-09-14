import assert from 'node:assert/strict';
import { getVectorForgeSemaPlatformDocumentation } from '../services/sema-platform-documentation';

const documentation = getVectorForgeSemaPlatformDocumentation();
assert.equal(documentation.core.packageName, '@selo/sema-core');
assert.equal(documentation.foundation.packageName, '@selo/sema-foundation');
assert.equal(documentation.facilities.packageName, '@selo/sema-facilities');
assert.equal(documentation.capabilities.packageName, '@selo/sema-capabilities');
console.log('Shared SEMA package adoption tests passed.');
