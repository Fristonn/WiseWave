export function feedbackText(message: string): string {
  return message.trim().toLowerCase()
    .replace(/\bcould not\b/g, "couldn't")
    .replace(/\bplease try again\b/g, "try again")
    .replace(/[.!]+$/, "");
}
