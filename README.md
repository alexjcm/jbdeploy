# 🚀 JBoss/Wildfly Deploy CLI

![NPM Version](https://img.shields.io/npm/v/jbdeploy?style=for-the-badge&logo=npm)
![NPM Downloads](https://img.shields.io/npm/dm/jbdeploy?style=for-the-badge&logo=npm)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

![JBoss](https://img.shields.io/badge/JBoss-E2231A?style=for-the-badge&logo=jboss&logoColor=white)
![WildFly](https://img.shields.io/badge/WildFly-FFD400?style=for-the-badge&logo=wildfly&logoColor=white)
![Gradle](https://img.shields.io/badge/Gradle-02303A?style=for-the-badge&logo=gradle&logoColor=white)
![Maven](https://img.shields.io/badge/Maven-C71A36?style=for-the-badge&logo=apachemaven&logoColor=white)

A **lightweight and fast** CLI tool to deploy EAR/WAR artifacts to **JBoss** or **Wildfly**.

## Features

*   **Fast Build**: Automatic project building — supports **Gradle** and **Maven** (auto-detects and uses `gradlew`/`mvnw` wrappers).
*   **Smart Deployment**: Direct deployment to `standalone/deployments` with **real-time validation polling**.
*   **Modern UI**: Interactive TUI with semantic logging.
*   **Persistent Preferences**: Remembers your last server, debug port, JVM memory profile, startup mode, and last deployment flow between sessions.
*   **Smarter Defaults**: Recommends the most relevant artifact using your last deployment and recent build output.
*   **Configurable Debug**: Choose your JVM debug port dynamically.
*   **Dynamic JVM Memory**: Assign pre-configured JVM memory capacities independently for each server.
*   **Seamless Workflow**: Repeat the last project flow with one explicit action, edit saved servers quickly, and stay in a persistent loop-based interface.

## 📋 Requirements

- **Node.js v20+**
- **Gradle** or **Maven** (or project wrappers `gradlew` / `mvnw`)
- **JBoss/Wildfly** configured locally

## ⚙️ Installation

### Quick Start (No installation)
```bash
npx jbdeploy
```

### Global Installation
```bash
npm install -g jbdeploy
```

## 🛠️ Development

### Local Setup

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Build and enable global linking:
```bash
npm run build
npm link
```
Now you can use `jbdeploy` from any terminal.

3. Run in watch mode during development:
```bash
npm run dev
```

4. Return to the published global package when you finish local testing:
```bash
npm unlink -g jbdeploy
npm install -g jbdeploy
```

## 🏗️ Build Pipeline

- **Core**: Built with TypeScript for Node.js 20+.
- **Distribution**: Compiles with `tsup` into a single, specialized **ESM** bundle (`dist/index.js`) with a Node.js shebang, ensuring seamless usage in any Node environment.

## 🚀 Usage

Run the CLI from any project you want to deploy:

```bash
jbdeploy
```

### Workflow
1. **Project Entry**: When available, choose between `Repeat last flow` or continuing manually.
2. **Server Selection**: Choose a saved server, add a new one, or edit an existing server quickly.
3. **Action**: Choose between `Build, copy & start`, `Copy & start`, or `Start server` (when the server is already running, deploy variants are shown).
4. **Artifact Selection**: If multiple artifacts are found, the CLI preselects the most relevant candidate and explains the recommendation.
5. **Server Mode**: If the server is stopped, choose **Normal** or **Debug** mode. Your last choice is remembered.
6. **Auto-Start**: After a successful deployment with the server stopped, the CLI starts it automatically.

## 📁 Configuration

All preferences, registered JBoss servers, JVM memory profiles, debug ports, and last project deployment flow are saved locally at:
```bash
~/.jbdeploy/config.json
```

---

## Help

```bash
jbdeploy --help
```

## 📄 License

MIT
