# Local Startup

VectorForge includes a simple Windows launcher for local development:

```text
Start VectorForge.bat
Stop VectorForge.bat
```

What it does:

- Sets the working directory to the project root.
- Checks that Node.js and npm are installed.
- Checks for a Memurai/Redis service and starts it if possible.
- Runs `npm install` only when `node_modules` is missing.
- Starts the VectorForge dev server.
- Starts the background worker in a separate PowerShell window when Redis is available.
- Opens the browser to the running VectorForge URL.

What the stop launcher does:

- Stops the VectorForge dev server process tree started by the launcher.
- Stops the VectorForge worker process tree started by the launcher.
- Uses the project path and launch-state file to avoid stopping unrelated Node processes.
- Leaves Memurai/Redis running.

Redis notes:

- Queue and worker features require Redis.
- If Memurai/Redis is installed but stopped, the launcher tries to start it.
- If service startup fails due to permissions, run as Administrator or start Memurai from Services.
- If Redis is unavailable, VectorForge still starts, but queue-backed features stay disabled.
- `Stop VectorForge.bat` does not stop Memurai/Redis.

Port notes:

- VectorForge uses port `3000` by default.
- If port `3000` is busy, the launcher picks the next free port in the `3000-3010` range and prints the actual URL.
- Future Listing Software can use port `3010` alongside VectorForge when needed.

Worker notes:

- `npm run worker:dev` is started in a separate PowerShell window when Redis is available.
- You can still start the worker manually from another terminal if needed.
- `Stop VectorForge.bat` stops the worker when it was started by `Start VectorForge.bat`.
