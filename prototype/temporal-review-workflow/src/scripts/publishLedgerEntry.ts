import path from 'path';
import { readFileSync } from 'fs';
import { publishToLedger, AuditLedgerEntry } from '../lib/auditLedger';

function usage(): never {
  console.error('Usage: pnpm ts-node src/scripts/publishLedgerEntry.ts --ledger-entry <file> [--endpoint <url>] [--token <token>]');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let ledgerEntryPath = '';
  let endpoint: string | undefined;
  let token: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ledger-entry') {
      ledgerEntryPath = args[++i];
    } else if (args[i] === '--endpoint') {
      endpoint = args[++i];
    } else if (args[i] === '--token') {
      token = args[++i];
    }
  }
  if (!ledgerEntryPath) {
    usage();
  }

  const resolved = path.resolve(ledgerEntryPath);
  const json = JSON.parse(readFileSync(resolved, 'utf8')) as AuditLedgerEntry;
  const output = await publishToLedger(json, {
    httpEndpoint: endpoint,
    httpToken: token
  });
  console.log(`Ledger entry stored at ${output.entryPath}`);
  if (output.httpPosted === true) {
    console.log(`HTTP upload succeeded${output.httpAttempts ? ` in ${output.httpAttempts} attempt(s)` : ''}`);
  } else if (output.httpPosted === false) {
    console.warn(`HTTP upload failed after ${output.httpAttempts ?? 0} attempt(s): ${output.httpError ?? 'unknown error'}`);
  } else if (endpoint) {
    console.log('HTTP upload skipped (endpoint configured but result unknown)');
  }
}

main().catch((err) => {
  console.error('Failed to publish ledger entry', err);
  process.exit(1);
});
