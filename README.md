# Think AI CLI

[![Think AI CLI CI](https://github.com/champi-dev/gemini_cli_thinkai/actions/workflows/ci.yml/badge.svg)](https://github.com/champi-dev/gemini_cli_thinkai/actions/workflows/ci.yml)

![Think AI CLI Screenshot](./docs/assets/gemini-screenshot.png)

This repository contains the Think AI CLI, a command-line AI workflow tool that connects to your
tools, understands your code and accelerates your workflows using the Think AI API.

With the Think AI CLI you can:

- Query and edit large codebases using Think AI's powerful language understanding.
- Generate new apps from PDFs or sketches, using Think AI's multimodal capabilities.
- Automate operational tasks, like querying pull requests or handling complex rebases.
- Use tools and MCP servers to connect new capabilities.
- Leverage Think AI's advanced reasoning for code analysis and generation.

## Quickstart

1. **Prerequisites:** Ensure you have [Node.js version 18](https://nodejs.org/en/download) or higher installed.
2. **Run the CLI:** Execute the following command in your terminal:

   ```bash
   npx https://github.com/champi-dev/gemini_cli_thinkai
   ```

   Or install it with:

   ```bash
   npm install -g @champi-dev/thinkai-cli
   thinkai
   ```

3. **Pick a color theme**
4. **Configure Think AI:** Set up your Think AI base URL (default: https://thinkai.lat/api):

   ```bash
   export THINKAI_BASE_URL="https://thinkai.lat/api"
   ```

You are now ready to use the Think AI CLI!

### For custom configurations:

The CLI automatically uses Think AI exclusively. You can customize the Think AI API endpoint:

1. Set the base URL as an environment variable:

   ```bash
   export THINKAI_BASE_URL="your-custom-thinkai-endpoint"
   ```

2. The CLI will automatically detect and use Think AI for all operations.

## Examples

Once the CLI is running, you can start interacting with Think AI from your shell.

You can start a project from a new directory:

```sh
cd new-project/
thinkai
> Write me a Discord bot that answers questions using a FAQ.md file I will provide
```

Or work with an existing project:

```sh
git clone https://github.com/champi-dev/gemini_cli_thinkai
cd gemini_cli_thinkai
thinkai
> Give me a summary of all of the changes that went in yesterday
```

### Next steps

- Learn how to [contribute to or build from the source](./CONTRIBUTING.md).
- Explore the available **[CLI Commands](./docs/cli/commands.md)**.
- If you encounter any issues, review the **[Troubleshooting guide](./docs/troubleshooting.md)**.
- For more comprehensive documentation, see the [full documentation](./docs/index.md).
- Take a look at some [popular tasks](#popular-tasks) for more inspiration.

## Popular tasks

### Explore a new codebase

Start by `cd`ing into an existing or newly-cloned repository and running `thinkai`.

```text
> Describe the main pieces of this system's architecture.
```

```text
> What security mechanisms are in place?
```

### Work with your existing code

```text
> Implement a first draft for GitHub issue #123.
```

```text
> Help me migrate this codebase to the latest version of Java. Start with a plan.
```

### Automate your workflows

Use MCP servers to integrate your local system tools with your enterprise collaboration suite.

```text
> Make me a slide deck showing the git history from the last 7 days, grouped by feature and team member.
```

```text
> Make a full-screen web app for a wall display to show our most interacted-with GitHub issues.
```

### Interact with your system

```text
> Convert all the images in this directory to png, and rename them to use dates from the exif data.
```

```text
> Organise my PDF invoices by month of expenditure.
```

## Think AI Integration

This project has been modified to exclusively use the Think AI API instead of Gemini. The CLI provides:

- **Think AI Client**: Full integration with Think AI's chat and streaming endpoints
- **Automatic Detection**: The CLI automatically uses Think AI for all operations
- **Server-Sent Events**: Real-time streaming responses from Think AI
- **Comprehensive Testing**: 100% test coverage with unit, integration, and E2E tests

For Think AI API documentation, visit: [Think AI API Documentation](https://github.com/champi-dev/think_ai/blob/main/docs/API.md)
