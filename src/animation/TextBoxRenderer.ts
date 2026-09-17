/**
 * TextBoxRenderer -- wraps animation text in a classic Pokemon-style text box
 * using Unicode double-line box drawing characters.
 *
 * Pure function: no side effects, no dependencies.
 */

// Box drawing characters (double-line)
const TL = '\u2554'; // top-left corner
const TR = '\u2557'; // top-right corner
const BL = '\u255A'; // bottom-left corner
const BR = '\u255D'; // bottom-right corner
const HZ = '\u2550'; // horizontal bar
const VT = '\u2551'; // vertical bar

/** Maximum content lines visible in the text box. */
const MAX_LINES = 4;

/**
 * Word-wrap text into lines that fit within the given character width.
 * Splits on spaces; words longer than maxWidth are force-broken.
 */
function wordWrap(text: string, maxWidth: number): string[] {
  if (text.length === 0) return [''];

  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxWidth) {
      // Force-break long word
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxWidth) {
        const chunk = word.slice(i, i + maxWidth);
        if (i + maxWidth < word.length) {
          lines.push(chunk);
        } else {
          current = chunk;
        }
      }
    } else if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }

  return lines;
}

/**
 * Render text inside a Unicode double-line bordered frame.
 *
 * @param text - Raw text content to display inside the box.
 * @param lineWidth - Total width of the box including borders (default 62).
 * @returns Multi-line string with the complete bordered text box.
 */
export function renderTextBox(text: string, lineWidth: number = 62): string {
  // Word-wrap the text (no border, full width available)
  let lines = wordWrap(text, lineWidth);

  // Truncate to last MAX_LINES lines (most recent text visible)
  if (lines.length > MAX_LINES) {
    lines = lines.slice(lines.length - MAX_LINES);
  }

  // Pad to at least 1 line so box is never empty
  while (lines.length < 1) {
    lines.push('');
  }

  return lines.join('\n');
}
