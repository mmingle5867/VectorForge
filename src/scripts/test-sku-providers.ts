import { previewSku } from '@/services/sku-generator';

async function main() {
  const current = await previewSku('Birthday Tractor', 7, {
    providerId: 'vectorforge.current-sku',
  });

  const structured = await previewSku('Birthday Tractor', 7, {
    providerId: 'vectorforge.structured-sku',
    itemType: 'ART',
    profileType: 'DIG',
  });

  console.log('Current provider:');
  console.log(current);

  console.log('\nStructured provider:');
  console.log(structured);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});