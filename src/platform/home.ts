import { homedir } from "os"

export function resolveHome(): string {
  return homedir()
}
