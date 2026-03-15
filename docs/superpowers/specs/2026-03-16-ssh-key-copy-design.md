# SSH Key Copy Feature — Design Spec

## Problem

When a user's SSH public key is not on the server, key-based authentication fails with "Permission denied (publickey)". The user must manually run `ssh-copy-id` outside SecurBuntu before retrying. This breaks the onboarding flow and is confusing for less experienced users.

## Solution

SecurBuntu copies the user's SSH public key to the server via `ssh-copy-id` (interactive password prompt), then reconnects automatically with key auth.

## Two Entry Points

### 1. Third auth option in the menu

```
◇  How do you want to authenticate?
│  SSH Key (recommended)
│  Password
│  Copy my SSH key to server (needs password)
```

When selected:
- Prompt for private key path (auto-detection: `~/.ssh/id_ed25519`, `~/.ssh/id_ecdsa`, `~/.ssh/id_rsa`)
- Derive the `.pub` path and verify it exists
- Execute `ssh-copy-id -i <pub_key> user@host` with `stdio: "inherit"` (user types password in terminal)
- On success: reconnect with key auth, continue normal flow
- On failure: error message, loop back to connection prompt

### 2. Auto-proposal on key auth failure

When SSH key authentication fails with "Permission denied (publickey)":

```
◇  Connection failed: Permission denied (publickey).
│
◆  Would you like to copy your SSH key to the server? (password required)
│  Yes
│  No, let me try different credentials
```

If "Yes":
- Use the private key path already provided, derive `.pub`
- Same `ssh-copy-id` flow as above
- Reconnect with key auth on success

## Implementation

### Files changed

| File | Change |
|------|--------|
| `src/ssh.ts` | Add `copyKeyToServer()` function |
| `src/prompts.ts` | Add 3rd auth option + "copy key?" prompt on failure |
| `src/index.ts` | Wire detection of key auth failure + reconnection flow |

### New function: `copyKeyToServer`

Location: `src/ssh.ts`

```typescript
async function copyKeyToServer(
  host: string,
  user: string,
  pubKeyPath: string,
): Promise<boolean>
```

- Verify `ssh-copy-id` is available via `which ssh-copy-id`
- Execute: `ssh-copy-id -i <pubKeyPath> -o StrictHostKeyChecking=yes <user>@<host>`
- Use `stdio: "inherit"` so the user types their password directly in the terminal
- Return `true` if exit code is 0, `false` otherwise
- No `sshpass` dependency — `ssh-copy-id` handles the password prompt natively

### Prompts changes

In `src/prompts.ts`:

1. Add `"copy"` as third value in auth method select:
   ```
   { value: "key", label: "SSH Key", hint: "recommended" }
   { value: "password", label: "Password" }
   { value: "copy", label: "Copy my SSH key to server", hint: "needs password" }
   ```

2. When `"copy"` selected: prompt for private key path (reuse existing logic), then derive `.pub` path

3. New function `promptCopyKeyOnFailure()`: asks if user wants to copy their key after a "Permission denied" error. Returns `boolean`.

### Index flow changes

In `src/index.ts` connection loop:

1. When auth method is `"copy"`:
   - Derive public key path from private key path (append `.pub`)
   - Verify `.pub` file exists
   - Run `copyKeyToServer(host, user, pubKeyPath)`
   - If success: switch auth method to `"key"`, loop back to connection (reconnects with key auth)
   - If failure: show error, loop back to credential prompt

2. When connection fails with "Permission denied (publickey)" AND auth method was `"key"`:
   - Call `promptCopyKeyOnFailure()`
   - If yes: derive `.pub` from private key path, run `copyKeyToServer()`, reconnect
   - If no: loop back to credential prompt as today

### After key copy success

The connection loop naturally restarts with the same credentials but now key auth succeeds. No special reconnection logic needed — the existing retry loop handles it. The auth method is set back to `"key"` so `connect()` uses key-based auth.

## Edge Cases

- **`.pub` file not found**: Show error "Public key not found at {path}. Make sure the .pub file exists alongside your private key."
- **`ssh-copy-id` not installed**: Check with `which ssh-copy-id`. If absent, show install instructions (same pattern as sshpass check). Very unlikely since it ships with openssh-client.
- **Non-standard SSH port**: Not relevant at this point — the user is connecting for the first time, so the server is on its default port. If we later support specifying a port before connection, we can pass `-p <port>` to ssh-copy-id.
- **User cancels password prompt**: `ssh-copy-id` returns non-zero exit code, handled as failure.
- **Key already on server**: `ssh-copy-id` is idempotent — it skips keys already present. No harm done.

## Not Changed

- Password auth flow (sshpass remains for full password sessions)
- SSH key injection task (`src/tasks/ssh-keys.ts`) — this injects keys AFTER connection for additional users (e.g., sudo user, Coolify root)
- Types — no new interfaces needed, auth method already uses string values
- DryRunSshClient / LoggingSshClient — unaffected (connection happens before these wrappers)
