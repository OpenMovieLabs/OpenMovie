const target = process.argv[2];
if (target !== 'mac' && target !== 'win') {
  throw new Error('Usage: node scripts/verify-release-signing.mjs <mac|win>');
}

if (process.env.OPENMOVIE_REQUIRE_CODE_SIGNING !== '1') {
  process.stdout.write(`Signing gate skipped for ${target} development package.\n`);
  process.exit(0);
}

const required =
  target === 'mac'
    ? ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
    : ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Signed ${target} release is missing CI secrets: ${missing.join(', ')}`);
}
process.stdout.write(`Signing gate passed for ${target}.\n`);
