// StubAdapter subject: simulates provider degradation (rate-limit, etc.).
// The grader must never run for this disposition.
process.stdout.write('DISPOSITION:provider-degraded\n');
process.stdout.write('subject encountered provider degradation\n');
