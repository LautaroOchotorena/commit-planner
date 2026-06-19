function formatMessage(message: string, args: Array<string | number | boolean>): string {
  return args.reduce<string>(
    (result, arg, index) => result.replace(`{${index}}`, String(arg)),
    message
  );
}

function translate(message: string, ...args: Array<string | number | boolean>): string {
  try {
    // vscode is only available in the extension host, not in Node test runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require("vscode") as typeof import("vscode");
    return vscode.l10n.t(message, ...args);
  } catch {
    return formatMessage(message, args);
  }
}

export function t(message: string, ...args: Array<string | number | boolean>): string {
  return translate(message, ...args);
}
