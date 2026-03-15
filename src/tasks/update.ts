import type { HardeningTask } from "../types.js"

export const runUpdate: HardeningTask = async (ssh) => {
  const result = await ssh.exec("DEBIAN_FRONTEND=noninteractive apt update && DEBIAN_FRONTEND=noninteractive apt upgrade -y")

  if (result.exitCode !== 0) {
    return {
      name: "System Update",
      success: false,
      message: "Failed to update system packages",
      details: result.stderr,
    }
  }

  return {
    name: "System Update",
    success: true,
    message: "System packages updated successfully",
  }
}
