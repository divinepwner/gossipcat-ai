/**
 * Assemble memory, lens, skills, and context into a single prompt string.
 * Order: MEMORY → LENS → SKILLS → context
 * Each block is only included if content is provided.
 */
export function assemblePrompt(parts: {
  memory?: string;
  lens?: string;
  skills?: string;
  context?: string;
}): string {
  const blocks: string[] = [];

  if (parts.memory) {
    blocks.push(`\n\n--- MEMORY ---\n${parts.memory}\n--- END MEMORY ---`);
  }

  if (parts.lens) {
    blocks.push(`\n\n--- LENS ---\n${parts.lens}\n--- END LENS ---`);
  }

  if (parts.skills) {
    blocks.push(`\n\n--- SKILLS ---\n${parts.skills}\n--- END SKILLS ---`);
  }

  if (parts.context) {
    blocks.push(`\n\nContext:\n${parts.context}`);
  }

  return blocks.join('');
}
