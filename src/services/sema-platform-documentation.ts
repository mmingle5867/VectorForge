import { getCapabilitiesDocumentation } from '@selo/sema-capabilities';
import { getCoreDocumentation } from '@selo/sema-core';
import { getFoundationDocumentation } from '@selo/sema-foundation';
import { getObjectsDocumentation } from '@selo/sema-objects';

/** VectorForge's registered view of the shared SEMA packages for the future System Console. */
export function getVectorForgeSemaPlatformDocumentation() {
  return {
    core: getCoreDocumentation(), foundation: getFoundationDocumentation(),
    objects: getObjectsDocumentation(), capabilities: getCapabilitiesDocumentation(),
  };
}
