// StubAdapter subject: simulates a crash (nonzero exit).
// The grader must never run for this disposition.
process.stdout.write('DISPOSITION:crashed\n');
process.stdout.write('subject crashed\n');
process.exit(1);
