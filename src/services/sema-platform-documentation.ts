import { getCapabilitiesDocumentation } from '@selo/sema-capabilities';
import { getCoreDocumentation } from '@selo/sema-core';
import { getFacilitiesDocumentation } from '@selo/sema-facilities';
import { getFoundationDocumentation } from '@selo/sema-foundation';

/** VectorForge's registered view of the shared SEMA packages for the future System Console. */
export function getVectorForgeSemaPlatformDocumentation() {
  return {
    core: getCoreDocumentation(), foundation: getFoundationDocumentation(),
    facilities: getFacilitiesDocumentation(), capabilities: getCapabilitiesDocumentation(),
  };
}
