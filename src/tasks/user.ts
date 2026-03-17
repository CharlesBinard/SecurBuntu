import type { HardeningTask } from "../types.ts"

export const runCreateUser: HardeningTask = async (client, options) => {
  if (!(options.createSudoUser && options.sudoUsername && options.sudoPassword)) {
    return {
      name: "Create Sudo User",
      success: true,
      message: "Skipped (not requested)",
    }
  }

  const username = options.sudoUsername

  const checkResult = await client.exec(`id ${username} 2>/dev/null && echo exists || echo missing`)
  const userExists = checkResult.stdout === "exists"

  if (!userExists) {
    const addResult = await client.exec(`adduser --disabled-password --gecos "" ${username}`)
    if (addResult.exitCode !== 0) {
      return {
        name: "Create Sudo User",
        success: false,
        message: `Failed to create user ${username}`,
        details: addResult.stderr,
      }
    }
  }

  const pwResult = await client.execWithStdin("chpasswd", `${username}:${options.sudoPassword}\n`)
  if (pwResult.exitCode !== 0) {
    return {
      name: "Create Sudo User",
      success: false,
      message: `Failed to set password for ${username}`,
      details: pwResult.stderr,
    }
  }

  const sudoResult = await client.exec(`usermod -aG sudo ${username}`)
  if (sudoResult.exitCode !== 0) {
    return {
      name: "Create Sudo User",
      success: false,
      message: `Failed to add ${username} to sudo group`,
      details: sudoResult.stderr,
    }
  }

  const setupResult = await client.exec(
    `mkdir -p /home/${username}/.ssh && ` +
      `chmod 700 /home/${username}/.ssh && ` +
      `touch /home/${username}/.ssh/authorized_keys && ` +
      `chmod 600 /home/${username}/.ssh/authorized_keys && ` +
      `chown -R ${username}:${username} /home/${username}/.ssh`,
  )
  if (setupResult.exitCode !== 0) {
    return {
      name: "Create Sudo User",
      success: false,
      message: `Failed to setup SSH directory for ${username}`,
      details: setupResult.stderr,
    }
  }

  return {
    name: "Create Sudo User",
    success: true,
    message: userExists
      ? `User ${username} already existed, password and sudo updated`
      : `User ${username} created with sudo privileges`,
  }
}
