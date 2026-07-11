// Stands in for a CLI call whose `result` text never became the required
// files-in-JSON shape at all (the model apologized instead of drafting) —
// exercises the 502 AuthorFailed path.
process.stdout.write(
  JSON.stringify({ result: "Sorry, I couldn't draft a scenario for that description." }),
);
