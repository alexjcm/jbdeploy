# 🚀 JBoss/Wildfly Deploy CLI

![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)

CLI tool to deploy EAR/WAR artifacts to **JBoss** or **Wildfly**.

<p align="center">
  <img src="demo.gif" alt="jbdeploy demo" width="800"/>
</p>

## Features

*   **Fast Build**: Automatic project building — supports **Gradle** and **Maven** (auto-detects and uses `gradlew`/`mvnw` wrappers).
*   **Smart Deployment**: Direct deployment to `standalone/deployments` with **real-time validation polling**.
*   **Modern UI**: Interactive TUI based on `@clack/prompts` with semantic logging.
*   **Persistent Preferences**: Remembers your last server, debug port, JVM memory profile, and startup mode between sessions.
*   **Configurable Debug**: Choose your JVM debug port dynamically.
*   **Dynamic JVM Memory**: Assign pre-configured JVM memory capacities independently for each server.
*   **Seamless Workflow**: Automatic server startup after deployment and loop-based interface to keep you in the flow.

## 📋 Requirements

- **Bun** (Recommended for development) or **Node.js v22+** (For distribution)
- **Gradle** or **Maven** (or project wrappers `gradlew` / `mvnw`)
- **JBoss/Wildfly** configured locally

## ⚙️ Installation & Development

## Installation
npm install -g jbdeploy
# or
bun add -g jbdeploy

### For Users (Node.js)
If you want to use the stable, compiled version:
```bash
npm run build
npm install -g .
```

### For Developers (Bun)
If you want to test changes in real-time:
1. Clone the repository and install:
```bash
bun install
```
2. Enable hot-linking:
```bash
bun run local:link
```
Now you can use `jbdeploy` from any terminal. It executes the source code via Bun, making your changes **immediately active**.

## 🏗️ Build Pipeline

This project leverages a **Universal JavaScript** strategy:
- **Core**: Built with TypeScript and optimized for **Bun**'s high-speed runtime during development.
- **Distribution**: Compiles with `tsup` into a single, specialized **ESM** bundle (`dist/index.js`) with a Node.js shebang, ensuring seamless usage in any Node environment.

## 🚀 Usage

Run the CLI from any project you want to deploy:

```bash
jbdeploy
```

### Workflow
1. **Server Selection**: Choose a saved server or add a new one.
2. **Action**: Choose between `build + copy + deploy`, `copy + deploy`, or `start server only`.
3. **Build (if applicable)**: Gradle or Maven is auto-detected.
4. **Server Mode**: If the server is stopped, choose **Normal** or **Debug** mode. Your last choice is remembered.
5. **Auto-Start**: After a successful deployment with the server stopped, the CLI starts it automatically.
6. **Looping**: After each action, the CLI returns to the main menu automatically.

## 📁 Configuration

All preferences, registered JBoss servers, JVM memory profiles, and debug ports are safely saved locally at:
```bash
~/.jbdeploy/config.json
```

---

## 🛠️ Flags

| Flag | Description |
|---|---|
| `--list` | List deployed artifacts and their status (`✔ deployed`, `✖ failed`, etc.) |
| `--clean` | Clean error markers (`.failed`, `.pending`) on the active server |
| `--help`, `-h` | Show help |

Example:
```bash
jbdeploy --list
```
