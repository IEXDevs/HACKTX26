# Isolated agent commands

Agent file tools check path traversal, workspace identifiers, and real symlink targets. Symlinks that stay within the agent workspace remain usable. Root and workspace directories cannot be symlinks. File tools refuse deletion of the sandbox root.

`shell.exec` and `cli.run` require a Linux Docker runtime. The server never falls back to a host shell. Build and check the command image before dispatching commands:

```sh
pnpm sandbox:build
pnpm sandbox:verify
```

Use Node 22.13 or later. Run the server as a non-root user. On Linux, the container uses the server user's UID and GID, so generated files retain usable ownership. On Windows with Docker Desktop, it uses UID and GID 1000.

The image includes Node, Python, pnpm, npm, Git, and basic file utilities. Set `SANDBOX_IMAGE` to use another administrator-built image. Images must already exist on the daemon; agent calls cannot pull images. Add required packages when building the image. Commands cannot download dependencies at runtime.

Each call gets a new container with these boundaries:

- Only the current agent workspace is mounted, with write access.
- Networking is disabled. Use approved connector and HTTP tools for network actions.
- The container root is read-only. A temporary filesystem supplies scratch space and package caches.
- The process runs without Linux capabilities and cannot gain new privileges.
- CPU, memory, process count, runtime, and captured output are bounded. A deadline inside the container also stops work if the Docker client disconnects.
- The runner force-removes the container after success, failure, or timeout.
- Server credentials, database paths, and Docker sockets are not passed into the command container.

The application Docker image also runs as a non-root user and contains the Docker client. It needs access to a trusted Docker daemon. That daemon must see agent workspaces at the same absolute paths as the application. Configure this at deployment time. Do not pass the Docker socket into agent containers. Access to the daemon is an administrator capability; keep it confined to the server.

For a containerized application, use a dedicated worker host or rootless daemon with a shared workspace mount. The runtime must support Linux containers and the resource limits above. A platform with no Docker daemon can still run file, model, and connector tools. Command calls fail with an actionable error.

The integration check executes real containers. It checks workspace writes, blocked host-file access, a read-only root, withheld server secrets, and disabled networking. Unit tests separately check Docker arguments, timeout cleanup, and missing-runtime behavior. Passing unit tests alone does not verify a host's container setup.

Container boundaries follow the [Docker run reference](https://docs.docker.com/reference/cli/docker/container/run/). Containers share the daemon host's kernel; use a dedicated worker host for hostile workloads that need a stronger trust boundary.
