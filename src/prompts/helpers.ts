import * as p from "@clack/prompts"

export function isCancel(value: unknown): value is symbol {
  return p.isCancel(value)
}

export function handleCancel(): never {
  p.cancel("Operation cancelled.")
  process.exit(0)
}

export function unwrapText(value: string | symbol): string {
  if (isCancel(value)) handleCancel()
  return value
}

export function unwrapBoolean(value: boolean | symbol): boolean {
  if (isCancel(value)) handleCancel()
  return value
}

export function unwrapStringArray(value: string[] | symbol): string[] {
  if (isCancel(value)) handleCancel()
  return value
}
