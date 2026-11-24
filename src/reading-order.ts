/**
 * The fields of a PDF.js `TextItem` that ordering needs. `transform` is the
 * run's text matrix in PDF user space: `[4]` and `[5]` are its origin, and
 * `[0]`–`[3]` its scale and rotation.
 */
interface TextRun {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  hasEOL: boolean;
}

/** Baselines closer than this many font sizes belong to the same line. */
const BASELINE_TOLERANCE = 0.3;

/**
 * Runs whose horizontal extents come within this many font sizes of each
 * other belong to the same line. It must stay below the narrowest gutter that
 * separates columns, or columns sharing baselines would be merged.
 */
const ADJACENCY_TOLERANCE = 0.5;

/**
 * How many of the most recently started lines a run may join. A run drawn out
 * of order lands right after the line it belongs to, so a short look-back
 * finds it while keeping pages made of thousands of scattered runs linear.
 */
const LOOK_BACK_LINES = 16;

/**
 * A run moves ahead of an earlier one only if it ends left of where that one
 * starts, give or take this many font sizes. Runs that overlap, such as a
 * space kerned under the letter after it, keep the order they were drawn in.
 */
const CLEARANCE = 0.1;

/**
 * A gap wider than this many font sizes reads as a space. Word spaces run
 * about a quarter to a third; glyphs set solid, as in Japanese, leave none.
 */
const SPACE_GAP = 0.1;

interface Run {
  x: number;
  width: number;
  str: string;
}

interface Line {
  baseline: number;
  size: number;
  left: number;
  right: number;
  /** In reading order. */
  runs: Run[];
  /** False once a right-to-left run joins: moving runs by x would reverse it. */
  movable: boolean;
  /** True once a run was placed ahead of one drawn before it. */
  reordered: boolean;
  /** Joins no other run: rotated or vertical text keeps its stream order. */
  closed: boolean;
  eol: boolean;
}

function fontSize(run: TextRun): number {
  return Math.hypot(run.transform[2], run.transform[3]);
}

function onSameBaseline(p: TextRun, q: TextRun): boolean {
  const scale = Math.max(fontSize(p), fontSize(q));
  return (
    Math.abs(p.transform[5] - q.transform[5]) <= BASELINE_TOLERANCE * scale
  );
}

/**
 * PDF.js fills the gap between two runs with a space run, but the width it
 * reports can overshoot the gap several times over (Chrome's Type 3 fonts do
 * this), stretching the line across text in the next column. Measure each
 * space run as the gap it fills instead: up to where the next run starts if
 * that run continues the same baseline, and nothing otherwise.
 */
function measureSpaces(runs: readonly TextRun[]): TextRun[] {
  const measured = [...runs];
  let next: TextRun | undefined;
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    if (run.str === "") continue;
    if (run.str.trim() !== "") {
      next = run;
      continue;
    }
    const gap =
      next && onSameBaseline(run, next)
        ? next.transform[4] - run.transform[4]
        : 0;
    measured[i] = { ...run, width: Math.max(0, gap) };
  }
  return measured;
}

function startLine(lines: Line[], run: TextRun, closed: boolean): Line {
  const x = run.transform[4];
  const line: Line = {
    baseline: run.transform[5],
    size: fontSize(run),
    left: x,
    right: x + run.width,
    runs: [{ x, width: run.width, str: run.str }],
    movable: run.dir === "ltr",
    reordered: false,
    closed,
    eol: false,
  };
  lines.push(line);
  return line;
}

function findLine(lines: Line[], run: TextRun): Line | undefined {
  const [, , , , x, y] = run.transform;
  const size = fontSize(run);
  const oldest = Math.max(0, lines.length - LOOK_BACK_LINES);

  for (let i = lines.length - 1; i >= oldest; i--) {
    const line = lines[i];
    if (line.closed) continue;
    const scale = Math.max(size, line.size);
    if (Math.abs(y - line.baseline) > BASELINE_TOLERANCE * scale) continue;
    const reach = ADJACENCY_TOLERANCE * scale;
    if (x > line.right + reach || x + run.width < line.left - reach) continue;
    return line;
  }
  return undefined;
}

/** Put a run after every run it does not sit wholly to the left of. */
function insertRun(line: Line, run: Run): void {
  let at = line.runs.length;
  if (line.movable) {
    const clearance = CLEARANCE * line.size;
    while (at > 0 && run.x + run.width <= line.runs[at - 1].x + clearance) {
      at--;
    }
  }
  if (at < line.runs.length) line.reordered = true;
  line.runs.splice(at, 0, run);
}

function placeRun(lines: Line[], run: TextRun): Line {
  const [a, b, , , x] = run.transform;
  // Only runs advancing rightward along a horizontal baseline share lines.
  const horizontal = a > 0 && Math.abs(b) <= Math.abs(a) * 1e-3;
  if (!horizontal || run.dir === "ttb") return startLine(lines, run, true);

  const line = findLine(lines, run);
  if (!line) return startLine(lines, run, false);

  if (run.dir !== "ltr") line.movable = false;
  line.size = Math.max(line.size, fontSize(run));
  line.left = Math.min(line.left, x);
  line.right = Math.max(line.right, x + run.width);
  insertRun(line, { x, width: run.width, str: run.str });
  return line;
}

function lineText(line: Line): string {
  if (!line.reordered) return line.runs.map((run) => run.str).join("");

  // PDF.js fills a gap with one space run spanning all of it, so a run drawn
  // into that gap later would get a space on one side only. Rebuild the
  // spacing of a reordered line from where its runs actually sit.
  let text = "";
  let end = Number.NEGATIVE_INFINITY;
  for (const run of line.runs) {
    if (run.str.trim() === "") continue;
    if (text !== "" && run.x - end > SPACE_GAP * line.size) text += " ";
    text += run.str;
    end = Math.max(end, run.x + run.width);
  }
  return text;
}

/**
 * Join a page's text runs in reading order.
 *
 * PDF.js reports runs in the order the content stream draws them, which is
 * not always the order they are read: Chrome draws a line's emphasized words
 * in a second pass, so "try nano now" comes out as "try now nano". Runs that
 * sit on one baseline and touch horizontally are gathered into a line, and a
 * run drawn later moves ahead of the runs it sits wholly to the left of.
 * Lines keep the order they first appear in, so columns, tables and anything
 * already in order come out as before.
 */
export function orderPageText(runs: readonly TextRun[]): string {
  const lines: Line[] = [];
  let last: Line | undefined;

  for (const run of measureSpaces(runs)) {
    if (run.str === "") {
      // An empty run only marks where PDF.js saw a line end.
      if (run.hasEOL) (last ?? startLine(lines, run, true)).eol = true;
      continue;
    }
    last = placeRun(lines, run);
    if (run.hasEOL) last.eol = true;
  }

  return lines.map((line) => lineText(line) + (line.eol ? "\n" : "")).join("");
}
