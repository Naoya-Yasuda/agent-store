import path from 'path';
import { readFileSync } from 'fs';
import { publishToLedger, AuditLedgerEntry } from '../lib/auditLedger';

function usage(): never {
  console.error('Usage: pnpm ts-node src/scripts/publishLedgerEntry.ts --ledger-entry <file>');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let ledgerEntryPath = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ledger-entry') {
      ledgerEntryPath = args[++i];
    }
  }
  if (!ledgerEntryPath) {
    usage();
  }

  const resolved = path.resolve(ledgerEntryPath);
  const json = JSON.parse(readFileSync(resolved, 'utf8')) as AuditLedgerEntry;
  const output = await publishToLedger(json);
  console.log(`Ledger entry stored at ${output}`);
}

main().catch((err) => {
  console.error('Failed to publish ledger entry', err);
  process.exit(1);
});
