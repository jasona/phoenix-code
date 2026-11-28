/** Match the final runner report, never filenames, test titles or the shell command. */
export function passedTestsFromOutput(output: string): number | null {
  const tail = output.slice(-4096).replace(/\u001b\[[0-9;]*m/g, "");
  const match =
    tail.match(/^\s*Tests:?\s+(?:[\d,]+ (?:failed|skipped),?\s+)*([\d,]+) passed\b[^\n]*$/im) ??
    tail.match(/^=+\s*(?:\d+ failed,\s*)?(\d+) passed\b[^\n]*=+\s*$/im) ??
    tail.match(/^# pass (\d+)\s*$/m);
  return match ? Number(match[1]!.replaceAll(",", "")) : null;
}
